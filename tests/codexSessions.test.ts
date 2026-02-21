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
  it('parses user/assistant text plus stable transcript events from JSONL', () => {
    const jsonl = [
      '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"ship a new level"}]}}',
      '{"timestamp":"2026-02-10T10:00:00.100Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}',
      '{"timestamp":"2026-02-10T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I will update the game."}]}}',
      '{"timestamp":"2026-02-10T10:00:01.200Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}',
      '{"timestamp":"2026-02-10T10:00:01.300Z","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"npm run build","description":"Build project"}}]}}',
      '{"timestamp":"2026-02-10T10:00:01.500Z","type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","text":"internal"},{"type":"text","text":"Claude reply."}]}}',
      '{"timestamp":"2026-02-10T10:00:01.750Z","type":"user","message":{"role":"user","content":"Claude prompt."}}',
      '{"timestamp":"2026-02-10T10:00:01.900Z","type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ignored"}]}}',
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
        text: '[event] Task started',
        timestamp: '2026-02-10T10:00:00.100Z'
      },
      {
        role: 'assistant',
        text: 'I will update the game.',
        timestamp: '2026-02-10T10:00:01.000Z'
      },
      {
        role: 'assistant',
        text: '[event] Task complete',
        timestamp: '2026-02-10T10:00:01.200Z'
      },
      {
        role: 'assistant',
        text: '[event] Tool call: Bash (Build project)',
        timestamp: '2026-02-10T10:00:01.300Z'
      },
      {
        role: 'assistant',
        text: 'Claude reply.',
        timestamp: '2026-02-10T10:00:01.500Z'
      },
      {
        role: 'user',
        text: 'Claude prompt.',
        timestamp: '2026-02-10T10:00:01.750Z'
      },
      {
        role: 'assistant',
        text: '[event] Tool result: ignored',
        timestamp: '2026-02-10T10:00:01.900Z'
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

  it('resolves claude session files named as <sessionId>.jsonl', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-claude-sessions-');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    const claudeSessionsRootPath = path.join(tempDirectoryPath, 'claude-projects');
    await fs.mkdir(codexSessionsRootPath, { recursive: true });
    const claudeProjectPath = path.join(claudeSessionsRootPath, '-Users-test-project');
    await fs.mkdir(claudeProjectPath, { recursive: true });

    const sessionId = '77e122f3-31c9-4f14-acd4-886d3d8479af';
    const sessionFilePath = path.join(claudeProjectPath, `${sessionId}.jsonl`);
    await fs.writeFile(
      sessionFilePath,
      '{"timestamp":"2026-02-10T10:00:00.000Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello from claude"}]}}\n',
      'utf8'
    );

    expect(await findCodexSessionFilePath([codexSessionsRootPath, claudeSessionsRootPath], sessionId)).toBe(
      sessionFilePath
    );

    expect(await readCodexTranscriptBySessionId([codexSessionsRootPath, claudeSessionsRootPath], sessionId)).toEqual([
      {
        role: 'assistant',
        text: 'hello from claude',
        timestamp: '2026-02-10T10:00:00.000Z'
      }
    ]);
  });
});
