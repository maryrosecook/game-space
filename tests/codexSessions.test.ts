import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findCodexSessionFilePath,
  parseCodexTaskLifecycleEvent,
  parseCodexTranscriptJsonl,
  readCodexTranscriptBySessionId
} from '../src/services/codexSessions';
import { createTempDirectory } from './testHelpers';

describe('codex session transcript services', () => {
  it('parses only user and assistant message text from JSONL', () => {
    const jsonl = [
      '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"ship a new level"}]}}',
      '{"timestamp":"2026-02-10T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I will update the game."}]}}',
      '{"timestamp":"2026-02-10T10:00:02.000Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"internal"}]}}',
      '{"timestamp":"2026-02-10T10:00:03.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"reasoning_text","text":"hidden"}]}}'
    ].join('\n');

    expect(parseCodexTranscriptJsonl(jsonl)).toEqual([
      {
        role: 'user',
        text: 'ship a new level',
        timestamp: '2026-02-10T10:00:00.000Z'
      },
      {
        role: 'assistant',
        text: 'I will update the game.',
        timestamp: '2026-02-10T10:00:01.000Z'
      }
    ]);
  });

  it('parses task lifecycle events from JSONL entries', () => {
    expect(
      parseCodexTaskLifecycleEvent({
        timestamp: '2026-02-10T10:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-1' }
      })
    ).toEqual({
      state: 'started',
      timestamp: '2026-02-10T10:00:00.000Z'
    });

    expect(
      parseCodexTaskLifecycleEvent({
        timestamp: '2026-02-10T10:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-1' }
      })
    ).toEqual({
      state: 'terminal',
      timestamp: '2026-02-10T10:00:01.000Z'
    });

    expect(
      parseCodexTaskLifecycleEvent({
        type: 'event_msg',
        payload: { type: 'token_count' }
      })
    ).toBeNull();
  });

  it('finds and reads transcript by session id from the codex sessions tree', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-codex-sessions-');
    const sessionsRootPath = path.join(tempDirectoryPath, 'sessions');
    const sessionDirectoryPath = path.join(sessionsRootPath, '2026', '02', '10');
    await fs.mkdir(sessionDirectoryPath, { recursive: true });

    const sessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    const sessionFilePath = path.join(sessionDirectoryPath, `rollout-2026-02-10T10-00-00-${sessionId}.jsonl`);
    await fs.writeFile(
      sessionFilePath,
      '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}\n',
      'utf8'
    );

    expect(await findCodexSessionFilePath(sessionsRootPath, sessionId)).toBe(sessionFilePath);
    expect(await readCodexTranscriptBySessionId(sessionsRootPath, sessionId)).toEqual([
      {
        role: 'user',
        text: 'hello',
        timestamp: '2026-02-10T10:00:00.000Z'
      }
    ]);

    expect(await readCodexTranscriptBySessionId(sessionsRootPath, 'missing-session-id')).toBeNull();
  });
});
