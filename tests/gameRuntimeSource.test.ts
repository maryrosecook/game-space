import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const starterGameSourcePath = 'games/starter/src/main.ts';

async function readGameSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('game runtime source', () => {
  it('defines a blank starter scene with no game objects or particles', async () => {
    const source = await readGameSource(starterGameSourcePath);

    expect(source).toContain('things: [],');
    expect(source).toContain('blueprints: [],');
    expect(source).not.toContain('spawnParticle(');
    expect(source).not.toContain('player-orb');
  });
});
