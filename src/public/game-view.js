const editButton = document.getElementById('edit-button');
const promptPanel = document.getElementById('prompt-panel');
const closeButton = document.getElementById('prompt-close');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');

if (
  !(editButton instanceof HTMLButtonElement) ||
  !(promptPanel instanceof HTMLElement) ||
  !(closeButton instanceof HTMLButtonElement) ||
  !(promptForm instanceof HTMLFormElement) ||
  !(promptInput instanceof HTMLInputElement)
) {
  throw new Error('Prompt controls missing from game view');
}

const versionId = document.body.dataset.versionId;

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
