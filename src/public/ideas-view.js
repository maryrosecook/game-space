const listRoot = document.getElementById('ideas-list-root');
const generateButton = document.getElementById('ideas-generate-button');
if (!(listRoot instanceof HTMLElement) || !(generateButton instanceof HTMLButtonElement)) {
  throw new Error('Ideas view controls missing from page');
}

const csrfToken = document.body.dataset.csrfToken;
let activeGenerationRequest = null;

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

function applyGenerateState(isGenerating) {
  generateButton.classList.toggle('ideas-generate-button--generating', isGenerating);
  generateButton.setAttribute('aria-busy', isGenerating ? 'true' : 'false');
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
  if (!Array.isArray(ideas) || ideas.length === 0) {
    listRoot.innerHTML = '<p class="codex-empty">No ideas yet. Generate one to get started.</p>';
    return;
  }

  listRoot.innerHTML = `<ul class="ideas-list" role="list">${ideas
    .map((idea, index) => {
      const builtBadge = idea.hasBeenBuilt ? '<span class="idea-built-pill" aria-label="Built">Built</span>' : '';
      return `<li class="idea-row" data-idea-index="${index}">
        <div class="idea-content">
          <span class="idea-prompt">${escapeHtml(idea.prompt)}</span>
        </div>
        <div class="idea-actions">
          ${builtBadge}
          <button class="idea-action-button" type="button" data-action="build" data-idea-index="${index}" aria-label="Build from idea">
            <svg class="idea-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4.5 16.5c-1.5 1.26-3 5.5-2 6.5s5.24-.5 6.5-2c1.5-1.8 1.5-4.5 0-6-1.5-1.5-4.2-1.5-6 0z"></path>
              <path d="m12 15-3-3a9 9 0 0 1 3-8l4 4a9 9 0 0 1-8 3z"></path>
              <path d="M16 8h5"></path>
              <path d="M19 5v6"></path>
            </svg>
          </button>
          <button class="idea-action-button idea-action-button--danger" type="button" data-action="delete" data-idea-index="${index}" aria-label="Delete idea">
            <svg class="idea-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M19 6l-1 14H6L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

async function generateIdea() {
  if (activeGenerationRequest) {
    activeGenerationRequest.abort();
  }

  const requestController = new AbortController();
  activeGenerationRequest = requestController;
  applyGenerateState(true);

  try {
    const response = await fetch('/api/ideas/generate', {
      method: 'POST',
      headers: csrfHeaders(),
      signal: requestController.signal
    });
    if (!response.ok) {
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
  } finally {
    if (activeGenerationRequest === requestController) {
      activeGenerationRequest = null;
      applyGenerateState(false);
    }
  }
}

async function deleteIdea(ideaIndex) {
  const confirmed = window.confirm('Delete this idea?');
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

  if (action === 'delete') {
    void deleteIdea(ideaIndex);
    return;
  }

  if (action === 'build') {
    void buildIdea(ideaIndex);
  }
});


window.addEventListener('pageshow', () => {
  void syncIdeasState();
});

void syncIdeasState();
