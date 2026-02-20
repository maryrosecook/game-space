import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

async function readRepoFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('repo codex instruction configuration', () => {
  it('requires typecheck before lint and forbids parallel execution', async () => {
    const instructions = await readRepoFile('AGENTS.md');

    expect(instructions).toContain(
      '- Do not run `npm run lint` and `npm run typecheck` in parallel.'
    );
    expect(instructions).toContain('1. `npm run typecheck`');
    expect(instructions).toContain('2. `npm run lint`');

    const typecheckIndex = instructions.indexOf('1. `npm run typecheck`');
    const lintIndex = instructions.indexOf('2. `npm run lint`');
    expect(typecheckIndex).toBeGreaterThanOrEqual(0);
    expect(lintIndex).toBeGreaterThan(typecheckIndex);
  });
});
