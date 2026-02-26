import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const starterGameSourcePath = 'games/starter/src/main.ts';

async function readGameSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('game runtime source', () => {
  it('keeps starter movement bounds camera-aware without viewport globals', async () => {
    const source = await readGameSource(starterGameSourcePath);

    expect(source).toContain('const minX = camera.x;');
    expect(source).toContain('const maxX = camera.x + screen.width - (thing.width ?? 0);');
    expect(source).toContain('const maxY = camera.y + screen.height - (thing.height ?? 0);');
    expect(source).not.toContain('window.innerWidth');
    expect(source).not.toContain('window.innerHeight');
  });

  it('spawns fire-colored rain particles in starter runtime updates', async () => {
    const source = await readGameSource(starterGameSourcePath);

    expect(source).toContain("const FIRE_COLOR_PALETTE = ['#ff2d00', '#ff4a00', '#ff6a00', '#ff8d00', '#ffb300', '#ffd24a'];");
    expect(source).toContain('spawnFireRain(game, nextRainRandom);');
    expect(source).toContain('const spawnCount = nextRandom() > 0.68 ? 2 : 1;');
    expect(source).toContain('game.spawnParticle({');
  });
});
