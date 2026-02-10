import type { GameVersion } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function renderHomepage(versions: readonly GameVersion[]): string {
  const tiles = versions
    .map((version) => {
      const id = escapeHtml(version.id);
      const createdTime = escapeHtml(version.createdTime);
      return `
        <a class="game-tile" href="/game/${encodeURIComponent(version.id)}" data-version-id="${id}" data-created-time="${createdTime}">
          <span class="tile-id">${id}</span>
          <span class="tile-created">${escapeHtml(formatDate(version.createdTime))}</span>
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
    <title>Game Space</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="homepage">
    <main class="homepage-shell">
      <header class="page-header">
        <h1>Game Space</h1>
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
      const createdLabel = escapeHtml(formatDate(version.createdTime));
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

export function renderGameView(versionId: string): string {
  const encodedVersionId = encodeURIComponent(versionId);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Game ${escapeHtml(versionId)}</title>
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body class="game-page" data-version-id="${escapeHtml(versionId)}">
    <main class="game-layout">
      <section class="game-stage">
        <div class="game-render-area">
          <canvas id="game-canvas" aria-label="Game canvas"></canvas>
        </div>
      </section>
      <aside class="game-codex-panel" aria-label="Codex transcript for this game">
        <header class="game-codex-panel-header">
          <h2>Codex Transcript</h2>
        </header>
        <section id="game-codex-session-view" class="codex-session-view codex-session-view--game" aria-live="polite">
          <p class="codex-empty">Loading transcript...</p>
        </section>
      </aside>
    </main>

    <button id="edit-button" class="edit-button" type="button" aria-label="Open prompt panel">✏️</button>

    <section id="prompt-panel" class="prompt-panel" aria-hidden="true">
      <div class="prompt-panel-header">
        <h2>Create Next Version</h2>
        <button id="prompt-close" class="prompt-close" type="button" aria-label="Close prompt panel">×</button>
      </div>
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
      </form>
    </section>

    <script type="module">
      import { startGame } from '/games/${encodedVersionId}/dist/game.js';
      const canvas = document.getElementById('game-canvas');
      if (canvas instanceof HTMLCanvasElement) {
        startGame(canvas);
      }
    </script>
    <script type="module" src="/public/game-view.js"></script>
  </body>
</html>`;
}
