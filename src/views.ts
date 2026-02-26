import {
  Bot,
  ChevronLeft,
  Lightbulb,
  Mic,
  Rocket,
  Settings,
  Star,
  Trash2,
  Video,
  type IconNode
} from 'lucide';
import type { GameVersion } from './types';
import type { CodegenProvider } from './services/codegenConfig';

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

function codegenProviderLabel(codegenProvider: CodegenProvider): string {
  return codegenProvider === 'claude' ? 'Claude' : 'Codex';
}

type LucideIconName =
  | 'bot'
  | 'chevron-left'
  | 'lightbulb'
  | 'mic'
  | 'rocket'
  | 'settings'
  | 'star'
  | 'trash-2'
  | 'video';

const LUCIDE_ICON_NODES: Record<LucideIconName, IconNode> = {
  bot: Bot,
  'chevron-left': ChevronLeft,
  lightbulb: Lightbulb,
  mic: Mic,
  rocket: Rocket,
  settings: Settings,
  star: Star,
  'trash-2': Trash2,
  video: Video
};

function renderLucideNode(iconNode: IconNode): string {
  return iconNode
    .map(([tagName, attributes]) => {
      const serializedAttributes = Object.entries(attributes)
        .filter(([, attributeValue]) => attributeValue !== undefined)
        .map(([attributeName, attributeValue]) => `${attributeName}="${escapeHtml(String(attributeValue))}"`)
        .join(' ');
      return serializedAttributes.length > 0
        ? `<${tagName} ${serializedAttributes}></${tagName}>`
        : `<${tagName}></${tagName}>`;
    })
    .join('');
}

function renderLucideIcon(iconName: LucideIconName, className: string, size: number = 18): string {
  return `<svg class="${className} lucide lucide-${iconName}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${renderLucideNode(LUCIDE_ICON_NODES[iconName])}</svg>`;
}

type HomepageRenderOptions = {
  isAdmin?: boolean;
};

