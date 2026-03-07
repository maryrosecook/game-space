import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPullGamesCommandArgs, pullGames } from '../src/services/pullGames';
import type { CommandRunner } from '../src/services/gameBuildPipeline';

describe('pullGames', () => {
  it('builds rsync arguments for do2 games source and local games destination', () => {
    const args = buildPullGamesCommandArgs(
      'do2',
      '~/node-sites/game-space/games///',
      path.join(process.cwd(), 'games')
    );

    expect(args).toEqual([
      '--archive',
      '--compress',
      '--verbose',
      '--rsh',
      'ssh',
      'do2:~/node-sites/game-space/games/',
      `${path.join(process.cwd(), 'games')}/`
    ]);
  });

  it('runs rsync with defaults when no config is provided', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const run: CommandRunner = async (command, args) => {
      calls.push({
        command,
        args
      });
    };

    await pullGames({}, run);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: 'rsync',
      args: [
        '--archive',
        '--compress',
        '--verbose',
        '--rsh',
        'ssh',
        'do2:~/node-sites/game-space/games/',
        `${path.join(process.cwd(), 'games')}/`
      ]
    });
  });

  it('rejects blank ssh host aliases', () => {
    expect(() => buildPullGamesCommandArgs(' ', '~/node-sites/game-space/games', './games')).toThrow(
      'SSH host alias must not be empty'
    );
  });
});
