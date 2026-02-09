import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeCodexPrompt, readBuildPromptFile } from '../src/services/promptExecution';
import { createTempDirectory } from './testHelpers';

describe('composeCodexPrompt', () => {
  it('prepends build prompt and preserves arbitrary user text', () => {
    const buildPrompt = 'Line A\nLine B\n';
    const userPrompt = 'Keep "quotes"\nline-2\n$HOME `raw`';

    const composed = composeCodexPrompt(buildPrompt, userPrompt);
    expect(composed).toBe('Line A\nLine B\n\nKeep "quotes"\nline-2\n$HOME `raw`');
  });

  it('loads prompt template bytes from disk unchanged', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-prompt-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const text = 'prefix text\n- bullet\n';
    await fs.writeFile(buildPromptPath, text, 'utf8');

    expect(await readBuildPromptFile(buildPromptPath)).toBe(text);
  });
});