export function renderHomepage(versions: readonly GameVersion[], options: HomepageRenderOptions = {}): string {
  const isAdmin = options.isAdmin ?? false;
  const authLabel = isAdmin ? 'Admin' : 'Login';
  const ideasLink = isAdmin ? '<a class="auth-link" href="/ideas">Ideas</a>' : '';
  const tiles = versions
    .map((version) => {
      const id = escapeHtml(version.id);
      const tileName = version.threeWords ?? version.id;
      const displayId = escapeHtml(tileName.replaceAll('-', ' '));
      const tileColor = typeof version.tileColor === 'string' ? version.tileColor : '#1D3557';
      const tileColorEscaped = escapeHtml(tileColor);
      const favoriteClassName = version.favorite === true ? ' game-tile--favorite' : '';
      const tileSnapshotPath =
        typeof version.tileSnapshotPath === 'string' && version.tileSnapshotPath.length > 0
          ? escapeHtml(version.tileSnapshotPath)
          : null;
      const tileMedia = tileSnapshotPath
        ? `<img class="tile-image" src="${tileSnapshotPath}" alt="${displayId}" loading="lazy" decoding="async" />`
        : '<span class="tile-image tile-image--placeholder" aria-hidden="true"></span>';
      return `
        <a class="game-tile${favoriteClassName}" href="/game/${encodeURIComponent(version.id)}" data-version-id="${id}" data-tile-color="${tileColorEscaped}" style="--tile-color: ${tileColorEscaped};">
          ${tileMedia}
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
        <div class="page-header-links">
          ${ideasLink}
          <a class="auth-link" href="/auth">${authLabel}</a>
        </div>
      </header>
      ${content}
    </main>
  </body>
</html>`;
}

type IdeasViewIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
};

function renderIdeasList(ideas: readonly IdeasViewIdea[]): string {
  if (ideas.length === 0) {
    return '<p class="codex-empty">No ideas yet. Generate one to get started.</p>';
  }

  return `<ul class="ideas-list" role="list">${ideas
    .map((idea, index) => {
      const prompt = escapeHtml(idea.prompt);
      const builtBadge = idea.hasBeenBuilt
        ? '<span class="idea-built-pill" aria-label="Built">Built</span>'
        : '';
      return `<li class="idea-row" data-idea-index="${index}">
        <div class="idea-content">
          <span class="idea-prompt">${prompt}</span>
        </div>
        <div class="idea-actions">
          ${builtBadge}
          <button class="idea-action-button" type="button" data-action="build" data-idea-index="${index}" aria-label="Build from idea">
            ${renderLucideIcon('rocket', 'idea-icon')}
          </button>
          <button class="idea-action-button idea-action-button--danger" type="button" data-action="delete" data-idea-index="${index}" aria-label="Delete idea">
            ${renderLucideIcon('trash-2', 'idea-icon')}
          </button>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

export function renderIdeasView(
  ideas: readonly IdeasViewIdea[],
  csrfToken: string,
  isGenerating: boolean = false,
): string {
  const rocketIdeaIcon = renderLucideIcon('rocket', 'idea-icon');
  const trashIdeaIcon = renderLucideIcon('trash-2', 'idea-icon');
  const generatingClass = isGenerating
    ? " ideas-generate-button--generating"
    : "";
  const generatingBusyState = isGenerating ? "true" : "false";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ideas</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="codex-page" data-csrf-token="${escapeHtml(csrfToken)}" data-idea-build-icon="${escapeHtml(rocketIdeaIcon)}" data-idea-delete-icon="${escapeHtml(trashIdeaIcon)}">
    <main class="codex-shell">
      <header class="page-header codex-header">
        <h1>Ideas</h1>
        <a class="codex-home-link" href="/">Back to games</a>
      </header>
      <section class="ideas-controls">
        <button id="ideas-generate-button" class="ideas-generate-button${generatingClass}" type="button" aria-label="Generate idea" aria-busy="${generatingBusyState}">
          ${renderLucideIcon('lightbulb', 'idea-icon')}
          <span>Generate</span>
          <span class="ideas-generate-spinner" aria-hidden="true"></span>
        </button>
      </section>
      <section id="ideas-list-root" aria-live="polite">
        ${renderIdeasList(ideas)}
      </section>
    </main>
    <script type="module" src="/public/ideas-view.js"></script>
  </body>
</html>`;
}

export function renderCodexView(
  versions: readonly GameVersion[],
  codegenProvider: CodegenProvider = 'codex'
): string {
  const providerLabel = codegenProviderLabel(codegenProvider);
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
    <title>Codex/Claude Sessions</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="codex-page" data-codegen-provider="${escapeHtml(codegenProvider)}">
    <main class="codex-shell">
      <header class="page-header codex-header">
        <h1>Codex/Claude Sessions</h1>
        <a class="codex-home-link" href="/">Back to games</a>
      </header>
      <section class="codex-controls">
        <label class="codex-label" for="codex-game-select">Game version</label>
        ${selectorContent}
      </section>
      <section id="codex-session-view" class="codex-session-view" aria-live="polite">
        <p class="codex-empty">Select a game version to inspect its ${providerLabel} transcript.</p>
      </section>
    </main>
    <script type="module" src="/public/codex-view.js"></script>
  </body>
</html>`;
}

type AuthViewRenderOptions = {
  isAdmin: boolean;
  csrfToken: string;
  codegenProvider: CodegenProvider;
  claudeModel: string;
  claudeThinking: string;
  errorMessage?: string | null;
};

export function renderAuthView(options: AuthViewRenderOptions): string {
  const isAdmin = options.isAdmin;
  const csrfToken = escapeHtml(options.csrfToken);
  const codegenProvider = options.codegenProvider;
  const claudeModel = escapeHtml(options.claudeModel);
  const claudeThinking = escapeHtml(options.claudeThinking);
  const errorMessage =
    typeof options.errorMessage === 'string' && options.errorMessage.length > 0
      ? `<p class="auth-error" role="alert">${escapeHtml(options.errorMessage)}</p>`
      : '';

  const providerStatus = codegenProvider === 'claude'
    ? `<p class="auth-provider-active">Active provider: Claude</p>
      <p class="auth-provider-active">Active model: ${claudeModel}</p>
      <p class="auth-provider-active">Thinking mode: ${claudeThinking}</p>`
    : `<p class="auth-provider-active">Active provider: Codex</p>
      <p class="auth-provider-active">Active model: managed by Codex CLI</p>`;

  const providerForm = `<form class="auth-form auth-form--provider" method="post" action="/auth/provider">
        <input type="hidden" name="csrfToken" value="${csrfToken}" />
        <label class="auth-label" for="codegen-provider">Codegen provider</label>
        <select id="codegen-provider" class="auth-input auth-select" name="provider">
          <option value="codex"${codegenProvider === 'codex' ? ' selected' : ''}>Codex</option>
          <option value="claude"${codegenProvider === 'claude' ? ' selected' : ''}>Claude</option>
        </select>
        <button class="auth-submit" type="submit">Save provider</button>
      </form>`;

  const formMarkup = isAdmin
    ? `<p class="auth-status">Admin session is active.</p>
      ${providerStatus}
      ${providerForm}
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
  tileColor?: string;
  codegenProvider?: CodegenProvider;
};

export function renderGameView(versionId: string, options: GameViewRenderOptions = {}): string {
  const encodedVersionId = encodeURIComponent(versionId);
  const enableLiveReload = options.enableLiveReload ?? false;
  const isAdmin = options.isAdmin ?? false;
  const isFavorite = options.isFavorite === true;
  const tileColor = typeof options.tileColor === 'string' ? options.tileColor : '#1D3557';
  const codegenProvider = options.codegenProvider ?? 'codex';
  const providerLabel = codegenProviderLabel(codegenProvider);
  const csrfToken = isAdmin && typeof options.csrfToken === 'string' ? escapeHtml(options.csrfToken) : null;
  const liveReloadScript = enableLiveReload
    ? '\n    <script type="module" src="/public/game-live-reload.js"></script>'
    : '';
  const bodyClass = isAdmin ? 'game-page game-page--admin' : 'game-page game-page--public';
  const bodyDataAttributes = `${csrfToken
    ? `data-version-id="${escapeHtml(versionId)}" data-csrf-token="${csrfToken}"`
    : `data-version-id="${escapeHtml(versionId)}"`} data-game-favorited="${isFavorite ? 'true' : 'false'}" data-codegen-provider="${escapeHtml(codegenProvider)}"`;

  const gameToolbarMarkup = `<nav class="game-bottom-tabs" aria-label="Game tools">
      <a
        id="game-home-button"
        class="game-home-link"
        href="/"
        aria-label="Back to homepage"
      >
        ${renderLucideIcon('chevron-left', 'game-view-icon', 22)}
      </a>
      ${isAdmin
        ? `<div class="game-toolbar-main">
      <div class="game-tool-tabs">
        <button
          id="game-tab-edit"
          class="game-view-tab game-view-tab--edit"
          type="button"
          aria-controls="prompt-panel"
          aria-expanded="false"
        >
          ${renderLucideIcon('settings', 'game-view-icon')}
          <span class="game-view-tab-spinner" aria-hidden="true"></span>
        </button>
        <button
          id="prompt-record-button"
          class="game-view-icon-tab game-view-icon-tab--record"
          type="button"
          aria-label="Start voice recording"
        >
          ${renderLucideIcon('mic', 'game-view-icon')}
        </button>
        <button
          id="game-tab-capture-tile"
          class="game-view-icon-tab game-view-icon-tab--tile-capture"
          type="button"
          aria-label="Capture homepage tile snapshot"
        >
          ${renderLucideIcon('video', 'game-view-icon')}
        </button>
      </div>
      <div id="prompt-overlay" class="prompt-overlay" aria-hidden="true" aria-live="polite"></div>
    </div>`
        : ''}
    </nav>`;

  const adminPanelsMarkup = isAdmin
    ? `<section id="prompt-panel" class="prompt-panel" aria-hidden="true" aria-label="Create next version prompt">
      <form id="prompt-form" class="prompt-form">
        <textarea
          id="prompt-input"
          name="prompt"
          autocomplete="off"
          placeholder="Describe the next change"
          rows="1"
          required
        ></textarea>
        <div class="prompt-action-row">
          <button
            id="prompt-submit-button"
            class="prompt-action-button"
            type="submit"
            aria-label="Build prompt"
          >
            ${renderLucideIcon('rocket', 'game-view-icon')}
            <span>Build</span>
          </button>
          <button
            id="game-tab-favorite"
            class="prompt-action-button prompt-action-button--icon game-view-icon-tab--favorite${isFavorite ? ' game-view-icon-tab--active' : ''}"
            type="button"
            aria-label="${isFavorite ? 'Unfavorite game' : 'Favorite game'}"
            aria-pressed="${isFavorite ? 'true' : 'false'}"
          >
            ${renderLucideIcon('star', 'game-view-icon')}
          </button>
          <button
            id="game-codex-toggle"
            class="prompt-action-button prompt-action-button--icon"
            type="button"
            aria-controls="game-codex-transcript"
            aria-expanded="false"
            aria-label="Toggle ${providerLabel} session"
          >
            ${renderLucideIcon('bot', 'game-view-icon')}
          </button>
          <button
            id="game-tab-delete"
            class="prompt-action-button prompt-action-button--icon"
            type="button"
            aria-label="Delete game"
          >
            ${renderLucideIcon('trash-2', 'game-view-icon')}
          </button>
        </div>
      </form>
      <section id="game-codex-transcript" class="game-codex-transcript" aria-hidden="true">
        <header class="game-codex-transcript-header">
          <h2>${providerLabel} Transcript</h2>
        </header>
        <section id="game-codex-session-view" class="codex-session-view codex-session-view--game" aria-live="polite">
          <p class="codex-empty">Loading transcript...</p>
        </section>
      </section>
    </section>
    ${gameToolbarMarkup}`
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
  <body class="${bodyClass}" ${bodyDataAttributes} style="--game-tile-color: ${escapeHtml(tileColor)};">
    <div class="game-top-strip" aria-hidden="true"></div>
    <main class="game-layout${isAdmin ? '' : ' game-layout--public'}">
      <section class="game-stage">
        <div class="game-render-area">
          ${isAdmin ? '<canvas id="prompt-drawing-canvas" class="prompt-drawing-canvas" aria-hidden="true"></canvas>' : ''}
          <canvas id="game-canvas" aria-label="Game canvas"></canvas>
        </div>
      </section>
    </main>

    ${isAdmin ? adminPanelsMarkup : gameToolbarMarkup}

    <script>
      (() => {
        let lastTouchEndAt = 0;

        const isTextEntryTarget = (target) =>
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);

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

        document.addEventListener(
          'selectstart',
          (event) => {
            if (isTextEntryTarget(event.target)) {
              return;
            }

            event.preventDefault();
          },
          { passive: false }
        );

        document.addEventListener(
          'contextmenu',
          (event) => {
            if (isTextEntryTarget(event.target)) {
              return;
            }

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
