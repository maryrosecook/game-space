import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const promptPanel = document.getElementById('prompt-panel');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const editTab = document.getElementById('game-tab-edit');
const favoriteButton = document.getElementById('game-tab-favorite');
const recordButton = document.getElementById('prompt-record-button');
const codexToggle = document.getElementById('game-codex-toggle');
const promptOverlay = document.getElementById('prompt-overlay');
const codexTranscript = document.getElementById('game-codex-transcript');
const gameSessionView = document.getElementById('game-codex-session-view');

if (
  !(promptPanel instanceof HTMLElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement) ||
  !(editTab instanceof HTMLButtonElement) ||
  !(favoriteButton instanceof HTMLButtonElement) ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(codexToggle instanceof HTMLButtonElement) ||
  !(codexTranscript instanceof HTMLElement) ||
  !(gameSessionView instanceof HTMLElement)
) {
  throw new Error('Game view controls missing from page');
}

const versionId = document.body.dataset.versionId;
const csrfToken = document.body.dataset.csrfToken;
const initialFavorite = document.body.dataset.gameFavorited === 'true';
const transcriptPresenter = createCodexTranscriptPresenter(gameSessionView);
const transcriptPollIntervalMs = 2000;
const generatingClassName = 'game-view-tab--generating';
let transcriptStatusKey = '';
let transcriptSignature = '';
let transcriptRequestInFlight = false;
let favoriteRequestInFlight = false;
let editPanelOpen = false;
let codexPanelExpanded = false;
let gameFavorited = initialFavorite;
let recordingInProgress = false;
let transcriptionInFlight = false;
let realtimePeerConnection = null;
let realtimeDataChannel = null;
let realtimeAudioStream = null;
let completedTranscriptionSegments = [];

function applyFavoriteState() {
  favoriteButton.classList.toggle('game-view-icon-tab--active', gameFavorited);
  favoriteButton.setAttribute('aria-pressed', gameFavorited ? 'true' : 'false');
  favoriteButton.setAttribute('aria-label', gameFavorited ? 'Unfavorite game' : 'Favorite game');
}

function logRealtimeTranscription(message, details = undefined) {
  if (typeof console === 'undefined' || typeof console.log !== 'function') {
    return;
  }

  if (details === undefined) {
    console.log(`[realtime-transcription] ${message}`);
    return;
  }

  console.log(`[realtime-transcription] ${message}`, details);
}

function updateRecordButtonVisualState() {
  recordButton.classList.toggle('game-view-icon-tab--recording', recordingInProgress);
  recordButton.classList.toggle('game-view-icon-tab--busy', transcriptionInFlight);
  recordButton.disabled = transcriptionInFlight;

  if (recordingInProgress) {
    recordButton.setAttribute('aria-label', 'Stop voice recording');
    return;
  }

  recordButton.setAttribute('aria-label', 'Start voice recording');
}

function stopAudioStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function closeRealtimeConnection() {
  if (realtimeDataChannel && typeof realtimeDataChannel.close === 'function') {
    realtimeDataChannel.close();
  }

  if (realtimePeerConnection && typeof realtimePeerConnection.close === 'function') {
    realtimePeerConnection.close();
  }

  if (realtimeAudioStream) {
    stopAudioStream(realtimeAudioStream);
  }

  realtimePeerConnection = null;
  realtimeDataChannel = null;
  realtimeAudioStream = null;
}

function updatePromptOverlay() {
  const overlayText = completedTranscriptionSegments.join(' ').trim();
  const shouldShowOverlay = !editPanelOpen && overlayText.length > 0;

  if (!(promptOverlay instanceof HTMLElement)) {
    return;
  }

  promptOverlay.textContent = shouldShowOverlay ? overlayText : '';
  promptOverlay.classList.toggle('prompt-overlay--visible', shouldShowOverlay);
  promptOverlay.setAttribute('aria-hidden', shouldShowOverlay ? 'false' : 'true');
}

function appendCompletedTranscriptSegment(transcriptSegment) {
  const normalizedSegment = transcriptSegment.trim();
  if (normalizedSegment.length === 0) {
    return;
  }

  completedTranscriptionSegments.push(normalizedSegment);

  if (editPanelOpen) {
    promptInput.value = completedTranscriptionSegments.join(' ').trim();
    focusPromptInput();
  }

  updatePromptOverlay();
}

function handleRealtimeDataChannelMessage(event) {
  if (!event || typeof event.data !== 'string') {
    return;
  }

  logRealtimeTranscription('data received', event.data);

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return;
  }

  if (payload.type !== 'conversation.item.input_audio_transcription.completed') {
    return;
  }

  if (typeof payload.transcript === 'string') {
    appendCompletedTranscriptSegment(payload.transcript);
  }
}

function csrfRequestHeaders() {
  const headers = {};

  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  return headers;
}

