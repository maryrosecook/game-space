import { IconMarkup } from "./IconMarkup";
import type { GamePageData } from "../types";

type GameAppProps = {
  data: GamePageData;
};

export function GameApp({ data }: GameAppProps) {
  const providerSessionLabel = `Toggle ${data.providerLabel} session`;

  const gameToolbarMarkup = (
    <nav className="game-bottom-tabs" aria-label="Game tools">
      <a id="game-home-button" className="game-home-link" href="/" aria-label="Back to homepage">
        <IconMarkup markup={data.homeIcon} />
      </a>
      {data.isAdmin ? (
        <div className="game-toolbar-main">
          <div className="game-tool-tabs">
            <button
              id="game-tab-edit"
              className="game-view-tab game-view-tab--edit"
              type="button"
              aria-controls="prompt-panel"
              aria-expanded="false"
            >
              <IconMarkup markup={data.settingsIcon} />
              <span className="game-view-tab-spinner" aria-hidden="true"></span>
            </button>
            <button
              id="prompt-record-button"
              className="game-view-icon-tab game-view-icon-tab--record"
              type="button"
              aria-label="Start voice recording"
            >
              <IconMarkup markup={data.micIcon} />
              <span className="game-view-icon-tab-label">Describe a change</span>
            </button>
          </div>
          <div id="prompt-overlay" className="prompt-overlay" aria-hidden="true" aria-live="polite"></div>
        </div>
      ) : null}
    </nav>
  );

  return (
    <>
      <div className="game-top-strip" aria-hidden="true"></div>
      <main className={`game-layout${data.isAdmin ? "" : " game-layout--public"}`}>
        <section className="game-stage">
          <div className="game-render-area">
            {data.isAdmin ? (
              <canvas id="prompt-drawing-canvas" className="prompt-drawing-canvas" aria-hidden="true"></canvas>
            ) : null}
            <canvas id="game-canvas" aria-label="Game canvas"></canvas>
          </div>
        </section>
      </main>

      {data.isAdmin ? (
        <>
          <section id="prompt-panel" className="prompt-panel" aria-hidden="true" aria-label="Create next version prompt">
            <form id="prompt-form" className="prompt-form">
              <textarea
                id="prompt-input"
                name="prompt"
                autoComplete="off"
                placeholder="Describe the next change"
                rows={1}
                required
              ></textarea>
              <div className="prompt-action-row">
                <button
                  id="prompt-submit-button"
                  className="prompt-action-button"
                  type="submit"
                  aria-label="Build prompt"
                >
                  <IconMarkup markup={data.rocketIcon} />
                  <span>Build</span>
                </button>
                <button
                  id="game-tab-favorite"
                  className={`prompt-action-button prompt-action-button--icon game-view-icon-tab--favorite${data.isFavorite ? " game-view-icon-tab--active" : ""}`}
                  type="button"
                  aria-label={data.isFavorite ? "Unfavorite game" : "Favorite game"}
                  aria-pressed={data.isFavorite ? "true" : "false"}
                >
                  <IconMarkup markup={data.starIcon} />
                </button>
                <button
                  id="game-codex-toggle"
                  className="prompt-action-button prompt-action-button--icon"
                  type="button"
                  aria-controls="game-codex-transcript"
                  aria-expanded="false"
                  aria-label={providerSessionLabel}
                >
                  <IconMarkup markup={data.botIcon} />
                </button>
                <button
                  id="game-tab-capture-tile"
                  className="prompt-action-button prompt-action-button--icon prompt-action-button--tile-capture"
                  type="button"
                  aria-label="Capture homepage tile snapshot"
                >
                  <IconMarkup markup={data.videoIcon} />
                </button>
                <button
                  id="game-tab-delete"
                  className="prompt-action-button prompt-action-button--icon"
                  type="button"
                  aria-label="Delete game"
                >
                  <IconMarkup markup={data.trashIcon} />
                </button>
              </div>
            </form>
            <section id="game-codex-transcript" className="game-codex-transcript" aria-hidden="true">
              <header className="game-codex-transcript-header">
                <h2>{data.providerLabel} Transcript</h2>
              </header>
              <section
                id="game-codex-session-view"
                className="codex-session-view codex-session-view--game"
                aria-live="polite"
              >
                <p className="codex-empty">Loading transcript...</p>
              </section>
            </section>
          </section>
          {gameToolbarMarkup}
        </>
      ) : (
        gameToolbarMarkup
      )}
    </>
  );
}
