'use client';

import { useEffect } from 'react';

type GamePageClientBootstrapProps = {
  versionId: string;
  isAdmin: boolean;
  enableLiveReload: boolean;
};

type GameTeardown = () => void;

type GameLifecycleHost = {
  __gameSpaceActiveGameTeardown?: GameTeardown;
  __gameSpaceTeardownActiveGame?: () => void;
};

type GameLifecycleWindow = Window & GameLifecycleHost;

function isGameTeardown(value: unknown): value is GameTeardown {
  return typeof value === 'function';
}

function invokeGameTeardownSafely(teardown: GameTeardown): void {
  try {
    teardown();
  } catch {
    // Keep bootstrap stable if teardown throws.
  }
}

export function setActiveGameTeardown(host: GameLifecycleHost, value: unknown): void {
  host.__gameSpaceActiveGameTeardown = isGameTeardown(value) ? value : undefined;
}

export function runActiveGameTeardown(host: GameLifecycleHost): void {
  const activeTeardown = host.__gameSpaceActiveGameTeardown;
  host.__gameSpaceActiveGameTeardown = undefined;
  if (!isGameTeardown(activeTeardown)) {
    return;
  }

  invokeGameTeardownSafely(activeTeardown);
}

export function ensureGlobalGameTeardownHandle(host: GameLifecycleHost): () => void {
  const existingHandle = host.__gameSpaceTeardownActiveGame;
  if (isGameTeardown(existingHandle)) {
    return existingHandle;
  }

  const teardownHandle = (): void => {
    runActiveGameTeardown(host);
  };
  host.__gameSpaceTeardownActiveGame = teardownHandle;
  return teardownHandle;
}

function getGameLifecycleWindow(): GameLifecycleWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window as GameLifecycleWindow;
}

function withPreservedDrawingBuffer(canvas: HTMLCanvasElement): void {
  const originalGetContext = canvas.getContext.bind(canvas) as unknown as (
    contextId: unknown,
    contextAttributes?: unknown,
  ) => unknown;
  const canvasWithMutableContext = canvas as unknown as {
    getContext: (contextId: unknown, contextAttributes?: unknown) => unknown;
  };

  canvasWithMutableContext.getContext = (contextId: unknown, contextAttributes?: unknown) => {
    if (
      contextId === 'webgl' ||
      contextId === 'webgl2' ||
      contextId === 'experimental-webgl'
    ) {
      const mergedAttributes =
        contextAttributes && typeof contextAttributes === 'object'
          ? { ...contextAttributes, preserveDrawingBuffer: true }
          : { preserveDrawingBuffer: true };
      return originalGetContext(contextId, mergedAttributes);
    }

    return originalGetContext(contextId, contextAttributes);
  };
}

export function GamePageClientBootstrap({
  versionId,
  isAdmin,
  enableLiveReload,
}: GamePageClientBootstrapProps) {
  useEffect(() => {
    document.body.dataset.gameReactHydrated = 'true';
    window.dispatchEvent(new Event('game-react-hydrated'));
  }, []);

  useEffect(() => {
    const lifecycleWindow = getGameLifecycleWindow();
    if (lifecycleWindow === null) {
      return;
    }

    const teardownActiveGame = ensureGlobalGameTeardownHandle(lifecycleWindow);
    const handleUnload = (): void => {
      teardownActiveGame();
    };

    lifecycleWindow.addEventListener('beforeunload', handleUnload);
    lifecycleWindow.addEventListener('pagehide', handleUnload);
    lifecycleWindow.addEventListener('unload', handleUnload);
    teardownActiveGame();

    const canvas = document.getElementById('game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return () => {
        lifecycleWindow.removeEventListener('beforeunload', handleUnload);
        lifecycleWindow.removeEventListener('pagehide', handleUnload);
        lifecycleWindow.removeEventListener('unload', handleUnload);
        teardownActiveGame();
      };
    }

    if (isAdmin) {
      withPreservedDrawingBuffer(canvas);
    }

    let isDisposed = false;
    const startGameModulePath = `/games/${encodeURIComponent(versionId)}/dist/game.js`;
    void import(/* webpackIgnore: true */ startGameModulePath)
      .then((gameModule: unknown) => {
        if (isDisposed || !gameModule || typeof gameModule !== 'object') {
          return;
        }

        const startGame = Reflect.get(gameModule, 'startGame');
        if (typeof startGame !== 'function') {
          return;
        }

        const maybeTeardown = startGame(canvas);
        if (isDisposed) {
          if (isGameTeardown(maybeTeardown)) {
            invokeGameTeardownSafely(maybeTeardown);
          }
          return;
        }

        setActiveGameTeardown(lifecycleWindow, maybeTeardown);
      })
      .catch(() => {
        // Keep initial render stable when the game bundle is unavailable.
      });

    return () => {
      isDisposed = true;
      lifecycleWindow.removeEventListener('beforeunload', handleUnload);
      lifecycleWindow.removeEventListener('pagehide', handleUnload);
      lifecycleWindow.removeEventListener('unload', handleUnload);
      teardownActiveGame();
    };
  }, [isAdmin, versionId]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void import('./legacy/game-view-client.js').catch(() => {
      // Keep page render stable if admin controls fail to initialize.
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!enableLiveReload) {
      return;
    }

    void import('./legacy/game-live-reload-client.js').catch(() => {
      // Keep page render stable if live reload client fails to initialize.
    });
  }, [enableLiveReload]);

  return null;
}
