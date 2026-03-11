import { describe, expect, it } from 'vitest';
import { createStarterDataSource } from '../games/starter/src/main';

describe('starter runtime defaults', () => {
  it('loads a particle emitter scene with runtime slider metadata', async () => {
    const dataSource = createStarterDataSource();
    const loadedGame = await dataSource.loadGame('starter');

    expect(loadedGame.gameDirectory).toBe('starter');
    expect(loadedGame.game.things).toHaveLength(1);
    expect(loadedGame.game.blueprints).toHaveLength(1);
    expect(loadedGame.game.camera).toEqual({ x: 0, y: 0 });
    expect(loadedGame.game.backgroundColor).toBe('#020617');
    expect(loadedGame.game.globals).toEqual({ particleAmount: 4 });
    expect(loadedGame.game.editor?.sliders).toEqual([
      {
        id: 'particleAmount',
        label: 'Amount of particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particleAmount'
      }
    ]);
  });

  it('uses no camera controller by default', async () => {
    const dataSource = createStarterDataSource();
    if (!dataSource.loadCamera) {
      throw new Error('Expected starter data source to provide loadCamera');
    }

    await expect(dataSource.loadCamera('starter')).resolves.toBeNull();
  });

  it('merges persisted control-state globals when the runtime host provides them', async () => {
    const dataSource = createStarterDataSource({
      versionId: 'starter',
      loadControlState: () => Promise.resolve({ globals: { particleAmount: 9 } })
    });
    const loadedGame = await dataSource.loadGame('starter');

    expect(loadedGame.game.globals).toEqual({ particleAmount: 9 });
  });
});
