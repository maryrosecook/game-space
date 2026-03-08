import { CodexTranscript } from "./CodexTranscript";
import type { CodexPageData } from "../types";

type CodexAppProps = {
  data: CodexPageData;
  onVersionChange?: (versionId: string) => void;
};

function codegenProviderLabel(codegenProvider: "codex" | "claude"): string {
  return codegenProvider === "claude" ? "Claude" : "Codex";
}

export function CodexApp({ data, onVersionChange }: CodexAppProps) {
  const providerLabel = codegenProviderLabel(data.codegenProvider);
  const hasVersions = data.versions.length > 0;
  const transcriptTitle = `${providerLabel} Transcript`;

  return (
    <main className="codex-shell">
      <header className="page-header codex-header">
        <h1>Codex/Claude Sessions</h1>
        <a className="codex-home-link" href="/">
          Back to games
        </a>
      </header>
      <section className="codex-controls">
        <label className="codex-label" htmlFor="codex-game-select">
          Game version
        </label>
        {hasVersions ? (
          <select
            id="codex-game-select"
            className="codex-select"
            name="versionId"
            value={data.initialSelectedVersionId ?? ""}
            onChange={(event) => {
              onVersionChange?.(event.currentTarget.value);
            }}
          >
            {data.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.id} ({version.createdLabel})
              </option>
            ))}
          </select>
        ) : (
          <p className="codex-empty">No game versions are available yet.</p>
        )}
      </section>
      <section id="codex-session-view" className="codex-session-view" aria-live="polite">
        {hasVersions ? (
          <CodexTranscript transcriptTitle={transcriptTitle} state={data.initialTranscript} />
        ) : (
          <div className="codex-empty-shell">
            <h2 className="codex-empty-title">No versions available</h2>
            <p className="codex-empty">
              Create a game version to inspect {providerLabel} session transcripts.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