async function requestRealtimeClientSecret() {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: csrfRequestHeaders()
  });

  if (!response.ok) {
    let errorDetails = `status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error.trim().length > 0) {
        errorDetails = `${errorDetails}: ${payload.error}`;
      }
    } catch {
      // Keep status-only detail when the response payload cannot be parsed.
    }

    logRealtimeTranscription('session request failed', errorDetails);
    return null;
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.clientSecret !== 'string') {
    return null;
  }

  if (payload.clientSecret.trim().length === 0) {
    return null;
  }

  return payload.clientSecret;
}

async function toggleFavorite() {
  if (!versionId || favoriteRequestInFlight) {
    return;
  }

  favoriteRequestInFlight = true;
  favoriteButton.disabled = true;

  try {
    const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/favorite`, {
      method: 'POST',
      headers: csrfRequestHeaders()
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || typeof payload.favorite !== 'boolean') {
      return;
    }

    gameFavorited = payload.favorite;
    document.body.dataset.gameFavorited = gameFavorited ? 'true' : 'false';
    applyFavoriteState();
  } finally {
    favoriteRequestInFlight = false;
    favoriteButton.disabled = false;
  }
}

async function startRealtimeRecording() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    return;
  }

  if (typeof RTCPeerConnection !== 'function') {
    return;
  }

  transcriptionInFlight = true;
  updateRecordButtonVisualState();
  completedTranscriptionSegments = [];
  updatePromptOverlay();

  let peerConnection = null;
  let dataChannel = null;
  let stream = null;

  try {
    const clientSecret = await requestRealtimeClientSecret();
    if (!clientSecret) {
      return;
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('message', handleRealtimeDataChannelMessage);

    for (const track of stream.getTracks()) {
      peerConnection.addTrack(track, stream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const response = await fetch('https://api.openai.com/v1/realtime?intent=transcription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp'
      },
      body: typeof offer.sdp === 'string' ? offer.sdp : ''
    });

    if (!response.ok) {
      throw new Error('Realtime transcription SDP exchange failed');
    }

    const answerSdp = await response.text();
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });

    realtimePeerConnection = peerConnection;
    realtimeDataChannel = dataChannel;
    realtimeAudioStream = stream;
    recordingInProgress = true;
    logRealtimeTranscription('started');
  } catch {
    if (dataChannel && typeof dataChannel.close === 'function') {
      dataChannel.close();
    }

    if (peerConnection && typeof peerConnection.close === 'function') {
      peerConnection.close();
    }

    if (stream) {
      stopAudioStream(stream);
    }

    return;
  } finally {
    transcriptionInFlight = false;
    updateRecordButtonVisualState();
  }
}

async function stopRealtimeRecording() {
  if (!recordingInProgress) {
    return;
  }

  transcriptionInFlight = true;
  updateRecordButtonVisualState();

  try {
    if (realtimeDataChannel && realtimeDataChannel.readyState === 'open') {
      realtimeDataChannel.send(
        JSON.stringify({
          type: 'input_audio_buffer.commit'
        })
      );
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });

    const transcribedPrompt = completedTranscriptionSegments.join(' ').trim();
    if (!editPanelOpen && versionId && transcribedPrompt.length > 0) {
      await submitPrompt(transcribedPrompt);
      completedTranscriptionSegments = [];
      updatePromptOverlay();
    }
  } finally {
    logRealtimeTranscription('stopped');
    logRealtimeTranscription('final transcribed text', promptInput.value);
    recordingInProgress = false;
    closeRealtimeConnection();
    transcriptionInFlight = false;
    updateRecordButtonVisualState();
  }
}

function toggleRecording() {
  if (transcriptionInFlight) {
    return;
  }

  if (recordingInProgress) {
    void stopRealtimeRecording();
    return;
  }

  void startRealtimeRecording();
}

function applyBottomPanelState() {
  promptPanel.classList.toggle('prompt-panel--open', editPanelOpen);
  promptPanel.setAttribute('aria-hidden', editPanelOpen ? 'false' : 'true');

  editTab.classList.toggle('game-view-tab--active', editPanelOpen);
  editTab.setAttribute('aria-expanded', editPanelOpen ? 'true' : 'false');

  codexToggle.setAttribute('aria-expanded', codexPanelExpanded ? 'true' : 'false');

  codexTranscript.classList.toggle('game-codex-transcript--open', codexPanelExpanded);
  codexTranscript.setAttribute('aria-hidden', codexPanelExpanded ? 'false' : 'true');

  document.body.classList.toggle('game-page--edit-open', editPanelOpen);
  document.body.classList.toggle('game-page--codex-expanded', codexPanelExpanded);

  if (editPanelOpen) {
    promptInput.value = completedTranscriptionSegments.join(' ').trim();
  }

  updatePromptOverlay();
}

function toggleEditPanel() {
  if (editPanelOpen) {
    editPanelOpen = false;
    codexPanelExpanded = false;
    applyBottomPanelState();
    return;
  }

  editPanelOpen = true;
  applyBottomPanelState();
  focusPromptInput();
}

function toggleCodexPanelExpanded() {
  if (!editPanelOpen) {
    editPanelOpen = true;
  }

  codexPanelExpanded = !codexPanelExpanded;
  applyBottomPanelState();

  if (!codexPanelExpanded) {
    focusPromptInput();
  }
}

