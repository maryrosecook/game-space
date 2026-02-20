import {
  createAnimationLoop,
  createAssetStore,
  createTouchInputMapper,
  createTouchStateTracker,
  createRandom,
  createSceneMachine
} from './runtime';
import { createStarterGame, starterConfig, type StarterScene } from './starterGame';

export function startGame(canvas: HTMLCanvasElement): void {
  const gl = canvas.getContext('webgl');
  if (!gl) {
    throw new Error('WebGL is unavailable in this browser');
  }

  const scenes = createSceneMachine<StarterScene>('playing');
  const assets = createAssetStore();
  const random = createRandom(starterConfig.randomSeed);
  canvas.style.touchAction = 'none';
  const touch = createTouchStateTracker(window, canvas);
  const inputMapper = createTouchInputMapper(starterConfig.inputBindings);
  const game = createStarterGame(starterConfig);

  let state = game.init({
    canvas,
    gl,
    scenes,
    assets,
    random
  });
  let frameInput = inputMapper.map(touch.snapshot());

  const loopController = createAnimationLoop(canvas, game.loop, {
    beginFrame: () => {
      frameInput = inputMapper.map(touch.snapshot());
    },
    update: (loopUpdateContext) => {
      state = game.update(state, {
        deltaSeconds: loopUpdateContext.deltaSeconds,
        elapsedSeconds: loopUpdateContext.elapsedSeconds,
        stepIndex: loopUpdateContext.stepIndex,
        frame: loopUpdateContext.frame,
        scene: scenes.getCurrentScene(),
        setScene: (nextScene) => {
          scenes.setScene(nextScene);
        },
        input: frameInput
      });
    },
    render: (loopRenderContext) => {
      game.render(state, {
        elapsedSeconds: loopRenderContext.elapsedSeconds,
        frame: loopRenderContext.frame,
        scene: scenes.getCurrentScene()
      });
    },
    onResize: (frame) => {
      if (game.onResize) {
        game.onResize(state, { frame });
      }
    }
  });

  window.addEventListener(
    'pagehide',
    () => {
      loopController.stop();
      touch.dispose();
      if (game.dispose) {
        game.dispose(state);
      }
    },
    { once: true }
  );
}
