import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const editButton = document.getElementById('edit-button');
const promptPanel = document.getElementById('prompt-panel');
const closeButton = document.getElementById('prompt-close');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const gameSessionView = document.getElementById('game-codex-session-view');

if (
  !(editButton instanceof HTMLButtonElement) ||
  !(promptPanel instanceof HTMLElement) ||
  !(closeButton instanceof HTMLButtonElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement) ||
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

function openPromptPanel() {
  promptPanel.classList.add('prompt-panel--open');
  promptPanel.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    promptInput.focus();
  });
}

function closePromptPanel() {
  promptPanel.classList.remove('prompt-panel--open');
  promptPanel.setAttribute('aria-hidden', 'true');
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

editButton.addEventListener('click', () => {
  openPromptPanel();
});

closeButton.addEventListener('click', () => {
  closePromptPanel();
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
  closePromptPanel();
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    promptForm.requestSubmit();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePromptPanel();
  }
});

startTranscriptPolling();
