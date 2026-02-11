import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function reloadTokenPath(gamesRootPath: string, versionId: string): string {
  return path.join(gamesRootPath, versionId, 'dist', 'reload-token.txt');
}

export async function writeReloadToken(
  gamesRootPath: string,
  versionId: string,
  tokenFactory: () => string = () => `${Date.now()}-${randomUUID()}`
): Promise<string> {
  const token = tokenFactory();
  const tokenPath = reloadTokenPath(gamesRootPath, versionId);
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, `${token}\n`, 'utf8');
  return token;
}
