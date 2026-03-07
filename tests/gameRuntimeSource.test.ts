import { describe, expect, it } from 'vitest';
import { createStarterDataSource } from '../games/starter/src/main';

describe('starter runtime defaults', () => {
  it('loads an empty default scene with background-only rendering state', async () => {
    const dataSource = createStarterDataSource();
    const loadedGame = await dataSource.loadGame('starter');

    expect(loadedGame.gameDirectory).toBe('starter');
    expect(loadedGame.game.things).toEqual([]);
    expect(loadedGame.game.blueprints).toEqual([]);
    expect(loadedGame.game.camera).toEqual({ x: 0, y: 0 });
    expect(loadedGame.game.backgroundColor).toBe('#020617');
  });

  it('uses no camera controller by default', async () => {
    const dataSource = createStarterDataSource();
    if (!dataSource.loadCamera) {
      throw new Error('Expected starter data source to provide loadCamera');
    }

    await expect(dataSource.loadCamera('starter')).resolves.toBeNull();
  });
});
