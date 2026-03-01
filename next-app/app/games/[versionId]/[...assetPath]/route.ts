import { handleGamesAssetGet } from '../../../../../src/services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return handleGamesAssetGet(request);
}
