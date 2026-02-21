import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { getCodexTurnInfo } from '../src/services/codexTurnInfo';
import { createTempDirectory } from './testHelpers';

function sessionMetaLine(worktreePath: string): string {
  const escapedWorktreePath = worktreePath.replaceAll('\\', '\\\\');
  return `{"type":"session_meta","payload":{"cwd":"${escapedWorktreePath}"}}`;
}

function userLine(text: string, timestamp = '2026-02-17T10:00:00.000Z'): string {
  return `{"timestamp":"${timestamp}","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"${text}"}]}}`;
}

function assistantLine(text: string, timestamp = '2026-02-17T10:00:01.000Z'): string {
  return `{"timestamp":"${timestamp}","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"${text}"}]}}`;
}

function claudeUserLine(worktreePath: string, text: string, timestamp = '2026-02-17T10:00:00.000Z'): string {
  const escapedWorktreePath = worktreePath.replaceAll('\\', '\\\\');
  return `{"timestamp":"${timestamp}","cwd":"${escapedWorktreePath}","sessionId":"77e122f3-31c9-4f14-acd4-886d3d8479af","type":"user","message":{"role":"user","content":"${text}"}}`;
}

function claudeAssistantLine(
  worktreePath: string,
  text: string,
  timestamp = '2026-02-17T10:00:01.000Z'
): string {
  const escapedWorktreePath = worktreePath.replaceAll('\\', '\\\\');
  return `{"timestamp":"${timestamp}","cwd":"${escapedWorktreePath}","sessionId":"77e122f3-31c9-4f14-acd4-886d3d8479af","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"${text}"}]}}`;
}

function taskStartedLine(timestamp = '2026-02-17T10:00:00.050Z'): string {
  return `{"timestamp":"${timestamp}","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}`;
}

function taskCompleteLine(timestamp = '2026-02-17T10:00:02.000Z'): string {
  return `{"timestamp":"${timestamp}","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}`;
}

