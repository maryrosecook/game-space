import type { CodexMessage, IdeasIdea } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIdeasIdea(value: unknown): value is IdeasIdea {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.prompt === "string" && (value.hasBeenBuilt === true || value.hasBeenBuilt === false);
}

function readIdeas(value: unknown): IdeasIdea[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ideas: IdeasIdea[] = [];
  for (const entry of value) {
    if (!isIdeasIdea(entry)) {
      return null;
    }

    ideas.push({
      prompt: entry.prompt,
      hasBeenBuilt: entry.hasBeenBuilt,
    });
  }

  return ideas;
}

function isCodexMessage(value: unknown): value is CodexMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (value.role === "user" || value.role === "assistant") && typeof value.text === "string";
}

function readCodexMessages(value: unknown): CodexMessage[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages: CodexMessage[] = [];
  for (const entry of value) {
    if (!isCodexMessage(entry)) {
      continue;
    }

    messages.push({
      role: entry.role,
      text: entry.text,
    });
  }

  return messages;
}

async function readJsonPayload(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export type CodexSessionResult =
  | { kind: "ok"; sessionId: string; messages: readonly CodexMessage[] }
  | { kind: "no-session" }
  | { kind: "session-file-missing" }
  | { kind: "invalid" };

export async function fetchCodexSession(versionId: string): Promise<{ ok: boolean; status: number; result: CodexSessionResult }> {
  let response: Response;
  try {
    response = await fetch(`/api/codex-sessions/${encodeURIComponent(versionId)}`);
  } catch {
    return {
      ok: false,
      status: 0,
      result: { kind: "invalid" },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      result: { kind: "invalid" },
    };
  }

  const payload = await readJsonPayload(response);
  if (!isRecord(payload) || typeof payload.status !== "string") {
    return {
      ok: true,
      status: response.status,
      result: { kind: "invalid" },
    };
  }

  if (payload.status === "no-session") {
    return {
      ok: true,
      status: response.status,
      result: { kind: "no-session" },
    };
  }

  if (payload.status === "session-file-missing") {
    return {
      ok: true,
      status: response.status,
      result: { kind: "session-file-missing" },
    };
  }

  if (payload.status !== "ok" || typeof payload.sessionId !== "string") {
    return {
      ok: true,
      status: response.status,
      result: { kind: "invalid" },
    };
  }

  const messages = readCodexMessages(payload.messages);
  if (messages === null) {
    return {
      ok: true,
      status: response.status,
      result: { kind: "invalid" },
    };
  }

  return {
    ok: true,
    status: response.status,
    result: {
      kind: "ok",
      sessionId: payload.sessionId,
      messages,
    },
  };
}

function csrfHeaders(csrfToken: string): HeadersInit {
  return csrfToken.length > 0 ? { "X-CSRF-Token": csrfToken } : {};
}

export async function fetchIdeas(csrfToken: string): Promise<{ ok: boolean; status: number; ideas: IdeasIdea[] | null; isGenerating: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/ideas", {
      headers: csrfHeaders(csrfToken),
    });
  } catch {
    return { ok: false, status: 0, ideas: null, isGenerating: false };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, ideas: null, isGenerating: false };
  }

  const payload = await readJsonPayload(response);
  if (!isRecord(payload)) {
    return { ok: true, status: response.status, ideas: null, isGenerating: false };
  }

  return {
    ok: true,
    status: response.status,
    ideas: readIdeas(payload.ideas),
    isGenerating: payload.isGenerating === true,
  };
}

export async function generateIdea(csrfToken: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; ideas: IdeasIdea[] | null }> {
  let response: Response;
  try {
    response = await fetch("/api/ideas/generate", {
      method: "POST",
      headers: csrfHeaders(csrfToken),
      signal,
    });
  } catch {
    return { ok: false, status: 0, ideas: null };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, ideas: null };
  }

  const payload = await readJsonPayload(response);
  if (!isRecord(payload)) {
    return { ok: true, status: response.status, ideas: null };
  }

  return {
    ok: true,
    status: response.status,
    ideas: readIdeas(payload.ideas),
  };
}

export async function deleteIdea(csrfToken: string, ideaIndex: number): Promise<{ ok: boolean; status: number; ideas: IdeasIdea[] | null }> {
  let response: Response;
  try {
    response = await fetch(`/api/ideas/${encodeURIComponent(String(ideaIndex))}`, {
      method: "DELETE",
      headers: csrfHeaders(csrfToken),
    });
  } catch {
    return { ok: false, status: 0, ideas: null };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, ideas: null };
  }

  const payload = await readJsonPayload(response);
  if (!isRecord(payload)) {
    return { ok: true, status: response.status, ideas: null };
  }

  return {
    ok: true,
    status: response.status,
    ideas: readIdeas(payload.ideas),
  };
}

export async function buildIdea(
  csrfToken: string,
  ideaIndex: number,
): Promise<{ ok: boolean; status: number; ideas: IdeasIdea[] | null; forkId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`/api/ideas/${encodeURIComponent(String(ideaIndex))}/build`, {
      method: "POST",
      headers: {
        ...csrfHeaders(csrfToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } catch {
    return { ok: false, status: 0, ideas: null, forkId: null };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, ideas: null, forkId: null };
  }

  const payload = await readJsonPayload(response);
  if (!isRecord(payload)) {
    return { ok: true, status: response.status, ideas: null, forkId: null };
  }

  const forkId = typeof payload.forkId === "string" && payload.forkId.length > 0 ? payload.forkId : null;
  return {
    ok: true,
    status: response.status,
    ideas: readIdeas(payload.ideas),
    forkId,
  };
}
