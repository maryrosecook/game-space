import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('automatic tile snapshot protocol source', () => {
  it('runs longer and simulates touch interactions before snapping', async () => {
    const appSourcePath = path.join(process.cwd(), 'src/app.ts');
    const source = await fs.readFile(appSourcePath, 'utf8');

    expect(source).toContain('const TILE_SNAPSHOT_PROTOCOL = {');
    expect(source).toContain('{ run: 240 }');
    expect(source).toContain('{ touch: { id: 1, phase: "start", x: 160, y: 220 } }');
    expect(source).toContain('{ touch: { id: 1, phase: "end", x: 160, y: 220 } }');
    expect(source).toContain('{ touch: { id: 2, phase: "start", x: 480, y: 220 } }');
    expect(source).toContain('{ touch: { id: 2, phase: "end", x: 480, y: 220 } }');
    expect(source).toContain('{ snap: "tile" }');
  });
});
