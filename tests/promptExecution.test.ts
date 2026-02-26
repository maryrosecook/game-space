import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildClaudeStreamJsonUserInput,
  buildCodexExecArgs,
  composeCodexPrompt,
  parseGenerationCompleteEventLine,
  parseSessionIdFromCodexEventLine,
  readBuildPromptFile
} from '../src/services/promptExecution';
import { createTempDirectory } from './testHelpers';

describe('composeCodexPrompt', () => {
  it('builds codex exec args without images', () => {
    expect(buildCodexExecArgs()).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-']);
  });

  it('builds codex exec args with image attachments', () => {
    expect(buildCodexExecArgs(['/tmp/annotation-a.png', '/tmp/annotation-b.png'])).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--image',
      '/tmp/annotation-a.png',
      '--image',
      '/tmp/annotation-b.png',
      '-'
    ]);
  });

  it('builds claude stream-json user input with image attachments', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-claude-input-');
    const imagePath = path.join(tempDirectoryPath, 'annotation.png');
    const encodedImage =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';
    await fs.writeFile(imagePath, Buffer.from(encodedImage, 'base64'));

    const serializedInput = await buildClaudeStreamJsonUserInput('Explain this annotation', [imagePath]);

    expect(JSON.parse(serializedInput.trim())).toEqual({
      type: 'user',
      session_id: '',
      message: {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: encodedImage
            }
          },
          {
            type: 'text',
            text: 'Explain this annotation'
          }
        ]
      },
      parent_tool_use_id: null
    });
  });

  it('rejects unsupported claude image attachment extensions', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-claude-input-ext-');
    const imagePath = path.join(tempDirectoryPath, 'annotation.bmp');
    await fs.writeFile(imagePath, 'not-a-supported-image', 'utf8');

    await expect(buildClaudeStreamJsonUserInput('Explain this annotation', [imagePath])).rejects.toThrow(
      'Claude annotation images must use png, jpg, jpeg, gif, or webp extensions'
    );
  });

  it('prepends build prompt and preserves arbitrary user text', () => {
    const buildPrompt = 'Line A\nLine B\n';
    const userPrompt = 'Keep "quotes"\nline-2\n$HOME `raw`';

    const composed = composeCodexPrompt(buildPrompt, userPrompt);
    expect(composed).toBe('Line A\nLine B\n\nKeep "quotes"\nline-2\n$HOME `raw`');
  });

  it('appends annotation pixels when provided', () => {
    const buildPrompt = 'Line A\nLine B\n';
    const userPrompt = 'add portals';
    const annotation = 'data:image/png;base64,abc123';

    const composed = composeCodexPrompt(buildPrompt, userPrompt, annotation);
    expect(composed).toBe('Line A\nLine B\n\nadd portals\n\n[annotation_overlay_png_data_url]\ndata:image/png;base64,abc123');
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
    expect(buildPromptText).toContain('fixed viewport of `360x640`');
    expect(buildPromptText).toContain('`maxFrames=120` and `maxSnaps=1`');
    expect(buildPromptText).toContain("npm run headless -- --json '<protocol-json>'");
    expect(buildPromptText).toContain('"snap": "validation_check"');
    expect(buildPromptText).not.toContain('"v": 1');
    expect(buildPromptText).not.toContain('"game":');
    expect(buildPromptText).not.toContain('"viewport":');
    expect(buildPromptText).not.toContain('"limits":');
    expect(buildPromptText).toContain('You must not run linting commands.');
    expect(buildPromptText).toContain('You must not run tests except the headless tests.');
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

  it('extracts session id from claude stream events', () => {
    const line = '{"type":"result","session_id":"77e122f3-31c9-4f14-acd4-886d3d8479af"}';
    expect(parseSessionIdFromCodexEventLine(line)).toBe('77e122f3-31c9-4f14-acd4-886d3d8479af');
  });



  it('detects codex and claude terminal completion events', () => {
    expect(parseGenerationCompleteEventLine('{"type":"response.completed"}', 'codex')).toBe(true);
    expect(
      parseGenerationCompleteEventLine('{"type":"event_msg","payload":{"type":"task_complete"}}', 'codex')
    ).toBe(true);
    expect(parseGenerationCompleteEventLine('{"type":"message_stop"}', 'claude')).toBe(true);
    expect(parseGenerationCompleteEventLine('{"type":"assistant"}', 'claude')).toBe(false);
  });
  it('returns null for unrelated or invalid JSONL lines', () => {
    expect(parseSessionIdFromCodexEventLine('{"type":"response_item","payload":{}}')).toBeNull();
    expect(parseSessionIdFromCodexEventLine('{"type":"thread.started","thread_id":""}')).toBeNull();
    expect(parseSessionIdFromCodexEventLine('not-json')).toBeNull();
  });
});
