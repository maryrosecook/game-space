import { type Dirent, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';

import { parseCodexResponseMessageEvent, parseCodexTaskLifecycleEvent } from './codexSessions';
import { hasErrorCode, isObjectRecord } from './fsUtils';
import type { CodexSessionStatus, EyeState } from '../types';

type AssistantMessageMetadata = {
  text: string;
  timestamp: string | null;
};

type WorktreeTurnTracker = {
  sessionPath: string;
  offset: number;
  buffer: string;
  hasTaskLifecycleEvents: boolean;
  taskStartedIndex: number;
  taskTerminalIndex: number;
  lastUserPromptIndex: number;
  lastAssistantMessageIndex: number;
  lastUserPromptTimestamp: string | null;
  lastAssistantMessageTimestamp: string | null;
  latestAssistantMessage: AssistantMessageMetadata | null;
  updatedTime: string;
};

export type CodexTurnInfo = {
  eyeState: EyeState;
  codexSessionStatus: CodexSessionStatus;
  hasActiveTracker: boolean;
  sessionPath: string | null;
  lastUserPromptIndex: number;
  lastAssistantMessageIndex: number;
  lastUserPromptTimestamp: string | null;
  lastAssistantMessageTimestamp: string | null;
  latestAssistantMessage: AssistantMessageMetadata | null;
  updatedTime: string | null;
};

type GetCodexTurnInfoOptions = {
  repoRootPath: string;
  worktreePath: string;
  sessionsRootPath: string | readonly string[];
  codexSessionStatus: CodexSessionStatus;
  now?: () => Date;
};

const worktreeTurnTrackers = new Map<string, WorktreeTurnTracker>();
const sessionMetaCache = new Map<string, string | null>();

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function trackerKey(repoRootPath: string, worktreePath: string): string {
  return `${normalizePath(repoRootPath)}::${normalizePath(worktreePath)}`;
}

function mapStatusToEyeState(codexSessionStatus: CodexSessionStatus): EyeState {
  if (codexSessionStatus === 'created') {
    return 'generating';
  }

  if (codexSessionStatus === 'error') {
    return 'error';
  }

  return 'stopped';
}

function createTracker(sessionPath: string, now: () => Date): WorktreeTurnTracker {
  return {
    sessionPath,
    offset: 0,
    buffer: '',
    hasTaskLifecycleEvents: false,
    taskStartedIndex: 0,
    taskTerminalIndex: 0,
    lastUserPromptIndex: 0,
    lastAssistantMessageIndex: 0,
    lastUserPromptTimestamp: null,
    lastAssistantMessageTimestamp: null,
    latestAssistantMessage: null,
    updatedTime: now().toISOString()
  };
}

function parseSessionMetaCwd(rawEvent: unknown): string | null {
  if (!isObjectRecord(rawEvent)) {
    return null;
  }

  if (rawEvent.type === 'session_meta' && 'payload' in rawEvent) {
    const payload = rawEvent.payload;
    if (isObjectRecord(payload) && typeof payload.cwd === 'string' && payload.cwd.trim().length > 0) {
      return normalizePath(payload.cwd);
    }
  }

  if (typeof rawEvent.cwd === 'string' && rawEvent.cwd.trim().length > 0) {
    return normalizePath(rawEvent.cwd);
  }

  return null;
}

function extractSessionMetaCwd(jsonlText: string): string | null {
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

    const cwd = parseSessionMetaCwd(parsedLine);
    if (cwd) {
      return cwd;
    }
  }

  return null;
}

async function readSessionMetaCwdFromFile(filePath: string): Promise<string | null> {
  if (sessionMetaCache.has(filePath)) {
    return sessionMetaCache.get(filePath) ?? null;
  }

  let serializedSession: string;
  try {
    serializedSession = await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }

  const cwd = extractSessionMetaCwd(serializedSession);
  sessionMetaCache.set(filePath, cwd);

  return cwd;
}

type SessionPathAndMtime = {
  path: string;
  mtimeMs: number;
};

function normalizeSessionsRootPaths(sessionsRootPath: string | readonly string[]): string[] {
  if (typeof sessionsRootPath === 'string') {
    return sessionsRootPath.trim().length > 0 ? [sessionsRootPath] : [];
  }

  return sessionsRootPath.filter((rootPath) => rootPath.trim().length > 0);
}

async function findLatestSessionPathForWorktree(
  sessionsRootPath: string | readonly string[],
  worktreePath: string
): Promise<string | null> {
  const normalizedWorktreePath = normalizePath(worktreePath);
  const rootPaths = normalizeSessionsRootPaths(sessionsRootPath);
  if (rootPaths.length === 0) {
    return null;
  }

  let latest: SessionPathAndMtime | null = null;

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

        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
          continue;
        }

        let fileStats: Stats;
        try {
          fileStats = await fs.stat(entryPath);
        } catch (error: unknown) {
          if (hasErrorCode(error, 'ENOENT')) {
            continue;
          }

          throw error;
        }

        const sessionCwd = await readSessionMetaCwdFromFile(entryPath);
        if (sessionCwd !== normalizedWorktreePath) {
          continue;
        }

        if (!latest || fileStats.mtimeMs > latest.mtimeMs) {
          latest = {
            path: entryPath,
            mtimeMs: fileStats.mtimeMs
          };
          continue;
        }

        if (fileStats.mtimeMs === latest.mtimeMs && entryPath.localeCompare(latest.path) > 0) {
          latest = {
            path: entryPath,
            mtimeMs: fileStats.mtimeMs
          };
        }
      }
    }
  }

  return latest?.path ?? null;
}

