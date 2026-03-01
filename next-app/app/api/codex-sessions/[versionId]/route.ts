import { handleApiCodexSessionsGet } from '../../../../../src/services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { versionId } = await context.params;
  return handleApiCodexSessionsGet(request, versionId);
}
