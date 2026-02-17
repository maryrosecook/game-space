import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';

import { hasErrorCode, isObjectRecord } from './fsUtils';

export type CodexTranscriptRole = 'user' | 'assistant';

export type CodexTranscriptMessage = {
  role: CodexTranscriptRole;
  text: string;
  timestamp: string | null;
};

export type CodexTaskLifecycleState = 'started' | 'terminal';

export type CodexTaskLifecycleEvent = {
  state: CodexTaskLifecycleState;
  timestamp: string | null;
};

const TERMINAL_TASK_EVENT_TYPES = new Set<string>([
  'task_complete',
  'task_failed',
  'task_error',
  'task_cancelled',
  'task_canceled'
]);

function isTranscriptRole(value: unknown): value is CodexTranscriptRole {
  return value === 'user' || value === 'assistant';
}

function normalizeMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  const segments: string[] = [];
  for (const item of content) {
    if (!isObjectRecord(item)) {
      continue;
    }

    if (!('type' in item) || !('text' in item)) {
      continue;
    }

    const itemType = item.type;
    const itemText = item.text;
    if (
      (itemType === 'input_text' || itemType === 'output_text') &&
      typeof itemText === 'string' &&
      itemText.trim().length > 0
    ) {
      segments.push(itemText);
    }
  }

  return segments.join('\n\n').trim();
}

export function parseCodexResponseMessageEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  if (!isObjectRecord(rawEvent) || rawEvent.type !== 'response_item' || !('payload' in rawEvent)) {
    return null;
  }

  const payload = rawEvent.payload;
  if (!isObjectRecord(payload) || payload.type !== 'message') {
    return null;
  }

  if (!isTranscriptRole(payload.role)) {
    return null;
  }

  const text = normalizeMessageText(payload.content);
  if (text.length === 0) {
    return null;
  }

  return {
    role: payload.role,
    text,
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
  };
}

export function parseCodexTaskLifecycleEvent(rawEvent: unknown): CodexTaskLifecycleEvent | null {
  if (!isObjectRecord(rawEvent) || rawEvent.type !== 'event_msg' || !('payload' in rawEvent)) {
    return null;
  }

  const payload = rawEvent.payload;
  if (!isObjectRecord(payload) || typeof payload.type !== 'string') {
    return null;
  }

  if (payload.type === 'task_started') {
    return {
      state: 'started',
      timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
    };
  }

  if (!TERMINAL_TASK_EVENT_TYPES.has(payload.type)) {
    return null;
  }

  return {
    state: 'terminal',
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
  };
}

export function parseCodexTranscriptJsonl(jsonlText: string): CodexTranscriptMessage[] {
  const messages: CodexTranscriptMessage[] = [];
  const lines = jsonlText.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    const message = parseCodexResponseMessageEvent(parsedLine);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

function hasMatchingSessionSuffix(fileName: string, sessionId: string): boolean {
  return fileName.endsWith(`-${sessionId}.jsonl`);
}

export async function findCodexSessionFilePath(
  sessionsRootPath: string,
  sessionId: string
): Promise<string | null> {
  if (sessionId.trim().length === 0) {
    return null;
  }

  const pendingDirectories: string[] = [sessionsRootPath];

  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop();
    if (!directoryPath) {
      continue;
    }

    let directoryEntries: Dirent[];
    try {
      directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error: unknown) {
      if (hasErrorCode(error, 'ENOENT')) {
        if (directoryPath === sessionsRootPath) {
          return null;
        }

        continue;
      }

      throw error;
    }

    for (const entry of directoryEntries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (entry.isFile() && hasMatchingSessionSuffix(entry.name, sessionId)) {
        return entryPath;
      }
    }
  }

  return null;
}

export async function readCodexTranscriptBySessionId(
  sessionsRootPath: string,
  sessionId: string
): Promise<CodexTranscriptMessage[] | null> {
  const sessionFilePath = await findCodexSessionFilePath(sessionsRootPath, sessionId);
  if (!sessionFilePath) {
    return null;
  }

  let jsonlText: string;
  try {
    jsonlText = await fs.readFile(sessionFilePath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }

  return parseCodexTranscriptJsonl(jsonlText);
}