function focusPromptInput() {
  window.requestAnimationFrame(() => {
    promptInput.focus();
  });
}

function showTranscriptState(statusKey, title, description) {
  if (transcriptStatusKey === statusKey) {
    return;
  }

  transcriptPresenter.showEmptyState(title, description);
  transcriptStatusKey = statusKey;
  transcriptSignature = '';
}

function parseEyeState(value) {
  if (value === 'stopped' || value === 'idle' || value === 'generating' || value === 'error') {
    return value;
  }

  return null;
}

function applyEyeState(eyeState) {
  const isGenerating = eyeState === 'generating';
  if (isGenerating) {
    editTab.classList.add(generatingClassName);
  } else {
    editTab.classList.remove(generatingClassName);
  }

  editTab.setAttribute('aria-busy', isGenerating ? 'true' : 'false');
}

function buildTranscriptSignature(sessionId, messages) {
  const lastMessage = messages[messages.length - 1];
  const lastRole = typeof lastMessage?.role === 'string' ? lastMessage.role : '';
  const lastText = typeof lastMessage?.text === 'string' ? lastMessage.text : '';
  const lastTimestamp = typeof lastMessage?.timestamp === 'string' ? lastMessage.timestamp : '';
  return `${sessionId}:${messages.length}:${lastRole}:${lastTimestamp}:${lastText}`;
}

async function loadGameTranscript() {
  if (transcriptRequestInFlight) {
    return;
  }

  transcriptRequestInFlight = true;

  try {
    if (!versionId) {
      showTranscriptState('missing-version', 'Session unavailable', 'Game version id is missing from this page.');
      return;
    }

    let response;
    try {
      response = await fetch(`/api/codex-sessions/${encodeURIComponent(versionId)}`);
    } catch {
      showTranscriptState('fetch-failed', 'Session unavailable', 'Could not reach the server.');
      return;
    }

    if (!response.ok) {
      showTranscriptState(`bad-status-${response.status}`, 'Session unavailable', `Server returned ${response.status}.`);
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      showTranscriptState('invalid-json', 'Session unavailable', 'Invalid response payload.');
      return;
    }

    if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
      showTranscriptState('invalid-shape', 'Session unavailable', 'Unexpected response shape.');
      return;
    }

    const eyeState = parseEyeState(payload.eyeState);
    if (eyeState) {
      applyEyeState(eyeState);
    }

    if (payload.status === 'no-session') {
      showTranscriptState(
        'no-session',
        'No Codex session linked',
        'This game version does not have a saved Codex session id yet.'
      );
      return;
    }

    if (payload.status === 'session-file-missing') {
      showTranscriptState(
        'session-file-missing',
        'Session file not found',
        'The linked session id exists in metadata but no matching JSONL file was found.'
      );
      return;
    }

    if (payload.status !== 'ok' || typeof payload.sessionId !== 'string' || !Array.isArray(payload.messages)) {
      showTranscriptState('invalid-transcript', 'Session unavailable', 'Unexpected transcript payload.');
      return;
    }

    const nextSignature = buildTranscriptSignature(payload.sessionId, payload.messages);
    const shouldRenderTranscript = transcriptStatusKey !== 'ok' || transcriptSignature !== nextSignature;
    if (!shouldRenderTranscript) {
      return;
    }

    transcriptPresenter.renderTranscript(payload.sessionId, payload.messages, { autoScrollToBottom: true });
    transcriptStatusKey = 'ok';
    transcriptSignature = nextSignature;
  } finally {
    transcriptRequestInFlight = false;
  }
}

function startTranscriptPolling() {
  void loadGameTranscript();

  const intervalId = window.setInterval(() => {
    void loadGameTranscript();
  }, transcriptPollIntervalMs);

  window.addEventListener(
    'beforeunload',
    () => {
      window.clearInterval(intervalId);
    },
    { once: true }
  );
}

async function submitPrompt(prompt) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/prompts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.forkId !== 'string') {
    return;
  }

  window.location.assign(`/game/${encodeURIComponent(payload.forkId)}`);
}

applyBottomPanelState();

editTab.addEventListener('click', () => {
  toggleEditPanel();
});

codexToggle.addEventListener('click', () => {
  toggleCodexPanelExpanded();
});

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const prompt = promptInput.value;
  if (!versionId || prompt.trim().length === 0) {
    return;
  }

  void submitPrompt(prompt).catch(() => {
    // Keep prompt submit non-blocking if networking or payload parsing fails.
  });

  promptInput.value = '';
  completedTranscriptionSegments = [];
  updatePromptOverlay();
  focusPromptInput();
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

window.addEventListener(
  'beforeunload',
  () => {
    closeRealtimeConnection();
  },
  { once: true }
);

applyEyeState('stopped');

updateRecordButtonVisualState();
applyFavoriteState();

recordButton.addEventListener('click', () => {
  toggleRecording();
});

favoriteButton.addEventListener('click', () => {
  void toggleFavorite();
});
startTranscriptPolling();
