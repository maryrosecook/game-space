import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveNextAppPath } from '../src/services/nextBridge';

describe('resolveNextAppPath', () => {
  it('uses src in the repo root by default', () => {
    expect(resolveNextAppPath({ repoRootPath: '/repo-root' })).toBe(path.join('/repo-root', 'src'));
  });

  it('uses an explicit next app path override when provided', () => {
    expect(resolveNextAppPath({ repoRootPath: '/repo-root', nextAppPath: '/custom-next-dir' })).toBe('/custom-next-dir');
  });
});
