import type { CSSProperties, RefObject } from "react";

import { IconMarkup } from "./IconMarkup";
import type { IdeasBaseGameOption, IdeasIdea, IdeasPageData } from "../types";

const IDEAS_STARTER_VERSION_ID = "starter";

type IdeasAppData = IdeasPageData & {
  baseGameVersionId: string;
};

type IdeasAppProps = {
  data: IdeasAppData;
  onGenerate?: () => void;
  onSelectBaseGame?: (baseGameVersionId: string) => void;
  onToggleBaseGameSelector?: () => void;
  onBuild?: (ideaIndex: number) => void;
  onArchive?: (ideaIndex: number) => void;
  baseGameSelectorRef?: RefObject<HTMLDivElement | null>;
  isBaseGameSelectorOpen?: boolean;
};

function renderIdeasList(
  ideas: readonly IdeasIdea[],
  icons: { build: string; archive: string },
  handlers: { onBuild?: (ideaIndex: number) => void; onArchive?: (ideaIndex: number) => void },
) {
  if (ideas.length === 0) {
    return <p className="codex-empty">No ideas yet. Generate one to get started.</p>;
  }

  return (
    <ul className="ideas-list" role="list">
      {ideas.map((idea, index) => (
        <li key={`${idea.prompt}:${index}`} className="idea-row" data-idea-index={index}>
          <div className="idea-content">
            <span className="idea-prompt">{idea.prompt}</span>
          </div>
          <div className="idea-actions">
            {idea.hasBeenBuilt ? <span className="idea-built-pill" aria-label="Built">Built</span> : null}
            <button
              className="idea-action-button"
              type="button"
              data-action="build"
              data-idea-index={index}
              aria-label="Build from idea"
              onClick={() => handlers.onBuild?.(index)}
            >
              <IconMarkup markup={icons.build} />
            </button>
            <button
              className="idea-action-button idea-action-button--danger"
              type="button"
              data-action="archive"
              data-idea-index={index}
              aria-label="Archive idea"
              onClick={() => handlers.onArchive?.(index)}
            >
              <IconMarkup markup={icons.archive} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function findBaseGameOption(
  options: readonly IdeasBaseGameOption[],
  baseGameVersionId: string,
): IdeasBaseGameOption {
  const selectedOption = options.find((option) => option.id === baseGameVersionId);
  if (selectedOption) {
    return selectedOption;
  }

  return (
    options[0] ?? {
      id: IDEAS_STARTER_VERSION_ID,
      displayName: IDEAS_STARTER_VERSION_ID,
      tileColor: "#1D3557",
      tileSnapshotPath: null,
    }
  );
}

function renderBaseGameTile(
  option: IdeasBaseGameOption,
  imageClassName: string,
  placeholderClassName: string,
) {
  if (option.tileSnapshotPath) {
    return (
      <img
        className={imageClassName}
        src={option.tileSnapshotPath}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      className={placeholderClassName}
      style={{ "--tile-color": option.tileColor } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function ideationGuidanceText(displayName: string, baseGameVersionId: string): string {
  if (baseGameVersionId === IDEAS_STARTER_VERSION_ID) {
    return "Generating from starter creates one creative, single-sentence arcade-style game concept.";
  }

  return `Generating from ${displayName} creates one off-the-wall, single-sentence improvement grounded in current game context.`;
}

export function IdeasApp({
  data,
  onGenerate,
  onSelectBaseGame,
  onToggleBaseGameSelector,
  onBuild,
  onArchive,
  baseGameSelectorRef,
  isBaseGameSelectorOpen,
}: IdeasAppProps) {
  const selectedBaseGameOption = findBaseGameOption(data.baseGameOptions, data.baseGameVersionId);
  const guidanceText = ideationGuidanceText(selectedBaseGameOption.displayName, selectedBaseGameOption.id);

  return (
    <main className="codex-shell">
      <header className="page-header codex-header">
        <h1>Ideas</h1>
        <a className="codex-home-link" href="/">
          Back to games
        </a>
      </header>
      <section className="ideas-controls">
        <div ref={baseGameSelectorRef} className="ideas-base-game-selector">
          <button
            id="ideas-base-game-toggle"
            className="ideas-base-game-toggle"
            type="button"
            aria-label="Select base game"
            aria-expanded={isBaseGameSelectorOpen ? "true" : "false"}
            aria-haspopup="listbox"
            aria-controls="ideas-base-game-listbox"
            onClick={onToggleBaseGameSelector}
          >
            {renderBaseGameTile(
              selectedBaseGameOption,
              "ideas-base-game-toggle-image",
              "ideas-base-game-toggle-image ideas-base-game-toggle-image--placeholder",
            )}
            <span className="ideas-base-game-toggle-name">{selectedBaseGameOption.displayName}</span>
          </button>
          {isBaseGameSelectorOpen ? (
            <ul id="ideas-base-game-listbox" className="ideas-base-game-options" role="listbox">
              {data.baseGameOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`ideas-base-game-option${option.id === selectedBaseGameOption.id ? " ideas-base-game-option--selected" : ""}`}
                    role="option"
                    aria-selected={option.id === selectedBaseGameOption.id ? "true" : "false"}
                    onClick={() => onSelectBaseGame?.(option.id)}
                  >
                    {renderBaseGameTile(
                      option,
                      "ideas-base-game-option-image",
                      "ideas-base-game-option-image ideas-base-game-option-image--placeholder",
                    )}
                    <span className="ideas-base-game-option-name">{option.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          id="ideas-generate-button"
          className={`ideas-generate-button${data.isGenerating ? " ideas-generate-button--generating" : ""}`}
          type="button"
          aria-label="Generate idea"
          aria-busy={data.isGenerating ? "true" : "false"}
          onClick={onGenerate}
        >
          <IconMarkup markup={data.lightbulbIdeaIcon} />
          <span>Generate</span>
          <span className="ideas-generate-spinner" aria-hidden="true"></span>
        </button>
      </section>
      <p className="ideas-guidance">{guidanceText}</p>
      <section id="ideas-list-root" aria-live="polite">
        {renderIdeasList(
          data.ideas,
          { build: data.rocketIdeaIcon, archive: data.archiveIdeaIcon },
          { onBuild, onArchive },
        )}
      </section>
    </main>
  );
}
