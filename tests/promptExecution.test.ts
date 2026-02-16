import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  composeCodexPrompt,
  parseSessionIdFromCodexEventLine,
  readBuildPromptFile
} from '../src/services/promptExecution';
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

  it('ships a self-contained default game-build prompt for in-directory edits', async () => {
    const buildPromptText = await readBuildPromptFile(path.resolve('game-build-prompt.md'));

    expect(buildPromptText).toContain('Treat the current working directory (`pwd`) as the full project scope.');
    expect(buildPromptText).toContain('Do not read, depend on, or modify files outside the current directory.');
    expect(buildPromptText).toContain('startGame');
    expect(buildPromptText).toContain('dist/game.js');
    expect(buildPromptText).toContain('typecheck');
    expect(buildPromptText).toContain('typescript');
  });

  it('extracts session id from legacy session_meta events', () => {
    const line =
      '{"type":"session_meta","payload":{"id":"019c48a7-3918-7123-bc60-0d7cddb4d5d4","source":"exec"}}';
    expect(parseSessionIdFromCodexEventLine(line)).toBe('019c48a7-3918-7123-bc60-0d7cddb4d5d4');
  });

  it('extracts session id from thread.started events', () => {
    const line = '{"type":"thread.started","thread_id":"019c49ac-5744-71f1-9a0d-c2a98885e4d4"}';
    expect(parseSessionIdFromCodexEventLine(line)).toBe('019c49ac-5744-71f1-9a0d-c2a98885e4d4');
  });

  it('returns null for unrelated or invalid JSONL lines', () => {
    expect(parseSessionIdFromCodexEventLine('{"type":"response_item","payload":{}}')).toBeNull();
    expect(parseSessionIdFromCodexEventLine('{"type":"thread.started","thread_id":""}')).toBeNull();
    expect(parseSessionIdFromCodexEventLine('not-json')).toBeNull();
  });
});
