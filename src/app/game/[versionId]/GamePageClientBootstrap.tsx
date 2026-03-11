'use client';

import { useEffect } from 'react';

import {
  parseGameControlState,
  type GameControlState,
  type GameRuntimeControls,
  type GameRuntimeHost,
} from '../../../gameRuntimeControls';

type GamePageClientBootstrapProps = {
  versionId: string;
  isAdmin: boolean;
  enableLiveReload: boolean;
  csrfToken: string | null;
  initialControlState: GameControlState | null;
};

type GameTeardown = () => void;

type GameLifecycleHost = {
  __gameSpaceActiveGameTeardown?: GameTeardown;
  __gameSpaceTeardownActiveGame?: () => void;
  __gameSpaceActiveGameRuntimeControls?: GameRuntimeControls;
  __gameSpaceActiveGameRuntimeHost?: GameRuntimeHost;
};

type GameLifecycleWindow = Window & GameLifecycleHost;
const GAME_RUNTIME_CONTROLS_EVENT = 'game-runtime-controls-changed';

function isGameTeardown(value: unknown): value is GameTeardown {
  return typeof value === 'function';
}

function isGameRuntimeControls(value: unknown): value is GameRuntimeControls {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const getSliders = Reflect.get(value, 'getSliders');
  const setGlobalValue = Reflect.get(value, 'setGlobalValue');
  const serializeControlState = Reflect.get(value, 'serializeControlState');
  return (
    typeof getSliders === 'function' &&
    typeof setGlobalValue === 'function' &&
    typeof serializeControlState === 'function'
  );
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

function dispatchGameRuntimeControlsChanged(host: GameLifecycleHost): void {
  if (typeof window === 'undefined' || host !== window) {
    return;
  }

  window.dispatchEvent(new Event(GAME_RUNTIME_CONTROLS_EVENT));
}

export function setActiveGameRuntimeControls(host: GameLifecycleHost, value: unknown): void {
  host.__gameSpaceActiveGameRuntimeControls = isGameRuntimeControls(value) ? value : undefined;
  dispatchGameRuntimeControlsChanged(host);
}

export function setActiveGameRuntimeHost(host: GameLifecycleHost, value: GameRuntimeHost | undefined): void {
  host.__gameSpaceActiveGameRuntimeHost = value;
  dispatchGameRuntimeControlsChanged(host);
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

function readGameRuntimeTeardown(value: unknown): GameTeardown | undefined {
  if (isGameTeardown(value)) {
    return value;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const teardown = Reflect.get(value, 'teardown');
  return isGameTeardown(teardown) ? teardown : undefined;
}

function readGameRuntimeControls(value: unknown): GameRuntimeControls | undefined {
  if (!isGameRuntimeControls(value)) {
    return undefined;
  }

  return value;
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

function buildControlStateEndpoint(versionId: string): string {
  return `/api/games/${encodeURIComponent(versionId)}/control-state`;
}

export function createGameRuntimeHost(
  versionId: string,
  initialControlState: GameControlState | null,
  csrfToken: string | null
): GameRuntimeHost {
  let cachedControlState = initialControlState;

  function loadControlState(): Promise<GameControlState | null> {
    return Promise.resolve(cachedControlState);
  }

  const safeCsrfToken = csrfToken;
  if (typeof safeCsrfToken !== 'string' || safeCsrfToken.length === 0) {
    return {
      versionId,
      loadControlState
    };
  }
  const writableCsrfToken = safeCsrfToken;

  async function saveControlState(controlState: GameControlState): Promise<void> {
    const response = await fetch(buildControlStateEndpoint(versionId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': writableCsrfToken
      },
      body: JSON.stringify({ controlState })
    });
    if (!response.ok) {
      throw new Error(`Failed to save control state: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (typeof payload !== 'object' || payload === null) {
      cachedControlState = controlState;
      return;
    }

    const parsedControlState = parseGameControlState(Reflect.get(payload, 'controlState'));
    cachedControlState = parsedControlState ?? controlState;
  }

  return {
    versionId,
    loadControlState,
    saveControlState
  };
}

export function GamePageClientBootstrap({
  versionId,
  isAdmin,
  enableLiveReload,
  csrfToken,
  initialControlState,
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
    setActiveGameRuntimeControls(lifecycleWindow, undefined);

    const canvas = document.getElementById('game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return () => {
        lifecycleWindow.removeEventListener('beforeunload', handleUnload);
        lifecycleWindow.removeEventListener('pagehide', handleUnload);
        lifecycleWindow.removeEventListener('unload', handleUnload);
        setActiveGameRuntimeHost(lifecycleWindow, undefined);
        setActiveGameRuntimeControls(lifecycleWindow, undefined);
        teardownActiveGame();
      };
    }

    if (isAdmin) {
      withPreservedDrawingBuffer(canvas);
    }

    let isDisposed = false;
    const runtimeHost = createGameRuntimeHost(versionId, initialControlState, csrfToken);
    setActiveGameRuntimeHost(lifecycleWindow, runtimeHost);
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

        const runtimeHandle = startGame(canvas, runtimeHost);
        const runtimeControls = readGameRuntimeControls(runtimeHandle);
        const maybeTeardown = readGameRuntimeTeardown(runtimeHandle);
        if (isDisposed) {
          if (isGameTeardown(maybeTeardown)) {
            invokeGameTeardownSafely(maybeTeardown);
          }
          return;
        }

        setActiveGameRuntimeControls(lifecycleWindow, runtimeControls);
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
      setActiveGameRuntimeHost(lifecycleWindow, undefined);
      setActiveGameRuntimeControls(lifecycleWindow, undefined);
      teardownActiveGame();
    };
  }, [csrfToken, initialControlState, isAdmin, versionId]);

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
