import { IconMarkup } from "./IconMarkup";
import type { IdeasIdea, IdeasPageData } from "../types";

type IdeasAppProps = {
  data: IdeasPageData;
  onGenerate?: () => void;
  onBuild?: (ideaIndex: number) => void;
  onDelete?: (ideaIndex: number) => void;
};

function renderIdeasList(
  ideas: readonly IdeasIdea[],
  icons: { build: string; remove: string },
  handlers: { onBuild?: (ideaIndex: number) => void; onDelete?: (ideaIndex: number) => void },
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
              data-action="delete"
              data-idea-index={index}
              aria-label="Delete idea"
              onClick={() => handlers.onDelete?.(index)}
            >
              <IconMarkup markup={icons.remove} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function IdeasApp({ data, onGenerate, onBuild, onDelete }: IdeasAppProps) {
  return (
    <main className="codex-shell">
      <header className="page-header codex-header">
        <h1>Ideas</h1>
        <a className="codex-home-link" href="/">
          Back to games
        </a>
      </header>
      <section className="ideas-controls">
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
      <section id="ideas-list-root" aria-live="polite">
        {renderIdeasList(
          data.ideas,
          { build: data.rocketIdeaIcon, remove: data.trashIdeaIcon },
          { onBuild, onDelete },
        )}
      </section>
    </main>
  );
}
