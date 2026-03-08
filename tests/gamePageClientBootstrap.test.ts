import { describe, expect, it, vi } from 'vitest';

import {
  ensureGlobalGameTeardownHandle,
  runActiveGameTeardown,
  setActiveGameTeardown,
} from '../src/app/game/[versionId]/GamePageClientBootstrap';

type TestLifecycleHost = {
  __gameSpaceActiveGameTeardown?: () => void;
  __gameSpaceTeardownActiveGame?: () => void;
};

describe('GamePageClientBootstrap teardown lifecycle helpers', () => {
  it('captures teardown callbacks and runs them exactly once through the global handle', () => {
    const host: TestLifecycleHost = {};
    const teardownHandle = ensureGlobalGameTeardownHandle(host);
    const teardownSpy = vi.fn();

    setActiveGameTeardown(host, teardownSpy);
    teardownHandle();
    teardownHandle();

    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(host.__gameSpaceActiveGameTeardown).toBeUndefined();
    expect(host.__gameSpaceTeardownActiveGame).toBe(teardownHandle);
  });

  it('runs previous teardown before registering the next one', () => {
    const host: TestLifecycleHost = {};
    const teardownHandle = ensureGlobalGameTeardownHandle(host);
    const firstTeardown = vi.fn();
    const secondTeardown = vi.fn();

    setActiveGameTeardown(host, firstTeardown);
    teardownHandle();
    setActiveGameTeardown(host, secondTeardown);
    teardownHandle();

    expect(firstTeardown).toHaveBeenCalledTimes(1);
    expect(secondTeardown).toHaveBeenCalledTimes(1);
  });

  it('keeps lifecycle cleanup stable when teardown is invalid or throws', () => {
    const host: TestLifecycleHost = {};
    const teardownHandle = ensureGlobalGameTeardownHandle(host);
    const throwingTeardown = vi.fn(() => {
      throw new Error('teardown failure');
    });

    setActiveGameTeardown(host, 'not-a-function');
    expect(() => runActiveGameTeardown(host)).not.toThrow();

    setActiveGameTeardown(host, throwingTeardown);
    expect(() => teardownHandle()).not.toThrow();
    expect(throwingTeardown).toHaveBeenCalledTimes(1);
    expect(host.__gameSpaceActiveGameTeardown).toBeUndefined();
  });
});
