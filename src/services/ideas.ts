import { promises as fs } from 'node:fs';

import { hasErrorCode, isObjectRecord } from './fsUtils';

export const DEFAULT_IDEA_BASE_GAME_ID = 'starter';

export type IdeaBaseGame = {
  id: string;
  label: string;
  tileSnapshotPath?: string;
};

export type GameIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
  isArchived: boolean;
  baseGame: IdeaBaseGame;
};

function normalizeIdeaBaseGame(value: unknown): IdeaBaseGame | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const id = value.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    return null;
  }

  const normalizedId = id.trim();
  const label = value.label;
  const normalizedLabel = typeof label === 'string' && label.trim().length > 0 ? label.trim() : normalizedId;
  const tileSnapshotPath = value.tileSnapshotPath;
  const normalizedTileSnapshotPath =
    typeof tileSnapshotPath === 'string' && tileSnapshotPath.trim().length > 0 ? tileSnapshotPath.trim() : undefined;

  return {
    id: normalizedId,
    label: normalizedLabel,
    ...(normalizedTileSnapshotPath ? { tileSnapshotPath: normalizedTileSnapshotPath } : {})
  };
}

function normalizeLegacyIdeaBaseGame(value: Record<string, unknown>): IdeaBaseGame | null {
  const baseGameId = value.baseGameId;
  if (typeof baseGameId !== 'string' || baseGameId.trim().length === 0) {
    return null;
  }

  const normalizedId = baseGameId.trim();
  const baseGameLabel = value.baseGameLabel;
  const normalizedLabel =
    typeof baseGameLabel === 'string' && baseGameLabel.trim().length > 0 ? baseGameLabel.trim() : normalizedId;
  const baseGameTileSnapshotPath = value.baseGameTileSnapshotPath;
  const normalizedTileSnapshotPath =
    typeof baseGameTileSnapshotPath === 'string' && baseGameTileSnapshotPath.trim().length > 0
      ? baseGameTileSnapshotPath.trim()
      : undefined;

  return {
    id: normalizedId,
    label: normalizedLabel,
    ...(normalizedTileSnapshotPath ? { tileSnapshotPath: normalizedTileSnapshotPath } : {})
  };
}

function normalizeIdea(value: unknown): GameIdea | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const prompt = value.prompt;
  const hasBeenBuilt = value.hasBeenBuilt;
  const isArchived = value.isArchived;

  if (typeof prompt !== 'string') {
    return null;
  }

  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length === 0) {
    return null;
  }

  if (typeof hasBeenBuilt !== 'boolean') {
    return null;
  }

  const normalizedIsArchived = typeof isArchived === 'boolean' ? isArchived : false;

  const baseGame =
    normalizeIdeaBaseGame(value.baseGame) ??
    normalizeLegacyIdeaBaseGame(value) ?? {
      id: DEFAULT_IDEA_BASE_GAME_ID,
      label: DEFAULT_IDEA_BASE_GAME_ID
    };

  return {
    prompt: normalizedPrompt,
    hasBeenBuilt,
    isArchived: normalizedIsArchived,
    baseGame
  };
}

export async function readIdeasFile(ideasPath: string): Promise<GameIdea[]> {
  let serializedIdeas: string;
  try {
    serializedIdeas = await fs.readFile(ideasPath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  let rawIdeas: unknown;
  try {
    rawIdeas = JSON.parse(serializedIdeas) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(rawIdeas)) {
    return [];
  }

  const ideas: GameIdea[] = [];
  for (const rawIdea of rawIdeas) {
    const normalizedIdea = normalizeIdea(rawIdea);
    if (normalizedIdea) {
      ideas.push(normalizedIdea);
    }
  }

  return ideas;
}

export async function writeIdeasFile(ideasPath: string, ideas: readonly GameIdea[]): Promise<void> {
  await fs.writeFile(ideasPath, `${JSON.stringify(ideas, null, 2)}\n`, 'utf8');
}
