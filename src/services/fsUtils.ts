import { promises as fs } from 'node:fs';

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isObjectRecord(error) && 'code' in error && typeof error.code === 'string' && error.code === code;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}
