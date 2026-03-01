import path from 'node:path';

import { Lightbulb, Rocket, Trash2, type IconNode } from 'lucide';
import { cookies, headers } from 'next/headers';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { IdeasPageData } from '../../../src/react/types';
import {
  ADMIN_SESSION_TTL_SECONDS,
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv,
} from '../../../src/services/adminAuth';
import {
  CSRF_COOKIE_NAME,
  ensureCsrfTokenFromCookieHeader,
} from '../../../src/services/csrf';
import { readIdeasFile } from '../../../src/services/ideas';
import { readSharedIdeaGenerationRuntimeState } from '../../../src/services/serverRuntimeState';
import { IdeasPageClient } from './IdeasPageClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ideas',
};

type LucideIconName = 'lightbulb' | 'rocket' | 'trash-2';

const LUCIDE_ICON_NODES: Record<LucideIconName, IconNode> = {
  lightbulb: Lightbulb,
  rocket: Rocket,
  'trash-2': Trash2,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLucideNode(iconNode: IconNode): string {
  return iconNode
    .map(([tagName, attributes]) => {
      const serializedAttributes = Object.entries(attributes)
        .filter(([, attributeValue]) => attributeValue !== undefined)
        .map(
          ([attributeName, attributeValue]) =>
            `${attributeName}="${escapeHtml(String(attributeValue))}"`,
        )
        .join(' ');

      return serializedAttributes.length > 0
        ? `<${tagName} ${serializedAttributes}></${tagName}>`
        : `<${tagName}></${tagName}>`;
    })
    .join('');
}

function renderLucideIcon(
  iconName: LucideIconName,
  className: string,
  size: number = 18,
): string {
  return `<svg class="${className} lucide lucide-${iconName}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${renderLucideNode(LUCIDE_ICON_NODES[iconName])}</svg>`;
}

function serializePageData(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

async function ensurePageCsrfToken(cookieHeader: string | undefined): Promise<string> {
  const { token, setCookieHeader } = ensureCsrfTokenFromCookieHeader(cookieHeader);

  if (typeof setCookieHeader === 'string') {
    const cookieStore = await cookies();
    cookieStore.set({
      name: CSRF_COOKIE_NAME,
      value: token,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: ADMIN_SESSION_TTL_SECONDS,
    });
  }

  return token;
}

function renderBodySetupScript(options: {
  csrfToken: string;
  ideaBuildIcon: string;
  ideaDeleteIcon: string;
}): string {
  const serializedOptions = serializePageData(options);

  return `(() => {
    const body = document.body;
    const options = ${serializedOptions};
    body.className = 'codex-page';
    body.dataset.csrfToken = options.csrfToken;
    body.dataset.ideaBuildIcon = options.ideaBuildIcon;
    body.dataset.ideaDeleteIcon = options.ideaDeleteIcon;
    delete body.dataset.versionId;
    delete body.dataset.gameFavorited;
    delete body.dataset.codegenProvider;
    body.style.removeProperty('--game-tile-color');
  })();`;
}

export default async function IdeasPage() {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? undefined;
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(cookieHeader, authConfig);

  if (!isAdmin) {
    notFound();
  }

  const csrfToken = await ensurePageCsrfToken(cookieHeader);
  const ideas = await readIdeasFile(path.join(process.cwd(), 'ideas.json'));
  const ideasData: IdeasPageData = {
    csrfToken,
    ideas,
    isGenerating: readSharedIdeaGenerationRuntimeState().isGenerating(),
    lightbulbIdeaIcon: renderLucideIcon('lightbulb', 'idea-icon'),
    rocketIdeaIcon: renderLucideIcon('rocket', 'idea-icon'),
    trashIdeaIcon: renderLucideIcon('trash-2', 'idea-icon'),
  };

  return (
    <>
      <script
        id="ideas-body-setup"
        dangerouslySetInnerHTML={{
          __html: renderBodySetupScript({
            csrfToken,
            ideaBuildIcon: ideasData.rocketIdeaIcon,
            ideaDeleteIcon: ideasData.trashIdeaIcon,
          }),
        }}
      />
      <div id="ideas-react-root">
        <IdeasPageClient initialData={ideasData} />
      </div>
    </>
  );
}
