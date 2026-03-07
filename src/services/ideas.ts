import { promises as fs } from 'node:fs';

import { hasErrorCode, isObjectRecord } from './fsUtils';

export type GameIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
};

export type StoredGameIdea = GameIdea & {
  archived: boolean;
};

function normalizeIdea(value: unknown): StoredGameIdea | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const prompt = value.prompt;
  const hasBeenBuilt = value.hasBeenBuilt;
  const archived = value.archived;

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

  const normalizedArchived =
    typeof archived === 'undefined' ? false : typeof archived === 'boolean' ? archived : null;
  if (normalizedArchived === null) {
    return null;
  }

  return {
    prompt: normalizedPrompt,
    hasBeenBuilt,
    archived: normalizedArchived,
  };
}

export function toActiveIdeas(ideas: readonly StoredGameIdea[]): GameIdea[] {
  const activeIdeas: GameIdea[] = [];
  for (const idea of ideas) {
    if (idea.archived) {
      continue;
    }

    activeIdeas.push({
      prompt: idea.prompt,
      hasBeenBuilt: idea.hasBeenBuilt,
    });
  }

  return activeIdeas;
}

export function resolveStoredIdeaIndexFromActiveIndex(
  ideas: readonly StoredGameIdea[],
  activeIdeaIndex: number,
): number | null {
  let currentActiveIdeaIndex = 0;
  for (const [storedIdeaIndex, idea] of ideas.entries()) {
    if (idea.archived) {
      continue;
    }

    if (currentActiveIdeaIndex === activeIdeaIndex) {
      return storedIdeaIndex;
    }

    currentActiveIdeaIndex += 1;
  }

  return null;
}

export async function readStoredIdeasFile(ideasPath: string): Promise<StoredGameIdea[]> {
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

  const ideas: StoredGameIdea[] = [];
  for (const rawIdea of rawIdeas) {
    const normalizedIdea = normalizeIdea(rawIdea);
    if (normalizedIdea) {
      ideas.push(normalizedIdea);
    }
  }

  return ideas;
}

export async function readIdeasFile(ideasPath: string): Promise<GameIdea[]> {
  const storedIdeas = await readStoredIdeasFile(ideasPath);
  return toActiveIdeas(storedIdeas);
}

export async function writeIdeasFile(
  ideasPath: string,
  ideas: readonly StoredGameIdea[],
): Promise<void> {
  await fs.writeFile(ideasPath, `${JSON.stringify(ideas, null, 2)}\n`, 'utf8');
}
