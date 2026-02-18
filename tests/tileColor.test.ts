import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReadableRandomHexColor } from '../src/services/tileColor';

describe('createReadableRandomHexColor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first generated color when it has readable white contrast', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(createReadableRandomHexColor()).toBe('#000000');
  });

  it('returns the fallback color when no generated color meets contrast requirements', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999999);

    expect(createReadableRandomHexColor()).toBe('#1D3557');
    expect(randomSpy).toHaveBeenCalledTimes(64 * 3);
  });
});
