import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('fragment shader sets the ball color to blue', async () => {
  const sourcePath = path.join(process.cwd(), 'src', 'main.ts');
  const sourceText = await fs.readFile(sourcePath, 'utf8');

  assert.ok(sourceText.includes('gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);'));
  assert.ok(!sourceText.includes('gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);'));
});
