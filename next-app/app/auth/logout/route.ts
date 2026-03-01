import { handleAuthLogoutPost } from '../../../../src/services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleAuthLogoutPost(request);
}
