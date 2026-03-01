import { handleApiIdeasBuildPost } from '../../../../../../src/services/nextBackendHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ ideaIndex: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { ideaIndex } = await context.params;
  return handleApiIdeasBuildPost(request, ideaIndex);
}
