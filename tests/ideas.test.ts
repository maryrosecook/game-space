import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readIdeasFile,
  readStoredIdeasFile,
  resolveStoredIdeaIndexFromActiveIndex,
  toActiveIdeas,
  type StoredGameIdea,
} from '../src/services/ideas';
import { createTempDirectory } from './testHelpers';

async function writeIdeasFixture(ideas: readonly unknown[]): Promise<string> {
  const tempDirectoryPath = await createTempDirectory('game-space-ideas-');
  const ideasPath = path.join(tempDirectoryPath, 'ideas.json');
  await fs.writeFile(ideasPath, `${JSON.stringify(ideas, null, 2)}\n`, 'utf8');
  return ideasPath;
}

describe('ideas service', () => {
  it('treats legacy entries as unarchived and omits archived entries from active reads', async () => {
    const ideasPath = await writeIdeasFixture([
      { prompt: ' legacy starter idea ', hasBeenBuilt: false },
      { prompt: 'archived idea', hasBeenBuilt: true, archived: true },
      { prompt: 'active built idea', hasBeenBuilt: true, archived: false },
      { prompt: 'invalid archived type', hasBeenBuilt: false, archived: 'yes' },
      { prompt: '', hasBeenBuilt: false },
    ]);

    const storedIdeas = await readStoredIdeasFile(ideasPath);
    expect(storedIdeas).toEqual([
      { prompt: 'legacy starter idea', hasBeenBuilt: false, archived: false },
      { prompt: 'archived idea', hasBeenBuilt: true, archived: true },
      { prompt: 'active built idea', hasBeenBuilt: true, archived: false },
    ]);

    const activeIdeas = await readIdeasFile(ideasPath);
    expect(activeIdeas).toEqual([
      { prompt: 'legacy starter idea', hasBeenBuilt: false },
      { prompt: 'active built idea', hasBeenBuilt: true },
    ]);
  });

  it('resolves active indices against stored history with archived entries', () => {
    const storedIdeas: StoredGameIdea[] = [
      { prompt: 'already archived', hasBeenBuilt: false, archived: true },
      { prompt: 'active alpha', hasBeenBuilt: false, archived: false },
      { prompt: 'active beta', hasBeenBuilt: true, archived: false },
      { prompt: 'archived later', hasBeenBuilt: true, archived: true },
    ];

    expect(resolveStoredIdeaIndexFromActiveIndex(storedIdeas, 0)).toBe(1);
    expect(resolveStoredIdeaIndexFromActiveIndex(storedIdeas, 1)).toBe(2);
    expect(resolveStoredIdeaIndexFromActiveIndex(storedIdeas, 2)).toBeNull();

    expect(toActiveIdeas(storedIdeas)).toEqual([
      { prompt: 'active alpha', hasBeenBuilt: false },
      { prompt: 'active beta', hasBeenBuilt: true },
    ]);
  });
});
