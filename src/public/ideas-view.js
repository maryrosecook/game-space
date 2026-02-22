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

const ideaBuildIconMarkup = document.body.dataset.ideaBuildIcon ?? '';
const ideaDeleteIconMarkup = document.body.dataset.ideaDeleteIcon ?? '';

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
            ${ideaBuildIconMarkup}
          </button>
          <button class="idea-action-button idea-action-button--danger" type="button" data-action="delete" data-idea-index="${index}" aria-label="Delete idea">
            ${ideaDeleteIconMarkup}
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
