import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('dev workflow source', () => {
  it('enables automatic port fallback for the spawned server process', async () => {
    const devScriptPath = path.join(process.cwd(), 'scripts/dev.ts');
    const source = await fs.readFile(devScriptPath, 'utf8');

    expect(source).toContain("GAME_SPACE_ALLOW_PORT_FALLBACK: '1'");
  });
});
