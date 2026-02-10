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
        <p>Choose any version to play.</p>
      </header>
      ${content}
    </main>
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
    <canvas id="game-canvas" aria-label="Game canvas"></canvas>

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
      <p id="prompt-status" class="prompt-status" aria-live="polite"></p>
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
