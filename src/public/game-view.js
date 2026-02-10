const editButton = document.getElementById('edit-button');
const promptPanel = document.getElementById('prompt-panel');
const closeButton = document.getElementById('prompt-close');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const promptStatus = document.getElementById('prompt-status');

if (
  !(editButton instanceof HTMLButtonElement) ||
  !(promptPanel instanceof HTMLElement) ||
  !(closeButton instanceof HTMLButtonElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement) ||
  !(promptStatus instanceof HTMLElement)
) {
  throw new Error('Prompt controls missing from game view');
}

const versionId = document.body.dataset.versionId;
const POLL_INTERVAL_MS = 1200;
const MAX_POLL_ATTEMPTS = 90;
let isSubmittingPrompt = false;

function setPromptStatus(message, state) {
  promptStatus.textContent = message;
  if (state) {
    promptStatus.dataset.state = state;
    return;
  }

  delete promptStatus.dataset.state;
}

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

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    if (
      payload &&
      typeof payload === 'object' &&
      typeof payload.error === 'string' &&
      payload.error.trim().length > 0
    ) {
      return payload.error;
    }
  } catch {
    // Ignore parse failures and use a fallback message.
  }

  return `Request failed (${response.status})`;
}

async function waitForPromptCompletion(statusUrl) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, POLL_INTERVAL_MS);
    });

    const response = await fetch(statusUrl, {
      headers: {
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json();
    const state = payload?.state;
    if (state === 'succeeded') {
      return payload;
    }
    if (state === 'failed') {
      const errorMessage =
        typeof payload.error === 'string' && payload.error.trim().length > 0
          ? payload.error
          : 'Codex run failed';
      throw new Error(errorMessage);
    }
  }

  throw new Error('Timed out waiting for Codex to finish');
}

editButton.addEventListener('click', () => {
  openPromptPanel();
});

closeButton.addEventListener('click', () => {
  closePromptPanel();
});

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (isSubmittingPrompt) {
    return;
  }

  const prompt = promptInput.value;
  if (!versionId || prompt.trim().length === 0) {
    return;
  }

  isSubmittingPrompt = true;
  promptInput.disabled = true;
  setPromptStatus('Creating fork and starting Codex...', 'running');

  void (async () => {
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(versionId)}/prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json();
      const forkId = typeof payload.forkId === 'string' ? payload.forkId : null;
      const statusUrl = typeof payload.statusUrl === 'string' ? payload.statusUrl : null;
      if (!forkId || !statusUrl) {
        throw new Error('Prompt response did not include status details');
      }

      promptInput.value = '';
      setPromptStatus(`Forked ${forkId}. Waiting for Codex...`, 'running');
      await waitForPromptCompletion(statusUrl);
      setPromptStatus(`Codex completed for ${forkId}.`, 'succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPromptStatus(`Prompt failed: ${message}`, 'failed');
    } finally {
      isSubmittingPrompt = false;
      promptInput.disabled = false;
      promptInput.focus();
    }
  })();
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
