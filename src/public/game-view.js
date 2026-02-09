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

  void fetch(`/api/games/${encodeURIComponent(versionId)}/prompts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  }).catch(() => {
    // Fire-and-forget UX in V1: no blocking status UI.
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
