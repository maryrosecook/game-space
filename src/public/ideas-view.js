const listRoot = document.getElementById('ideas-list-root');
const generateButton = document.getElementById('ideas-generate-button');
const baseGameControl = document.getElementById('ideas-base-game-control');
const baseGameInput = document.getElementById('ideas-base-game-input');
const baseGameToggle = document.getElementById('ideas-base-game-toggle');
const baseGameMenu = document.getElementById('ideas-base-game-menu');
if (
  !(listRoot instanceof HTMLElement) ||
  !(generateButton instanceof HTMLButtonElement) ||
  !(baseGameControl instanceof HTMLElement) ||
  !(baseGameInput instanceof HTMLInputElement) ||
  !(baseGameToggle instanceof HTMLButtonElement) ||
  !(baseGameMenu instanceof HTMLElement)
) {
  throw new Error('Ideas view controls missing from page');
}

const csrfToken = document.body.dataset.csrfToken;
let activeGenerationRequest = null;
let baseGameMenuOpen = false;

function csrfHeaders() {
  const headers = {};
  if (typeof csrfToken === 'string' && csrfToken.length > 0) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  return headers;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeBaseGame(baseGameValue) {
  if (!baseGameValue || typeof baseGameValue !== 'object') {
    return {
      id: 'starter',
      label: 'starter',
      tileSnapshotPath: null
    };
  }

  const baseGameId = typeof baseGameValue.id === 'string' && baseGameValue.id.trim().length > 0
    ? baseGameValue.id.trim()
    : 'starter';
  const baseGameLabel =
    typeof baseGameValue.label === 'string' && baseGameValue.label.trim().length > 0
      ? baseGameValue.label.trim()
      : baseGameId;
  const tileSnapshotPath =
    typeof baseGameValue.tileSnapshotPath === 'string' && baseGameValue.tileSnapshotPath.trim().length > 0
      ? baseGameValue.tileSnapshotPath.trim()
      : null;

  return {
    id: baseGameId,
    label: baseGameLabel,
    tileSnapshotPath
  };
}

function renderBaseGameThumbnail(baseGame, className) {
  if (typeof baseGame.tileSnapshotPath === 'string' && baseGame.tileSnapshotPath.length > 0) {
    return `<img class="${className}" src="${escapeHtml(baseGame.tileSnapshotPath)}" alt="${escapeHtml(baseGame.label)}" />`;
  }

  const fallbackGlyph = escapeHtml((baseGame.label.slice(0, 1) || '?').toUpperCase());
  return `<span class="${className} ${className}--placeholder" aria-hidden="true">${fallbackGlyph}</span>`;
}

function updateBaseGameToggle(baseGame) {
  baseGameToggle.innerHTML = `${renderBaseGameThumbnail(baseGame, 'ideas-base-game-toggle-thumbnail')}<span id="ideas-base-game-toggle-label">${escapeHtml(baseGame.label)}</span>`;
}

function optionButtons() {
  return Array.from(baseGameMenu.querySelectorAll('button.ideas-base-game-option'));
}

function selectedBaseGameId() {
  const value = baseGameInput.value.trim();
  return value.length > 0 ? value : null;
}

function applyBaseGameSelection(baseGame) {
  baseGameInput.value = baseGame.id;
  updateBaseGameToggle(baseGame);

  const selectedId = baseGame.id;
  for (const button of optionButtons()) {
    const buttonBaseGameId = typeof button.dataset.baseGameId === 'string' ? button.dataset.baseGameId : '';
    const isSelected = buttonBaseGameId === selectedId;
    button.classList.toggle('ideas-base-game-option--selected', isSelected);
    button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  }
}

function baseGameFromOptionButton(optionButton) {
  const baseGameId = typeof optionButton.dataset.baseGameId === 'string' ? optionButton.dataset.baseGameId.trim() : '';
  if (baseGameId.length === 0) {
    return null;
  }

  const baseGameLabel =
    typeof optionButton.dataset.baseGameLabel === 'string' && optionButton.dataset.baseGameLabel.trim().length > 0
      ? optionButton.dataset.baseGameLabel.trim()
      : baseGameId;
  const tileSnapshotPath =
    typeof optionButton.dataset.baseGameTileSnapshotPath === 'string' &&
    optionButton.dataset.baseGameTileSnapshotPath.trim().length > 0
      ? optionButton.dataset.baseGameTileSnapshotPath.trim()
      : null;

  return {
    id: baseGameId,
    label: baseGameLabel,
    tileSnapshotPath
  };
}

function setBaseGameMenuOpen(nextIsOpen) {
  baseGameMenuOpen = nextIsOpen;
  baseGameControl.classList.toggle('ideas-base-game-control--open', nextIsOpen);
  baseGameToggle.setAttribute('aria-expanded', nextIsOpen ? 'true' : 'false');
  baseGameMenu.setAttribute('aria-hidden', nextIsOpen ? 'false' : 'true');
}

const ideaBuildIconMarkup = document.body.dataset.ideaBuildIcon ?? '';
const ideaArchiveIconMarkup = document.body.dataset.ideaArchiveIcon ?? '';

function applyGenerateState(isGenerating) {
  generateButton.classList.toggle('ideas-generate-button--generating', isGenerating);
  generateButton.setAttribute('aria-busy', isGenerating ? 'true' : 'false');
  generateButton.disabled = isGenerating;
}

async function syncIdeasState() {
  try {
    const response = await fetch('/api/ideas', {
      headers: csrfHeaders()
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (Array.isArray(payload.ideas)) {
      renderIdeas(payload.ideas);
    }

    applyGenerateState(payload.isGenerating === true);
  } catch {
    // Best-effort refresh only.
  }
}

function renderIdeas(ideas) {
  const visibleIdeas = Array.isArray(ideas) ? ideas.filter((idea) => idea && idea.isArchived !== true) : [];
  if (visibleIdeas.length === 0) {
    listRoot.innerHTML = '<p class="codex-empty">No ideas yet. Generate one to get started.</p>';
    return;
  }

  listRoot.innerHTML = `<ul class="ideas-list" role="list">${visibleIdeas
    .map((idea, index) => {
      const builtBadge = idea.hasBeenBuilt ? '<span class="idea-built-pill" aria-label="Built">Built</span>' : '';
      const baseGame = normalizeBaseGame(idea.baseGame);
      return `<li class="idea-row" data-idea-index="${index}">
        <div class="idea-base-game">
          ${renderBaseGameThumbnail(baseGame, 'idea-base-game-thumbnail')}
        </div>
        <div class="idea-content">
          <span class="idea-prompt">${escapeHtml(idea.prompt)}</span>
        </div>
        <div class="idea-actions">
          ${builtBadge}
          <button class="idea-action-button" type="button" data-action="build" data-idea-index="${index}" aria-label="Build from idea">
            ${ideaBuildIconMarkup}
          </button>
          <button class="idea-action-button idea-action-button--danger" type="button" data-action="archive" data-idea-index="${index}" aria-label="Archive idea">
            ${ideaArchiveIconMarkup}
          </button>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

async function generateIdea() {
  const baseGameId = selectedBaseGameId();
  if (!baseGameId) {
    return;
  }

  if (activeGenerationRequest) {
    activeGenerationRequest.abort();
  }

  const requestController = new AbortController();
  activeGenerationRequest = requestController;
  applyGenerateState(true);

  try {
    const response = await fetch('/api/ideas/generate', {
      method: 'POST',
      headers: {
        ...csrfHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ baseGameId }),
      signal: requestController.signal
    });
    if (!response.ok) {
      let errorMessage = 'Idea generation failed.';
      try {
        const payload = await response.json();
        if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error.trim().length > 0) {
          errorMessage = payload.error;
        }
      } catch {
        // Fall back to generic error when payload parsing fails.
      }

      window.alert(errorMessage);
      return;
    }

    const payload = await response.json();
    if (activeGenerationRequest !== requestController) {
      return;
    }

    renderIdeas(payload.ideas);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Idea generation request failed', error);
    }
    window.alert('Idea generation failed. Please try again.');
  } finally {
    if (activeGenerationRequest === requestController) {
      activeGenerationRequest = null;
      applyGenerateState(false);
    }
  }
}

async function archiveIdea(ideaIndex) {
  const confirmed = window.confirm('Archive this idea?');
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/ideas/${encodeURIComponent(String(ideaIndex))}`, {
    method: 'DELETE',
    headers: csrfHeaders()
  });
  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  renderIdeas(payload.ideas);
}

async function buildIdea(ideaIndex) {
  const response = await fetch(`/api/ideas/${encodeURIComponent(String(ideaIndex))}/build`, {
    method: 'POST',
    headers: {
      ...csrfHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  renderIdeas(payload.ideas);

  if (payload && typeof payload.forkId === 'string') {
    window.location.assign(`/game/${encodeURIComponent(payload.forkId)}`);
  }
}

baseGameToggle.addEventListener('click', () => {
  setBaseGameMenuOpen(!baseGameMenuOpen);
});

baseGameMenu.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const optionButton = target.closest('button.ideas-base-game-option');
  if (!(optionButton instanceof HTMLButtonElement)) {
    return;
  }

  const nextBaseGame = baseGameFromOptionButton(optionButton);
  if (!nextBaseGame) {
    return;
  }

  applyBaseGameSelection(nextBaseGame);
  setBaseGameMenuOpen(false);
});

document.addEventListener('click', (event) => {
  if (!baseGameMenuOpen) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Node) || baseGameControl.contains(target)) {
    return;
  }

  setBaseGameMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setBaseGameMenuOpen(false);
  }
});

generateButton.addEventListener('click', () => {
  void generateIdea();
});

listRoot.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest('button[data-action][data-idea-index]');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const action = button.dataset.action;
  const ideaIndex = Number.parseInt(button.dataset.ideaIndex ?? '', 10);
  if (!Number.isInteger(ideaIndex) || ideaIndex < 0) {
    return;
  }

  if (action === 'archive') {
    void archiveIdea(ideaIndex);
    return;
  }

  if (action === 'build') {
    void buildIdea(ideaIndex);
  }
});

const initialSelectedBaseGameId = selectedBaseGameId();
const initiallySelectedOption = optionButtons().find((optionButton) => {
  const optionBaseGameId = typeof optionButton.dataset.baseGameId === 'string' ? optionButton.dataset.baseGameId.trim() : '';
  return optionBaseGameId === initialSelectedBaseGameId;
}) ?? optionButtons().find((optionButton) => optionButton.getAttribute('aria-selected') === 'true');
if (initiallySelectedOption) {
  const initialBaseGame = baseGameFromOptionButton(initiallySelectedOption);
  if (initialBaseGame) {
    applyBaseGameSelection(initialBaseGame);
  }
}

window.addEventListener('pageshow', () => {
  void syncIdeasState();
});

void syncIdeasState();