function consumeMessageLine(tracker: WorktreeTurnTracker, serializedLine: string): void {
  let parsedLine: unknown;
  try {
    parsedLine = JSON.parse(serializedLine) as unknown;
  } catch {
    return;
  }

  const taskLifecycleEvent = parseCodexTaskLifecycleEvent(parsedLine);
  if (taskLifecycleEvent) {
    tracker.hasTaskLifecycleEvents = true;
    if (taskLifecycleEvent.state === 'started') {
      tracker.taskStartedIndex += 1;
    } else {
      tracker.taskTerminalIndex += 1;
    }
  }

  const message = parseCodexResponseMessageEvent(parsedLine);
  if (!message) {
    return;
  }

  if (message.role === 'user') {
    tracker.lastUserPromptIndex += 1;
    tracker.lastUserPromptTimestamp = message.timestamp;
    return;
  }

  tracker.lastAssistantMessageIndex += 1;
  tracker.lastAssistantMessageTimestamp = message.timestamp;
  tracker.latestAssistantMessage = {
    text: message.text,
    timestamp: message.timestamp
  };
}

function consumeAppendedText(tracker: WorktreeTurnTracker, appendedText: string, now: () => Date): void {
  if (appendedText.length === 0) {
    return;
  }

  const output = `${tracker.buffer}${appendedText}`;
  const lines = output.split('\n');
  tracker.buffer = lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    consumeMessageLine(tracker, line);
  }

  tracker.updatedTime = now().toISOString();
}

async function readFileSlice(filePath: string, startOffset: number, endOffset: number): Promise<string> {
  if (endOffset <= startOffset) {
    return '';
  }

  const bytesToRead = endOffset - startOffset;
  const fileHandle = await fs.open(filePath, 'r');

  try {
    const outputBuffer = Buffer.alloc(bytesToRead);
    let totalBytesRead = 0;

    while (totalBytesRead < bytesToRead) {
      const { bytesRead } = await fileHandle.read(
        outputBuffer,
        totalBytesRead,
        bytesToRead - totalBytesRead,
        startOffset + totalBytesRead
      );
      if (bytesRead === 0) {
        break;
      }

      totalBytesRead += bytesRead;
    }

    return outputBuffer.subarray(0, totalBytesRead).toString('utf8');
  } finally {
    await fileHandle.close();
  }
}

function deriveEyeStateFromTracker(tracker: WorktreeTurnTracker): EyeState {
  if (tracker.hasTaskLifecycleEvents) {
    if (tracker.taskStartedIndex > tracker.taskTerminalIndex) {
      return 'generating';
    }

    return 'idle';
  }

  if (tracker.lastUserPromptIndex > tracker.lastAssistantMessageIndex) {
    return 'generating';
  }

  return 'idle';
}

function asInfo(
  eyeState: EyeState,
  codexSessionStatus: CodexSessionStatus,
  sessionPath: string | null,
  tracker: WorktreeTurnTracker | null,
  hasActiveTracker: boolean
): CodexTurnInfo {
  return {
    eyeState,
    codexSessionStatus,
    hasActiveTracker,
    sessionPath,
    lastUserPromptIndex: tracker?.lastUserPromptIndex ?? 0,
    lastAssistantMessageIndex: tracker?.lastAssistantMessageIndex ?? 0,
    lastUserPromptTimestamp: tracker?.lastUserPromptTimestamp ?? null,
    lastAssistantMessageTimestamp: tracker?.lastAssistantMessageTimestamp ?? null,
    latestAssistantMessage: tracker?.latestAssistantMessage ?? null,
    updatedTime: tracker?.updatedTime ?? null
  };
}

export async function getCodexTurnInfo(options: GetCodexTurnInfoOptions): Promise<CodexTurnInfo> {
  const {
    repoRootPath,
    worktreePath,
    sessionsRootPath,
    codexSessionStatus,
    now = () => new Date()
  } = options;
  const key = trackerKey(repoRootPath, worktreePath);
  const fallbackEyeState = mapStatusToEyeState(codexSessionStatus);

  let sessionPath: string | null;
  try {
    sessionPath = await findLatestSessionPathForWorktree(sessionsRootPath, worktreePath);
  } catch {
    worktreeTurnTrackers.delete(key);
    return asInfo('error', codexSessionStatus, null, null, false);
  }

  if (!sessionPath) {
    worktreeTurnTrackers.delete(key);
    return asInfo(fallbackEyeState, codexSessionStatus, null, null, false);
  }

  let fileStats: Stats;
  try {
    fileStats = await fs.stat(sessionPath);
  } catch {
    worktreeTurnTrackers.delete(key);
    return asInfo('error', codexSessionStatus, sessionPath, null, false);
  }

  let tracker = worktreeTurnTrackers.get(key) ?? null;
  if (!tracker || tracker.sessionPath !== sessionPath || fileStats.size < tracker.offset) {
    tracker = createTracker(sessionPath, now);
    worktreeTurnTrackers.set(key, tracker);
  }

  try {
    const appendedText = await readFileSlice(sessionPath, tracker.offset, fileStats.size);
    consumeAppendedText(tracker, appendedText, now);
    tracker.offset = fileStats.size;
  } catch {
    worktreeTurnTrackers.delete(key);
    return asInfo('error', codexSessionStatus, sessionPath, null, false);
  }

  return asInfo(deriveEyeStateFromTracker(tracker), codexSessionStatus, sessionPath, tracker, true);
}
