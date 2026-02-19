import type { GameVersion } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatHomepageVersionName(versionId: string): string {
  return versionId.replaceAll('-', ' ');
}

type HomepageRenderOptions = {
  isAdmin?: boolean;
};

export function renderHomepage(versions: readonly GameVersion[], options: HomepageRenderOptions = {}): string {
  const isAdmin = options.isAdmin ?? false;
  const authLabel = isAdmin ? 'Auth' : 'Login';
  const tiles = versions
    .map((version) => {
      const id = escapeHtml(version.id);
      const displayId = escapeHtml(formatHomepageVersionName(version.id));
      const tileColor = typeof version.tileColor === 'string' ? version.tileColor : '#1D3557';
      const tileColorEscaped = escapeHtml(tileColor);
      const favoriteClassName = version.favorite === true ? ' game-tile--favorite' : '';
      return `
        <a class="game-tile${favoriteClassName}" href="/game/${encodeURIComponent(version.id)}" data-version-id="${id}" data-tile-color="${tileColorEscaped}" style="--tile-color: ${tileColorEscaped};">
          <span class="tile-id">${displayId}</span>
        </a>
      `;
    })
    .join('');

  const content =
    versions.length > 0
      ? `<div class="game-grid" role="list">${tiles}</div>`
      : '<p class="empty-state">No game versions were found.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fountain</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="homepage">
    <main class="homepage-shell">
      <header class="page-header page-header--with-auth">
        <h1>Fountain</h1>
        <a class="auth-link" href="/auth">${authLabel}</a>
      </header>
      ${content}
    </main>
  </body>
</html>`;
}

export function renderCodexView(versions: readonly GameVersion[]): string {
  const options = versions
    .map((version) => {
      const id = escapeHtml(version.id);
      const createdLabel = escapeHtml(formatDateTime(version.createdTime));
      return `<option value="${id}">${id} (${createdLabel})</option>`;
    })
    .join('');

  const selectorContent =
    versions.length > 0
      ? `<select id="codex-game-select" class="codex-select" name="versionId">${options}</select>`
      : '<p class="codex-empty">No game versions are available yet.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Sessions</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="codex-page">
    <main class="codex-shell">
      <header class="page-header codex-header">
        <h1>Codex Sessions</h1>
        <a class="codex-home-link" href="/">Back to games</a>
      </header>
      <section class="codex-controls">
        <label class="codex-label" for="codex-game-select">Game version</label>
        ${selectorContent}
      </section>
      <section id="codex-session-view" class="codex-session-view" aria-live="polite">
        <p class="codex-empty">Select a game version to inspect its Codex transcript.</p>
      </section>
    </main>
    <script type="module" src="/public/codex-view.js"></script>
  </body>
</html>`;
}

type AuthViewRenderOptions = {
  isAdmin: boolean;
  csrfToken: string;
  errorMessage?: string | null;
};

export function renderAuthView(options: AuthViewRenderOptions): string {
  const isAdmin = options.isAdmin;
  const csrfToken = escapeHtml(options.csrfToken);
  const errorMessage =
    typeof options.errorMessage === 'string' && options.errorMessage.length > 0
      ? `<p class="auth-error" role="alert">${escapeHtml(options.errorMessage)}</p>`
      : '';

  const formMarkup = isAdmin
    ? `<p class="auth-status">Admin session is active.</p>
      <form class="auth-form" method="post" action="/auth/logout">
        <input type="hidden" name="csrfToken" value="${csrfToken}" />
        <button class="auth-submit" type="submit">Logout</button>
      </form>`
    : `<p class="auth-status">Enter the admin password to unlock prompt and transcript tools.</p>
      <form class="auth-form" method="post" action="/auth/login">
        <input type="hidden" name="csrfToken" value="${csrfToken}" />
        <label class="auth-label" for="admin-password">Password</label>
        <input
          id="admin-password"
          class="auth-input"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
        <button class="auth-submit" type="submit">Login</button>
      </form>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Auth</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="auth-page">
    <main class="auth-shell">
      <header class="page-header auth-header">
        <h1>Admin Auth</h1>
        <a class="auth-home-link" href="/">Back to games</a>
      </header>
      ${errorMessage}
      ${formMarkup}
    </main>
  </body>
</html>`;
}

type GameViewRenderOptions = {
  enableLiveReload?: boolean;
  isAdmin?: boolean;
  csrfToken?: string;
  isFavorite?: boolean;
};

