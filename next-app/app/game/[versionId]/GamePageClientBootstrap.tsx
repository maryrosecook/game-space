'use client';

import { useEffect } from 'react';

type GamePageClientBootstrapProps = {
  versionId: string;
  isAdmin: boolean;
  enableLiveReload: boolean;
};

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
    const canvas = document.getElementById('game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (isAdmin) {
      withPreservedDrawingBuffer(canvas);
    }

    const startGameModulePath = `/games/${encodeURIComponent(versionId)}/dist/game.js`;
    void import(/* webpackIgnore: true */ startGameModulePath)
      .then((gameModule: unknown) => {
        if (!gameModule || typeof gameModule !== 'object') {
          return;
        }

        const startGame = Reflect.get(gameModule, 'startGame');
        if (typeof startGame !== 'function') {
          return;
        }

        startGame(canvas);
      })
      .catch(() => {
        // Keep initial render stable when the game bundle is unavailable.
      });
  }, [isAdmin, versionId]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void import('../../../../src/react/legacy/game-view-client.js').catch(() => {
      // Keep page render stable if admin controls fail to initialize.
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!enableLiveReload) {
      return;
    }

    void import('../../../../src/react/legacy/game-live-reload-client.js').catch(() => {
      // Keep page render stable if live reload client fails to initialize.
    });
  }, [enableLiveReload]);

  return null;
}
