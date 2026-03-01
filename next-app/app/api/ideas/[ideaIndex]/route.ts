import { handleApiIdeasDelete } from '../../../../../src/services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ ideaIndex: string }>;
};

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { ideaIndex } = await context.params;
  return handleApiIdeasDelete(request, ideaIndex);
}
