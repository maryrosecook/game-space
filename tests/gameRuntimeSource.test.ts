import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const gameSourcePaths = [
  'games/v1-bounce/src/main.ts',
  'games/d0cf7658-3371-4f01-99e2-ca90fc1899cf/src/main.ts'
];

async function readGameSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('game runtime source', () => {
  it.each(gameSourcePaths)('keeps circles round in %s', async (relativePath) => {
    const source = await readGameSource(relativePath);

    expect(source).toContain('uniform float u_viewportScale;');
    expect(source).toContain('const viewportScale = canvas.height / Math.max(canvas.width, 1);');
    expect(source).toContain('const horizontalRadius = radius * viewportScale;');
    expect(source).toContain('gl.uniform1f(viewportScaleLocation, viewportScale);');
    expect(source).not.toContain('window.innerWidth');
    expect(source).not.toContain('window.innerHeight');
  });
});
