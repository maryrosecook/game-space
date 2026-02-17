import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const promptPanel = document.getElementById('prompt-panel');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const editTab = document.getElementById('game-tab-edit');
const recordButton = document.getElementById('prompt-record-button');
const codexToggle = document.getElementById('game-codex-toggle');
const codexTranscript = document.getElementById('game-codex-transcript');
const gameSessionView = document.getElementById('game-codex-session-view');

if (
  !(promptPanel instanceof HTMLElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement) ||
  !(editTab instanceof HTMLButtonElement) ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(codexToggle instanceof HTMLButtonElement) ||
  !(codexTranscript instanceof HTMLElement) ||
  !(gameSessionView instanceof HTMLElement)
) {
  throw new Error('Game view controls missing from page');
}

const versionId = document.body.dataset.versionId;
const csrfToken = document.body.dataset.csrfToken;
const transcriptPresenter = createCodexTranscriptPresenter(gameSessionView);
const transcriptPollIntervalMs = 2000;
const generatingClassName = 'game-view-tab--generating';
let transcriptStatusKey = '';
let transcriptSignature = '';
let transcriptRequestInFlight = false;
let editPanelOpen = false;
let codexPanelExpanded = false;
let mediaRecorder = null;
let recordingChunks = [];
let recordingInProgress = false;
let transcriptionInFlight = false;

function updateRecordButtonVisualState() {
  recordButton.classList.toggle('prompt-record-button--recording', recordingInProgress);
  recordButton.classList.toggle('prompt-record-button--busy', transcriptionInFlight);
  recordButton.disabled = transcriptionInFlight;

  if (recordingInProgress) {
    recordButton.setAttribute('aria-label', 'Stop voice recording');
    return;
  }

  recordButton.setAttribute('aria-label', 'Start voice recording');
}

async function transcribeRecording(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const audioBase64 = window.btoa(binary);

  const headers = {
    'Content-Type': 'application/json'
  };

  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      audioBase64,
      mimeType: audioBlob.type || 'audio/webm'
    })
  });

  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string') {
    return;
  }

  const transcribedText = payload.text.trim();
  if (transcribedText.length === 0) {
    return;
  }

  promptInput.value = transcribedText;
  focusPromptInput();
}

async function stopRecordingAndTranscribe() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    return;
  }

  transcriptionInFlight = true;
  updateRecordButtonVisualState();

  const stoppedBlob = await new Promise((resolve) => {
    const recorder = mediaRecorder;
    recorder.addEventListener(
      'stop',
      () => {
        const blob = new Blob(recordingChunks, {
          type: recorder.mimeType || 'audio/webm'
        });
        resolve(blob);
      },
      { once: true }
    );

    recorder.stop();
  });

  recordingInProgress = false;
  recordingChunks = [];

  try {
    await transcribeRecording(stoppedBlob);
  } finally {
    transcriptionInFlight = false;
    updateRecordButtonVisualState();
  }
}

async function startRecording() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return;
  }

  mediaRecorder = new MediaRecorder(stream);
  recordingChunks = [];

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener(
    'stop',
    () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
    { once: true }
  );

  mediaRecorder.start();
  recordingInProgress = true;
  updateRecordButtonVisualState();
}

function toggleRecording() {
  if (transcriptionInFlight) {
    return;
  }

  if (recordingInProgress) {
    void stopRecordingAndTranscribe();
    return;
  }

  void startRecording();
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
  focusPromptInput();
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

applyEyeState('stopped');

updateRecordButtonVisualState();

recordButton.addEventListener('click', () => {
  toggleRecording();
});
startTranscriptPolling();
