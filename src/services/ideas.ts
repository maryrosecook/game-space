import { promises as fs } from 'node:fs';

import { hasErrorCode, isObjectRecord } from './fsUtils';

export type GameIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
};

function normalizeIdea(value: unknown): GameIdea | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const prompt = value.prompt;
  const hasBeenBuilt = value.hasBeenBuilt;

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

  return {
    prompt: normalizedPrompt,
    hasBeenBuilt
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
