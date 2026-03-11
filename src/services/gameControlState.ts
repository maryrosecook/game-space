import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { hasErrorCode } from './fsUtils';
import { parseGameControlState, type GameControlState } from '../gameRuntimeControls';

const controlStateWriteQueueByPath = new Map<string, Promise<void>>();

export function controlStateFilePath(gamesRootPath: string, versionId: string): string {
  return path.join(gamesRootPath, versionId, 'control-state.json');
}

export async function readControlStateFile(controlStatePath: string): Promise<GameControlState | null> {
  let serializedControlState: string;
  try {
    serializedControlState = await fs.readFile(controlStatePath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }

  let rawControlState: unknown;
  try {
    rawControlState = JSON.parse(serializedControlState) as unknown;
  } catch {
    return null;
  }

  return parseGameControlState(rawControlState);
}

export async function writeControlStateFile(
  controlStatePath: string,
  controlState: GameControlState
): Promise<void> {
  const normalizedControlStatePath = path.resolve(controlStatePath);
  const normalizedControlState = parseGameControlState(controlState) ?? {};
  const serializedControlState = `${JSON.stringify(normalizedControlState, null, 2)}\n`;

  await serializeControlStateWrite(normalizedControlStatePath, async () => {
    const tempPath = `${normalizedControlStatePath}.tmp-${randomUUID()}`;
    try {
      await fs.mkdir(path.dirname(normalizedControlStatePath), { recursive: true });
      await fs.writeFile(tempPath, serializedControlState, 'utf8');
      await fs.rename(tempPath, normalizedControlStatePath);
    } catch (error: unknown) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  });
}

function serializeControlStateWrite(
  controlStatePath: string,
  writer: () => Promise<void>
): Promise<void> {
  const activeWrite = controlStateWriteQueueByPath.get(controlStatePath) ?? Promise.resolve();
  const queuedWrite = activeWrite.catch(() => undefined).then(writer);
  controlStateWriteQueueByPath.set(controlStatePath, queuedWrite);

  return queuedWrite.finally(() => {
    if (controlStateWriteQueueByPath.get(controlStatePath) === queuedWrite) {
      controlStateWriteQueueByPath.delete(controlStatePath);
    }
  });
}