describe('codex turn runtime state detection', () => {
  it('stays generating through assistant commentary until task_complete arrives', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-codex-turn-info-');
    const sessionsRootPath = path.join(tempDirectoryPath, 'sessions');
    const worktreePath = path.join(tempDirectoryPath, 'games', 'v1');
    const sessionDirectoryPath = path.join(sessionsRootPath, '2026', '02', '17');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(sessionDirectoryPath, { recursive: true });

    const sessionFilePath = path.join(sessionDirectoryPath, 'rollout-a.jsonl');
    await fs.writeFile(
      sessionFilePath,
      [sessionMetaLine(worktreePath), taskStartedLine(), userLine('please add gravity')].join('\n') + '\n',
      'utf8'
    );

    const firstTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'created'
    });
    expect(firstTurn.eyeState).toBe('generating');
    expect(firstTurn.hasActiveTracker).toBe(true);
    expect(firstTurn.lastUserPromptIndex).toBe(1);
    expect(firstTurn.lastAssistantMessageIndex).toBe(0);

    await fs.appendFile(
      sessionFilePath,
      `${assistantLine('Working on it...', '2026-02-17T10:00:01.000Z')}\n`,
      'utf8'
    );

    const secondTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'created'
    });
    expect(secondTurn.eyeState).toBe('generating');
    expect(secondTurn.lastUserPromptIndex).toBe(1);
    expect(secondTurn.lastAssistantMessageIndex).toBe(1);
    expect(secondTurn.latestAssistantMessage).toEqual({
      text: 'Working on it...',
      timestamp: '2026-02-17T10:00:01.000Z'
    });

    await fs.appendFile(
      sessionFilePath,
      `${assistantLine('I added gravity now.', '2026-02-17T10:00:01.500Z')}\n${taskCompleteLine()}\n`,
      'utf8'
    );

    const thirdTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'created'
    });
    expect(thirdTurn.eyeState).toBe('idle');
    expect(thirdTurn.lastUserPromptIndex).toBe(1);
    expect(thirdTurn.lastAssistantMessageIndex).toBe(2);
    expect(thirdTurn.latestAssistantMessage).toEqual({
      text: 'I added gravity now.',
      timestamp: '2026-02-17T10:00:01.500Z'
    });
  });

  it('resets tracker counters when the session file changes or truncates', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-codex-turn-reset-');
    const sessionsRootPath = path.join(tempDirectoryPath, 'sessions');
    const worktreePath = path.join(tempDirectoryPath, 'games', 'v1');
    const sessionDirectoryPath = path.join(sessionsRootPath, '2026', '02', '17');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(sessionDirectoryPath, { recursive: true });

    const firstSessionPath = path.join(sessionDirectoryPath, 'rollout-a.jsonl');
    await fs.writeFile(
      firstSessionPath,
      [sessionMetaLine(worktreePath), userLine('change color'), assistantLine('Done.')].join('\n') + '\n',
      'utf8'
    );

    const firstTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'stopped'
    });
    expect(firstTurn.sessionPath).toBe(firstSessionPath);
    expect(firstTurn.lastUserPromptIndex).toBe(1);
    expect(firstTurn.lastAssistantMessageIndex).toBe(1);
    expect(firstTurn.eyeState).toBe('idle');

    await delay(5);
    const secondSessionPath = path.join(sessionDirectoryPath, 'rollout-b.jsonl');
    await fs.writeFile(
      secondSessionPath,
      [sessionMetaLine(worktreePath), userLine('add score')].join('\n') + '\n',
      'utf8'
    );

    const secondTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'created'
    });
    expect(secondTurn.sessionPath).toBe(secondSessionPath);
    expect(secondTurn.lastUserPromptIndex).toBe(1);
    expect(secondTurn.lastAssistantMessageIndex).toBe(0);
    expect(secondTurn.eyeState).toBe('generating');

    await fs.writeFile(
      secondSessionPath,
      [sessionMetaLine(worktreePath), userLine('replace board')].join('\n') + '\n',
      'utf8'
    );

    const thirdTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath,
      codexSessionStatus: 'created'
    });
    expect(thirdTurn.lastUserPromptIndex).toBe(1);
    expect(thirdTurn.lastAssistantMessageIndex).toBe(0);
    expect(thirdTurn.eyeState).toBe('generating');
  });

  it('falls back to lifecycle status when no active session file exists', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-codex-turn-fallback-');
    const worktreePath = path.join(tempDirectoryPath, 'games', 'v1');
    await fs.mkdir(worktreePath, { recursive: true });

    const generatingFallback = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath: path.join(tempDirectoryPath, 'missing-sessions'),
      codexSessionStatus: 'created'
    });
    expect(generatingFallback.hasActiveTracker).toBe(false);
    expect(generatingFallback.eyeState).toBe('generating');

    const errorFallback = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath: path.join(tempDirectoryPath, 'missing-sessions'),
      codexSessionStatus: 'error'
    });
    expect(errorFallback.eyeState).toBe('error');
  });

  it('tracks claude sessions by top-level cwd metadata and message balance', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-codex-turn-claude-');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    const claudeSessionsRootPath = path.join(tempDirectoryPath, 'claude-projects');
    const worktreePath = path.join(tempDirectoryPath, 'games', 'v1');
    const claudeProjectPath = path.join(claudeSessionsRootPath, '-Users-test-project');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(codexSessionsRootPath, { recursive: true });
    await fs.mkdir(claudeProjectPath, { recursive: true });

    const sessionFilePath = path.join(claudeProjectPath, '77e122f3-31c9-4f14-acd4-886d3d8479af.jsonl');
    await fs.writeFile(
      sessionFilePath,
      [claudeUserLine(worktreePath, 'add gravity')].join('\n') + '\n',
      'utf8'
    );

    const generatingTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath: [codexSessionsRootPath, claudeSessionsRootPath],
      codexSessionStatus: 'created'
    });
    expect(generatingTurn.hasActiveTracker).toBe(true);
    expect(generatingTurn.lastUserPromptIndex).toBe(1);
    expect(generatingTurn.lastAssistantMessageIndex).toBe(0);
    expect(generatingTurn.eyeState).toBe('generating');

    await fs.appendFile(sessionFilePath, `${claudeAssistantLine(worktreePath, 'Done.')}\n`, 'utf8');

    const idleTurn = await getCodexTurnInfo({
      repoRootPath: tempDirectoryPath,
      worktreePath,
      sessionsRootPath: [codexSessionsRootPath, claudeSessionsRootPath],
      codexSessionStatus: 'stopped'
    });
    expect(idleTurn.lastAssistantMessageIndex).toBe(1);
    expect(idleTurn.latestAssistantMessage).toEqual({
      text: 'Done.',
      timestamp: '2026-02-17T10:00:01.000Z'
    });
    expect(idleTurn.eyeState).toBe('idle');
  });
});
