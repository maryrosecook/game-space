import path from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { isSafeVersionId } from './gameVersions';

const allowedRuntimeExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.avif',
  '.bmp',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.mp4',
  '.webm',
  '.ogv',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot'
]);

const blockedDistAssets = new Set(['reload-token.txt']);

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function readDecodedPathSegments(requestPath: string): string[] | null {
  const rawSegments = requestPath.split('/').filter((segment) => segment.length > 0);
  const decodedSegments: string[] = [];

  for (const rawSegment of rawSegments) {
    const decodedSegment = decodePathSegment(rawSegment);
    if (typeof decodedSegment !== 'string') {
      return null;
    }

    decodedSegments.push(decodedSegment);
  }

  return decodedSegments;
}

function isUnsafePathSegment(segment: string): boolean {
  if (segment === '.' || segment === '..') {
    return true;
  }

  if (segment.startsWith('.')) {
    return true;
  }

  return segment.includes('/') || segment.includes('\\') || segment.includes('\u0000');
}

export function isAllowedGamesRuntimeAssetPath(requestPath: string): boolean {
  const segments = readDecodedPathSegments(requestPath);
  if (!segments || segments.length < 3) {
    return false;
  }

  const versionId = segments[0];
  const rootDirectory = segments[1];
  const assetSegments = segments.slice(2);
  if (typeof versionId !== 'string' || !isSafeVersionId(versionId)) {
    return false;
  }

  if (rootDirectory !== 'dist' && rootDirectory !== 'snapshots') {
    return false;
  }

  if (assetSegments.length === 0 || assetSegments.some((segment) => isUnsafePathSegment(segment))) {
    return false;
  }


  if (rootDirectory === 'snapshots') {
    return assetSegments.length === 1 && assetSegments[0]?.toLowerCase() === 'tile.png';
  }

  const normalizedAssetPath = path.posix.normalize(assetSegments.join('/'));
  if (
    normalizedAssetPath.length === 0 ||
    normalizedAssetPath === '.' ||
    normalizedAssetPath === '..' ||
    normalizedAssetPath.startsWith('../') ||
    normalizedAssetPath.startsWith('/')
  ) {
    return false;
  }

  const normalizedAssetPathLower = normalizedAssetPath.toLowerCase();
  if (blockedDistAssets.has(normalizedAssetPathLower) || normalizedAssetPathLower.endsWith('/reload-token.txt')) {
    return false;
  }

  if (normalizedAssetPathLower.endsWith('.map')) {
    return false;
  }

  const extension = path.posix.extname(normalizedAssetPathLower);
  if (extension.length === 0 || !allowedRuntimeExtensions.has(extension)) {
    return false;
  }

  return true;
}

export function requireRuntimeGameAssetPath(request: Request, response: Response, next: NextFunction): void {
  if (!isAllowedGamesRuntimeAssetPath(request.path)) {
    response.status(404).type('text/plain').send('Not found');
    return;
  }

  next();
}

export function requireRuntimeGameAssetPathMiddleware(): RequestHandler {
  return requireRuntimeGameAssetPath;
}
