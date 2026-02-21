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
const MAX_EVENT_PREVIEW_LINES = 6;
const MAX_EVENT_PREVIEW_CHARS = 800;

type SessionsRootPathInput = string | readonly string[];

function isTranscriptRole(value: unknown): value is CodexTranscriptRole {
  return value === 'user' || value === 'assistant';
}

function normalizeCodexMessageText(content: unknown): string {
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

function normalizeClaudeMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const segments: string[] = [];
  for (const item of content) {
    if (!isObjectRecord(item)) {
      continue;
    }

    if (item.type !== 'text' || typeof item.text !== 'string' || item.text.trim().length === 0) {
      continue;
    }

    segments.push(item.text);
  }

  return segments.join('\n\n').trim();
}

function parseCodexCliResponseMessageEvent(rawEvent: unknown): CodexTranscriptMessage | null {
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

  const text = normalizeCodexMessageText(payload.content);
  if (text.length === 0) {
    return null;
  }

  return {
    role: payload.role,
    text,
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
  };
}

function parseClaudeCliResponseMessageEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  if (!isObjectRecord(rawEvent)) {
    return null;
  }

  if (rawEvent.isMeta === true) {
    return null;
  }

  if (rawEvent.type !== 'user' && rawEvent.type !== 'assistant') {
    return null;
  }

  if (!('message' in rawEvent) || !isObjectRecord(rawEvent.message)) {
    return null;
  }

  const message = rawEvent.message;
  if (!isTranscriptRole(message.role) || message.role !== rawEvent.type) {
    return null;
  }

  const text = normalizeClaudeMessageText(message.content);
  if (text.length === 0) {
    return null;
  }

  return {
    role: message.role,
    text,
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
  };
}

export function parseCodexResponseMessageEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  const codexMessage = parseCodexCliResponseMessageEvent(rawEvent);
  if (codexMessage) {
    return codexMessage;
  }

  return parseClaudeCliResponseMessageEvent(rawEvent);
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

function truncatePreviewText(value: string): string {
  if (value.length <= MAX_EVENT_PREVIEW_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_EVENT_PREVIEW_CHARS)}…`;
}

function summarizeEventText(content: string): string {
  const normalized = content.replaceAll('\r\n', '\n').trim();
  if (normalized.length === 0) {
    return 'no output';
  }

  const lines = normalized.split('\n');
  const previewLines = lines.slice(0, MAX_EVENT_PREVIEW_LINES);
  const overflowCount = lines.length - previewLines.length;
  const preview = previewLines.join('\n');
  if (overflowCount > 0) {
    return truncatePreviewText(`${preview}\n… (+${overflowCount} more lines)`);
  }

  return truncatePreviewText(preview);
}

function summarizeUnknownEventContent(content: unknown): string {
  if (typeof content === 'string') {
    return summarizeEventText(content);
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string' && item.trim().length > 0) {
        return summarizeEventText(item);
      }

      if (isObjectRecord(item)) {
        if (typeof item.text === 'string' && item.text.trim().length > 0) {
          return summarizeEventText(item.text);
        }

        if (typeof item.content === 'string' && item.content.trim().length > 0) {
          return summarizeEventText(item.content);
        }
      }
    }
  }

  return 'no output';
}

function summarizeToolUseInput(input: unknown): string | null {
  if (!isObjectRecord(input)) {
    return null;
  }

  const candidates = ['description', 'command', 'pattern', 'path', 'file_path', 'filePath'];
  for (const candidate of candidates) {
    const value = input[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      return truncatePreviewText(value.trim());
    }
  }

  return null;
}

function parseCodexTaskLifecycleTranscriptEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  if (!isObjectRecord(rawEvent) || rawEvent.type !== 'event_msg' || !('payload' in rawEvent)) {
    return null;
  }

  const payload = rawEvent.payload;
  if (!isObjectRecord(payload) || typeof payload.type !== 'string') {
    return null;
  }

  let eventSummary: string | null = null;
  switch (payload.type) {
    case 'task_started':
      eventSummary = 'Task started';
      break;
    case 'task_complete':
      eventSummary = 'Task complete';
      break;
    case 'task_failed':
      eventSummary = 'Task failed';
      break;
    case 'task_error':
      eventSummary = 'Task errored';
      break;
    case 'task_cancelled':
    case 'task_canceled':
      eventSummary = 'Task cancelled';
      break;
    default:
      eventSummary = null;
      break;
  }

  if (!eventSummary) {
    return null;
  }

  return {
    role: 'assistant',
    text: `[event] ${eventSummary}`,
    timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
  };
}

function parseClaudeToolTranscriptEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  if (!isObjectRecord(rawEvent) || rawEvent.isMeta === true) {
    return null;
  }

  if (!('message' in rawEvent) || !isObjectRecord(rawEvent.message)) {
    return null;
  }

  const message = rawEvent.message;
  const content = message.content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const item of content) {
    if (!isObjectRecord(item) || typeof item.type !== 'string') {
      continue;
    }

    if (item.type === 'tool_use') {
      const toolName = typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : 'tool';
      const toolInputSummary = summarizeToolUseInput(item.input);
      const description = toolInputSummary ? `${toolName} (${toolInputSummary})` : toolName;

      return {
        role: 'assistant',
        text: `[event] Tool call: ${description}`,
        timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
      };
    }

    if (item.type === 'tool_result') {
      const status = item.is_error === true ? 'Tool error' : 'Tool result';
      const summary = summarizeUnknownEventContent(item.content);
      return {
        role: 'assistant',
        text: `[event] ${status}: ${summary}`,
        timestamp: typeof rawEvent.timestamp === 'string' ? rawEvent.timestamp : null
      };
    }
  }

  return null;
}

function parseTranscriptEvent(rawEvent: unknown): CodexTranscriptMessage | null {
  const responseMessage = parseCodexResponseMessageEvent(rawEvent);
  if (responseMessage) {
    return responseMessage;
  }

  const taskLifecycleMessage = parseCodexTaskLifecycleTranscriptEvent(rawEvent);
  if (taskLifecycleMessage) {
    return taskLifecycleMessage;
  }

  return parseClaudeToolTranscriptEvent(rawEvent);
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

    const message = parseTranscriptEvent(parsedLine);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

function hasMatchingSessionSuffix(fileName: string, sessionId: string): boolean {
  return fileName.endsWith(`-${sessionId}.jsonl`) || fileName === `${sessionId}.jsonl`;
}

function normalizeSessionsRootPaths(sessionsRootPath: SessionsRootPathInput): string[] {
  if (typeof sessionsRootPath === 'string') {
    return sessionsRootPath.trim().length > 0 ? [sessionsRootPath] : [];
  }

  return sessionsRootPath.filter((value) => value.trim().length > 0);
}

export async function findCodexSessionFilePath(
  sessionsRootPath: SessionsRootPathInput,
  sessionId: string
): Promise<string | null> {
  if (sessionId.trim().length === 0) {
    return null;
  }

  const rootPaths = normalizeSessionsRootPaths(sessionsRootPath);
  if (rootPaths.length === 0) {
    return null;
  }

  for (const rootPath of rootPaths) {
    const pendingDirectories: string[] = [rootPath];
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
          if (directoryPath === rootPath) {
            break;
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
  }

  return null;
}

export async function readCodexTranscriptBySessionId(
  sessionsRootPath: SessionsRootPathInput,
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
