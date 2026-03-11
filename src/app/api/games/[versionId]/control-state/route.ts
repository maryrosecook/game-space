import {
  handleApiGameControlStateGet,
  handleApiGameControlStatePost,
} from '../../../../../services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { versionId } = await context.params;
  return handleApiGameControlStateGet(versionId);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { versionId } = await context.params;
  return handleApiGameControlStatePost(request, versionId);
}
