import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const bouncingGameSourcePaths = [
  'games/v1-bounce/src/main.ts',
  'games/d0cf7658-3371-4f01-99e2-ca90fc1899cf/src/main.ts'
];
const shimmeringBowlsSourcePath = 'games/elm-cloud-sage/src/main.ts';

async function readGameSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

describe('game runtime source', () => {
  it.each(bouncingGameSourcePaths)('keeps circles round in %s', async (relativePath) => {
    const source = await readGameSource(relativePath);

    expect(source).toContain('uniform float u_viewportScale;');
    expect(source).toContain('const viewportScale = canvas.height / Math.max(canvas.width, 1);');
    expect(source).toContain('const horizontalRadius = radius * viewportScale;');
    expect(source).toContain('gl.uniform1f(viewportScaleLocation, viewportScale);');
    expect(source).not.toContain('window.innerWidth');
    expect(source).not.toContain('window.innerHeight');
  });

  it('keeps bowls round in elm-cloud-sage with aspect-aware bounds', async () => {
    const source = await readGameSource(shimmeringBowlsSourcePath);

    expect(source).toContain('const viewportScale = canvas.height / Math.max(canvas.width, 1);');
    expect(source).toContain('const horizontalRadius = bowl.radius * viewportScale;');
    expect(source).not.toContain('window.innerWidth');
    expect(source).not.toContain('window.innerHeight');
  });

  it('renders one thousand shimmering bowls with shader-driven highlights', async () => {
    const source = await readGameSource(shimmeringBowlsSourcePath);

    expect(source).toContain('const BOWL_COUNT = 1000;');
    expect(source).toContain('gl.drawArrays(gl.POINTS, 0, BOWL_COUNT);');
    expect(source).toContain('uniform float u_time;');
    expect(source).toContain('float specular = pow(max(0.0, reflectedLight.z), 30.0);');
  });
});