export function renderGameView(versionId: string, options: GameViewRenderOptions = {}): string {
  const encodedVersionId = encodeURIComponent(versionId);
  const enableLiveReload = options.enableLiveReload ?? false;
  const isAdmin = options.isAdmin ?? false;
  const isFavorite = options.isFavorite === true;
  const csrfToken = isAdmin && typeof options.csrfToken === 'string' ? escapeHtml(options.csrfToken) : null;
  const liveReloadScript = enableLiveReload
    ? '\n    <script type="module" src="/public/game-live-reload.js"></script>'
    : '';
  const bodyClass = isAdmin ? 'game-page game-page--admin' : 'game-page game-page--public';
  const bodyDataAttributes = `${csrfToken
    ? `data-version-id="${escapeHtml(versionId)}" data-csrf-token="${csrfToken}"`
    : `data-version-id="${escapeHtml(versionId)}"`} data-game-favorited="${isFavorite ? 'true' : 'false'}"`;

  const adminPanelsMarkup = isAdmin
    ? `<section id="prompt-panel" class="prompt-panel" aria-hidden="true" aria-label="Create next version prompt">
      <form id="prompt-form" class="prompt-form">
        <input
          id="prompt-input"
          name="prompt"
          type="text"
          autocomplete="off"
          placeholder="Describe the next change"
          enterkeyhint="go"
          required
        />
        <button
          id="game-codex-toggle"
          class="prompt-codex-toggle"
          type="button"
          aria-controls="game-codex-transcript"
          aria-expanded="false"
          aria-label="Toggle Codex transcript"
        >
          <span aria-hidden="true">🤖</span>
        </button>
      </form>
      <section id="game-codex-transcript" class="game-codex-transcript" aria-hidden="true">
        <header class="game-codex-transcript-header">
          <h2>Codex Transcript</h2>
        </header>
        <section id="game-codex-session-view" class="codex-session-view codex-session-view--game" aria-live="polite">
          <p class="codex-empty">Loading transcript...</p>
        </section>
      </section>
    </section>

    <nav class="game-bottom-tabs" aria-label="Game tools">
      <a
        id="game-home-button"
        class="game-home-link"
        href="/"
        aria-label="Back to homepage"
      >
        <span aria-hidden="true">‹</span>
      </a>
      <div class="game-tool-tabs">
        <button
          id="game-tab-edit"
          class="game-view-tab game-view-tab--edit"
          type="button"
          aria-controls="prompt-panel"
          aria-expanded="false"
        >
          <span class="game-view-tab-label">Edit</span>
          <span class="game-view-tab-spinner" aria-hidden="true"></span>
        </button>
        <button
          id="prompt-record-button"
          class="game-view-icon-tab game-view-icon-tab--record"
          type="button"
          aria-label="Start voice recording"
        >
          <svg
            class="game-view-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19v3"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <rect x="9" y="2" width="6" height="13" rx="3"></rect>
          </svg>
        </button>
        <button
          id="game-tab-favorite"
          class="game-view-icon-tab game-view-icon-tab--favorite${isFavorite ? ' game-view-icon-tab--active' : ''}"
          type="button"
          aria-label="${isFavorite ? 'Unfavorite game' : 'Favorite game'}"
          aria-pressed="${isFavorite ? 'true' : 'false'}"
        >
          <svg
            class="game-view-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>
    </nav>`
    : '';

  const gameViewScriptMarkup = isAdmin ? '\n    <script type="module" src="/public/game-view.js"></script>' : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Game ${escapeHtml(versionId)}</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="${bodyClass}" ${bodyDataAttributes}>
    <main class="game-layout${isAdmin ? '' : ' game-layout--public'}">
      <section class="game-stage">
        <div class="game-render-area">
          ${isAdmin ? '<div id="prompt-overlay" class="prompt-overlay" aria-hidden="true"></div>' : ''}
          <canvas id="game-canvas" aria-label="Game canvas"></canvas>
        </div>
      </section>
    </main>

    ${adminPanelsMarkup}

    <script>
      (() => {
        let lastTouchEndAt = 0;

        document.addEventListener(
          'touchend',
          (event) => {
            const now = Date.now();
            if (now - lastTouchEndAt <= 300) {
              event.preventDefault();
            }
            lastTouchEndAt = now;
          },
          { passive: false }
        );

        document.addEventListener(
          'dblclick',
          (event) => {
            event.preventDefault();
          },
          { passive: false }
        );
      })();
    </script>

    <script type="module">
      import { startGame } from '/games/${encodedVersionId}/dist/game.js';
      const canvas = document.getElementById('game-canvas');
      if (canvas instanceof HTMLCanvasElement) {
        startGame(canvas);
      }
    </script>${gameViewScriptMarkup}
${liveReloadScript}
  </body>
</html>`;
}
