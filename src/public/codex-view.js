const gameSelect = document.getElementById('codex-game-select');
const sessionView = document.getElementById('codex-session-view');

if (!(sessionView instanceof HTMLElement)) {
  throw new Error('Codex session container is missing from the page');
}

function clearSessionView() {
  sessionView.replaceChildren();
}

function appendEmptyState(title, description) {
  clearSessionView();

  const shell = document.createElement('div');
  shell.className = 'codex-empty-shell';

  const titleElement = document.createElement('h2');
  titleElement.className = 'codex-empty-title';
  titleElement.textContent = title;

  const descriptionElement = document.createElement('p');
  descriptionElement.className = 'codex-empty';
  descriptionElement.textContent = description;

  shell.append(titleElement, descriptionElement);
  sessionView.append(shell);
}

function appendSessionHeader(sessionId) {
  const header = document.createElement('header');
  header.className = 'codex-session-header';

  const heading = document.createElement('h2');
  heading.textContent = 'Transcript';

  const detail = document.createElement('code');
  detail.className = 'codex-session-id';
  detail.textContent = sessionId;

  header.append(heading, detail);
  sessionView.append(header);
}

function formatRole(role) {
  return role === 'assistant' ? 'Assistant' : 'User';
}

function appendTranscript(messages) {
  const thread = document.createElement('div');
  thread.className = 'codex-thread';

  for (const message of messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant') || typeof message.text !== 'string') {
      continue;
    }

    const card = document.createElement('article');
    card.className = `codex-message codex-message--${message.role}`;

    const label = document.createElement('div');
    label.className = 'codex-message-role';
    label.textContent = formatRole(message.role);

    const text = document.createElement('pre');
    text.className = 'codex-message-text';
    text.textContent = message.text;

    card.append(label, text);
    thread.append(card);
  }

  if (thread.childElementCount === 0) {
    appendEmptyState('No visible messages', 'This session has no user/assistant text entries yet.');
    return;
  }

  sessionView.append(thread);
}

function parseVersionIdFromQuery() {
  const url = new URL(window.location.href);
  const versionId = url.searchParams.get('versionId');
  return versionId && versionId.trim().length > 0 ? versionId : null;
}

function setQueryVersionId(versionId) {
  const url = new URL(window.location.href);
  url.searchParams.set('versionId', versionId);
  window.history.replaceState(null, '', url);
}

async function loadTranscript(versionId) {
  appendEmptyState('Loading transcript', 'Reading Codex session data...');

  let response;
  try {
    response = await fetch(`/api/codex-sessions/${encodeURIComponent(versionId)}`);
  } catch {
    appendEmptyState('Session unavailable', 'Could not reach the server.');
    return;
  }

  if (!response.ok) {
    appendEmptyState('Session unavailable', `Server returned ${response.status}.`);
    return;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    appendEmptyState('Session unavailable', 'Invalid response payload.');
    return;
  }

  if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
    appendEmptyState('Session unavailable', 'Unexpected response shape.');
    return;
  }

  if (payload.status === 'no-session') {
    appendEmptyState('No Codex session linked', 'This game version does not have a saved Codex session id.');
    return;
  }

  if (payload.status === 'session-file-missing') {
    appendEmptyState('Session file not found', 'The linked session id exists in metadata but no matching JSONL file was found.');
    return;
  }

  if (payload.status !== 'ok' || typeof payload.sessionId !== 'string' || !Array.isArray(payload.messages)) {
    appendEmptyState('Session unavailable', 'Unexpected transcript payload.');
    return;
  }

  clearSessionView();
  appendSessionHeader(payload.sessionId);
  appendTranscript(payload.messages);
}

if (gameSelect instanceof HTMLSelectElement) {
  const queryVersionId = parseVersionIdFromQuery();
  if (queryVersionId) {
    for (const option of gameSelect.options) {
      if (option.value === queryVersionId) {
        gameSelect.value = queryVersionId;
        break;
      }
    }
  }

  const selectedVersionId = gameSelect.value;
  if (selectedVersionId) {
    setQueryVersionId(selectedVersionId);
    void loadTranscript(selectedVersionId);
  }

  gameSelect.addEventListener('change', () => {
    const versionId = gameSelect.value;
    if (!versionId) {
      appendEmptyState('No version selected', 'Choose a game to inspect transcript messages.');
      return;
    }

    setQueryVersionId(versionId);
    void loadTranscript(versionId);
  });
} else {
  appendEmptyState('No versions available', 'Create a game version to inspect Codex session transcripts.');
}
