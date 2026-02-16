import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const promptPanel = document.getElementById('prompt-panel');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const promptRecord = document.getElementById('prompt-record');
const editTab = document.getElementById('game-tab-edit');
const codexTab = document.getElementById('game-tab-codex');
const codexPanel = document.getElementById('game-codex-panel');
const gameSessionView = document.getElementById('game-codex-session-view');

if (
  !(promptPanel instanceof HTMLElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement) ||
  !(promptRecord instanceof HTMLButtonElement) ||
  !(editTab instanceof HTMLButtonElement) ||
  !(codexTab instanceof HTMLButtonElement) ||
  !(codexPanel instanceof HTMLElement) ||
  !(gameSessionView instanceof HTMLElement)
) {
  throw new Error('Game view controls missing from page');
}

const versionId = document.body.dataset.versionId;
const transcriptPresenter = createCodexTranscriptPresenter(gameSessionView);
const transcriptPollIntervalMs = 2000;
let transcriptStatusKey = '';
let transcriptSignature = '';
let transcriptRequestInFlight = false;
const speechRecognitionConstructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let activeSpeechRecognition = null;
let pendingSpeechTranscript = '';
let applySpeechTranscriptOnStop = false;
let activeBottomPanel = 'closed';

function isMobileViewport() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 980px)').matches;
}

function applyBottomPanelState() {
  const editPanelOpen = activeBottomPanel === 'edit';
  const codexPanelOpen = activeBottomPanel === 'codex' && isMobileViewport();

  promptPanel.classList.toggle('prompt-panel--open', editPanelOpen);
  promptPanel.setAttribute('aria-hidden', editPanelOpen ? 'false' : 'true');

  editTab.classList.toggle('game-view-tab--active', editPanelOpen);
  editTab.setAttribute('aria-expanded', editPanelOpen ? 'true' : 'false');

  codexTab.classList.toggle('game-view-tab--active', codexPanelOpen);
  codexTab.setAttribute('aria-expanded', codexPanelOpen ? 'true' : 'false');

  document.body.classList.toggle('game-page--edit-open', editPanelOpen);
  document.body.classList.toggle('game-page--codex-open', codexPanelOpen);
}

function setActiveBottomPanel(nextPanel) {
  activeBottomPanel = nextPanel;
  applyBottomPanelState();

  if (nextPanel === 'edit') {
    focusPromptInput();
  }
}

function toggleBottomPanel(nextPanel) {
  setActiveBottomPanel(activeBottomPanel === nextPanel ? 'closed' : nextPanel);
}

function syncBottomPanelForViewport() {
  if (activeBottomPanel === 'codex' && !isMobileViewport()) {
    activeBottomPanel = 'closed';
  }

  applyBottomPanelState();
}

function setRecordButtonState(isRecording) {
  promptRecord.classList.toggle('prompt-record--recording', isRecording);
  promptRecord.setAttribute('aria-pressed', isRecording ? 'true' : 'false');
}

function focusPromptInput() {
  window.requestAnimationFrame(() => {
    promptInput.focus();
  });
}

function appendTranscriptToPromptInput(transcriptText) {
  const trimmedTranscript = transcriptText.trim();
  if (trimmedTranscript.length === 0) {
    focusPromptInput();
    return;
  }

  const hasExistingText = promptInput.value.trim().length > 0;
  const needsSeparator = hasExistingText && !promptInput.value.endsWith(' ');
  const separator = needsSeparator ? ' ' : '';
  promptInput.value = `${promptInput.value}${separator}${trimmedTranscript}`;
  focusPromptInput();
}

function buildTranscriptFromRecognitionResults(results) {
  if (!results || typeof results.length !== 'number') {
    return '';
  }

  let transcriptText = '';
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result || typeof result.length !== 'number') {
      continue;
    }

    const alternative = result[0];
    const transcriptSegment = typeof alternative?.transcript === 'string' ? alternative.transcript : '';
    transcriptText += transcriptSegment;
  }

  return transcriptText.trim();
}

function resetSpeechRecognitionState() {
  activeSpeechRecognition = null;
  pendingSpeechTranscript = '';
  applySpeechTranscriptOnStop = false;
  setRecordButtonState(false);
}

function stopRecordingAndQueueTranscriptInsert() {
  if (!activeSpeechRecognition) {
    return;
  }

  applySpeechTranscriptOnStop = true;
  try {
    activeSpeechRecognition.stop();
  } catch {
    resetSpeechRecognitionState();
    focusPromptInput();
  }
}

function startRecording() {
  if (typeof speechRecognitionConstructor !== 'function' || activeSpeechRecognition) {
    return;
  }

  const speechRecognition = new speechRecognitionConstructor();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'en-US';
  activeSpeechRecognition = speechRecognition;
  pendingSpeechTranscript = '';
  applySpeechTranscriptOnStop = false;
  setRecordButtonState(true);

  speechRecognition.onresult = (event) => {
    pendingSpeechTranscript = buildTranscriptFromRecognitionResults(event?.results);
  };

  speechRecognition.onerror = () => {
    resetSpeechRecognitionState();
  };

  speechRecognition.onend = () => {
    const shouldApplyTranscript = applySpeechTranscriptOnStop;
    const transcriptText = pendingSpeechTranscript;
    resetSpeechRecognitionState();

    if (shouldApplyTranscript) {
      appendTranscriptToPromptInput(transcriptText);
    }
  };

  try {
    speechRecognition.start();
  } catch {
    resetSpeechRecognitionState();
  }
}

function showTranscriptState(statusKey, title, description) {
  if (transcriptStatusKey === statusKey) {
    return;
  }

  transcriptPresenter.showEmptyState(title, description);
  transcriptStatusKey = statusKey;
  transcriptSignature = '';
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
  const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/prompts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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

if (typeof speechRecognitionConstructor !== 'function') {
  promptRecord.disabled = true;
}

setRecordButtonState(false);
setActiveBottomPanel('closed');

if (typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => {
    syncBottomPanelForViewport();
  });
}

editTab.addEventListener('click', () => {
  toggleBottomPanel('edit');
});

codexTab.addEventListener('click', () => {
  if (!isMobileViewport()) {
    return;
  }

  toggleBottomPanel('codex');
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

promptRecord.addEventListener('click', () => {
  if (activeSpeechRecognition) {
    stopRecordingAndQueueTranscriptInsert();
    return;
  }

  startRecording();
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

startTranscriptPolling();
