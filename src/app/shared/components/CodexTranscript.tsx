import type { CodexTranscriptState } from "../types";

type CodexTranscriptProps = {
  transcriptTitle: string;
  state: CodexTranscriptState;
};

function formatRole(role: "user" | "assistant"): string {
  return role === "assistant" ? "Assistant" : "User";
}

export function CodexTranscript({ transcriptTitle, state }: CodexTranscriptProps) {
  if (state.kind === "loading") {
    return (
      <div className="codex-empty-shell">
        <h2 className="codex-empty-title">Loading transcript</h2>
        <p className="codex-empty">Reading {transcriptTitle} data...</p>
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="codex-empty-shell">
        <h2 className="codex-empty-title">{state.title}</h2>
        <p className="codex-empty">{state.description}</p>
      </div>
    );
  }

  const visibleMessages = state.messages.filter((message) => message.role === "user" || message.role === "assistant");
  if (visibleMessages.length === 0) {
    return (
      <div className="codex-empty-shell">
        <h2 className="codex-empty-title">No visible messages</h2>
        <p className="codex-empty">This session has no visible message or event entries yet.</p>
      </div>
    );
  }

  return (
    <>
      <header className="codex-session-header">
        <h2>{transcriptTitle}</h2>
        <code className="codex-session-id">{state.sessionId}</code>
      </header>
      <div className="codex-thread">
        {visibleMessages.map((message, index) => (
          <article key={`${message.role}:${index}`} className={`codex-message codex-message--${message.role}`}>
            <div className="codex-message-role">{formatRole(message.role)}</div>
            <pre className="codex-message-text">{message.text}</pre>
          </article>
        ))}
      </div>
    </>
  );
}
