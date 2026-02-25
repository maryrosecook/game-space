import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('starter headless browser harness source', () => {
  it('captures snapshots from a preserved WebGL drawing buffer', async () => {
    const harnessSourcePath = path.join(
      process.cwd(),
      'games/starter/src/headless/browserHarness.ts'
    );
    const source = await fs.readFile(harnessSourcePath, 'utf8');

    expect(source).toContain('preserveDrawingBuffer: true');
    expect(source).toContain('webGlContext?.finish();');
  });

  it('supports reading custom protocol JSON from stdin in the headless CLI', async () => {
    const cliSourcePath = path.join(
      process.cwd(),
      'games/starter/src/headless/cli.ts'
    );
    const source = await fs.readFile(cliSourcePath, 'utf8');

    expect(source).toContain("args.includes('--stdin')");
    expect(source).toContain('if (!stdinIsTty && args.length === 0)');
    expect(source).toContain('Missing JSON protocol on stdin');
    expect(source).toContain('inferGameVersionIdFromWorkingDirectory');
    expect(source).toContain('gameVersionId');
  });

  it('uses fixed viewport and limits in the headless runner', async () => {
    const runnerSourcePath = path.join(
      process.cwd(),
      'games/starter/src/headless/runner.ts'
    );
    const source = await fs.readFile(runnerSourcePath, 'utf8');

    expect(source).toContain('STARTER_HEADLESS_VIEWPORT');
    expect(source).toContain('STARTER_HEADLESS_LIMITS');
    expect(source).toContain('gameVersionId');
  });
});
