import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseStarterHeadlessProtocol } from '../games/starter/src/headless/protocol';
import { captureTileSnapshotForGame } from '../src/services/promptSubmission';
import { createTempDirectory } from './testHelpers';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';

type HeadlessFixture = {
  gameDirectoryPath: string;
  capturedProtocolPath: string;
  generatedCapturePath: string;
};

async function createHeadlessFixture(): Promise<HeadlessFixture> {
  const tempDirectoryPath = await createTempDirectory('game-space-prompt-submission-');
  const gameDirectoryPath = path.join(tempDirectoryPath, 'game-fixture');
  const capturedProtocolPath = path.join(gameDirectoryPath, 'captured-protocol.json');
  const generatedCapturePath = path.join(gameDirectoryPath, 'generated-capture.png');

  await fs.mkdir(gameDirectoryPath, { recursive: true });
  await fs.writeFile(
    path.join(gameDirectoryPath, 'package.json'),
    JSON.stringify(
      {
        name: 'prompt-submission-headless-fixture',
        private: true,
        scripts: {
          headless: 'node ./headless.mjs',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const headlessScriptSource = [
    "import { promises as fs } from 'node:fs';",
    "import path from 'node:path';",
    '',
    'const args = process.argv.slice(2);',
    "const jsonArgumentIndex = args.indexOf('--json');",
    'if (jsonArgumentIndex === -1 || jsonArgumentIndex >= args.length - 1) {',
    "  throw new Error('Missing --json argument');",
    '}',
    'const protocolText = args[jsonArgumentIndex + 1];',
    'const protocol = JSON.parse(protocolText);',
    "const protocolPath = path.join(process.cwd(), 'captured-protocol.json');",
    "const capturePath = path.join(process.cwd(), 'generated-capture.png');",
    `const captureBase64 = '${ONE_BY_ONE_PNG_BASE64}';`,
    "await fs.writeFile(protocolPath, JSON.stringify(protocol), 'utf8');",
    "await fs.writeFile(capturePath, Buffer.from(captureBase64, 'base64'));",
    "process.stdout.write(`${JSON.stringify({ captures: [{ path: capturePath }] })}\\n`);",
    '',
  ].join('\n');

  await fs.writeFile(path.join(gameDirectoryPath, 'headless.mjs'), headlessScriptSource, 'utf8');

  return {
    gameDirectoryPath,
    capturedProtocolPath,
    generatedCapturePath,
  };
}

describe('prompt submission tile snapshot protocol', () => {
  it('preserves tile snapshot capture output behavior', async () => {
    const fixture = await createHeadlessFixture();

    await captureTileSnapshotForGame(fixture.gameDirectoryPath);

    const tileSnapshotPath = path.join(fixture.gameDirectoryPath, 'snapshots', 'tile.png');
    const tileSnapshotBytes = await fs.readFile(tileSnapshotPath);
    const generatedCaptureBytes = await fs.readFile(fixture.generatedCapturePath);

    expect(tileSnapshotBytes).toEqual(generatedCaptureBytes);
  });

  it('uses a parser-valid protocol with synthetic touch start/end before the final snap', async () => {
    const fixture = await createHeadlessFixture();

    await captureTileSnapshotForGame(fixture.gameDirectoryPath);

    const serializedProtocol = await fs.readFile(fixture.capturedProtocolPath, 'utf8');
    const protocolValue: unknown = JSON.parse(serializedProtocol);
    const parsedProtocol = parseStarterHeadlessProtocol(protocolValue);
    const steps = parsedProtocol.steps;
    const finalStep = steps.at(-1);

    expect(finalStep).toEqual({ snap: 'tile' });

    const touchStartStepIndex = steps.findIndex(
      (step) => 'input' in step && step.input.action === 'down' && step.input.emit === 'touch',
    );
    const touchEndStepIndex = steps.findIndex(
      (step) => 'input' in step && step.input.action === 'up' && step.input.emit === 'touch',
    );

    expect(touchStartStepIndex).toBeGreaterThanOrEqual(0);
    expect(touchEndStepIndex).toBeGreaterThan(touchStartStepIndex);
    expect(touchEndStepIndex).toBeLessThan(steps.length - 1);

    const framesBeforeCapture = steps.slice(0, -1).reduce((totalFrames, step) => {
      if ('run' in step) {
        return totalFrames + step.run;
      }

      return totalFrames;
    }, 0);

    expect(framesBeforeCapture).toBe(120);
    expect(steps.slice(touchEndStepIndex + 1, -1).some((step) => 'run' in step)).toBe(true);
  });
});
