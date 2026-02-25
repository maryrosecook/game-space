import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createStarterHeadlessSmokeProtocol } from './protocol';
import { runStarterHeadless } from './runner';

const USAGE_MESSAGE =
  'Usage: tsx src/headless/cli.ts (--smoke | --script <path> | --json <value> | --stdin) or pipe JSON via stdin with no args';

type ReadProtocolInputOptions = {
  readStdinJson?: () => Promise<unknown>;
  stdinIsTty?: boolean;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const protocolInput = await readProtocolInputFromArgs(args);
  const gameVersionId = inferGameVersionIdFromWorkingDirectory(process.cwd());
  const result = await runStarterHeadless(protocolInput, {
    gameVersionId
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

export async function readProtocolInputFromArgs(
  args: readonly string[],
  options: ReadProtocolInputOptions = {}
): Promise<unknown> {
  const readStdinJson = options.readStdinJson ?? readProtocolJsonFromStdin;
  const stdinIsTty = options.stdinIsTty ?? process.stdin.isTTY ?? false;

  if (args.includes('--smoke')) {
    return createStarterHeadlessSmokeProtocol();
  }

  if (args.includes('--stdin')) {
    return readStdinJson();
  }

  const scriptIndex = args.indexOf('--script');
  if (scriptIndex !== -1) {
    const scriptPath = args[scriptIndex + 1];
    if (!scriptPath) {
      throw new Error('Missing path value after --script');
    }

    const absoluteScriptPath = path.resolve(process.cwd(), scriptPath);
    const scriptJson = await fs.readFile(absoluteScriptPath, 'utf8');
    return JSON.parse(scriptJson);
  }

  const jsonIndex = args.indexOf('--json');
  if (jsonIndex !== -1) {
    const serializedProtocol = args[jsonIndex + 1];
    if (!serializedProtocol) {
      throw new Error('Missing JSON value after --json');
    }

    return JSON.parse(serializedProtocol);
  }

  if (!stdinIsTty && args.length === 0) {
    return readStdinJson();
  }

  throw new Error(USAGE_MESSAGE);
}

export function inferGameVersionIdFromWorkingDirectory(workingDirectory: string): string {
  const resolvedDirectory = path.resolve(workingDirectory);
  const pathSegments = resolvedDirectory.split(path.sep).filter((segment) => segment.length > 0);
  const gamesSegmentIndex = pathSegments.lastIndexOf('games');
  if (gamesSegmentIndex !== -1) {
    const versionSegment = pathSegments[gamesSegmentIndex + 1];
    if (versionSegment && versionSegment.length > 0) {
      return versionSegment;
    }
  }

  const baseName = path.basename(resolvedDirectory);
  if (baseName.length > 0) {
    return baseName;
  }

  throw new Error(`Unable to infer game version from cwd: ${workingDirectory}`);
}

async function readProtocolJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  const jsonText = Buffer.concat(chunks).toString('utf8').trim();
  if (jsonText.length === 0) {
    throw new Error('Missing JSON protocol on stdin');
  }

  return JSON.parse(jsonText);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
