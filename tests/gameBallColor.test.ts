import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const versionId = 'd0cf7658-3371-4f01-99e2-ca90fc1899cf';
const baselineVersionId = 'v1-bounce';
const redShaderLine = 'gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);';
const oldShaderLine = 'gl_FragColor = vec4(0.16, 0.86, 0.64, 1.0);';

function resolveVersionFilePath(gameVersionId: string, ...segments: string[]): string {
  return path.join(process.cwd(), 'games', gameVersionId, ...segments);
}

describe('d0cf7658 game ball color', () => {
  it('uses a red fragment shader in source', async () => {
    const sourcePath = resolveVersionFilePath(versionId, 'src', 'main.ts');
    const sourceText = await fs.readFile(sourcePath, 'utf8');

    expect(sourceText).toContain(redShaderLine);
    expect(sourceText).not.toContain(oldShaderLine);
  });

  it('does not change the original v1-bounce shader color', async () => {
    const baselinePath = resolveVersionFilePath(baselineVersionId, 'src', 'main.ts');
    const baselineText = await fs.readFile(baselinePath, 'utf8');

    expect(baselineText).toContain(oldShaderLine);
    expect(baselineText).not.toContain(redShaderLine);
  });
});
