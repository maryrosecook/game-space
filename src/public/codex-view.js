import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';

const gameSelect = document.getElementById('codex-game-select');
const sessionView = document.getElementById('codex-session-view');
const codegenProvider = document.body.dataset.codegenProvider === 'claude' ? 'claude' : 'codex';
const transcriptProviderLabel = codegenProvider === 'claude' ? 'Claude' : 'Codex';
const transcriptPresenter = createCodexTranscriptPresenter(sessionView, {
  transcriptTitle: `${transcriptProviderLabel} Transcript`
});

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
  transcriptPresenter.showLoadingState();

  let response;
  try {
    response = await fetch(`/api/codex-sessions/${encodeURIComponent(versionId)}`);
  } catch {
    transcriptPresenter.showEmptyState('Session unavailable', 'Could not reach the server.');
    return;
  }

  if (!response.ok) {
    transcriptPresenter.showEmptyState('Session unavailable', `Server returned ${response.status}.`);
    return;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    transcriptPresenter.showEmptyState('Session unavailable', 'Invalid response payload.');
    return;
  }

  if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
    transcriptPresenter.showEmptyState('Session unavailable', 'Unexpected response shape.');
    return;
  }

  if (payload.status === 'no-session') {
    transcriptPresenter.showEmptyState(
      'No session linked',
      `This game version does not have a saved ${transcriptProviderLabel} session id.`
    );
    return;
  }

  if (payload.status === 'session-file-missing') {
    transcriptPresenter.showEmptyState(
      'Session file not found',
      'The linked session id exists in metadata but no matching JSONL file was found.'
    );
    return;
  }

  if (payload.status !== 'ok' || typeof payload.sessionId !== 'string' || !Array.isArray(payload.messages)) {
    transcriptPresenter.showEmptyState('Session unavailable', 'Unexpected transcript payload.');
    return;
  }

  transcriptPresenter.renderTranscript(payload.sessionId, payload.messages, { autoScrollToBottom: true });
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
      transcriptPresenter.showEmptyState('No version selected', 'Choose a game to inspect transcript messages.');
      return;
    }

    setQueryVersionId(versionId);
    void loadTranscript(versionId);
  });
} else {
  transcriptPresenter.showEmptyState(
    'No versions available',
    `Create a game version to inspect ${transcriptProviderLabel} session transcripts.`
  );
}
