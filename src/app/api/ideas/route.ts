import { handleApiIdeasGet } from '../../../services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleApiIdeasGet(request);
}
