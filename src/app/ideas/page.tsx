import path from 'node:path';

import { Archive, Lightbulb, Rocket, type IconNode } from 'lucide';
import { cookies, headers } from 'next/headers';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { IdeasBaseGameOption, IdeasPageData } from '../shared/types';
import {
  ADMIN_SESSION_TTL_SECONDS,
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv,
} from '../../services/adminAuth';
import {
  CSRF_COOKIE_NAME,
  ensureCsrfTokenFromCookieHeader,
} from '../../services/csrf';
import { listGameVersions } from '../../services/gameVersions';
import { readIdeasFile } from '../../services/ideas';
import { readSharedIdeaGenerationRuntimeState } from '../../services/serverRuntimeState';
import type { GameVersion } from '../../types';
import { IdeasPageClient } from './IdeasPageClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ideas',
};

type LucideIconName = 'archive' | 'lightbulb' | 'rocket';

const IDEAS_STARTER_VERSION_ID = 'starter';
const DEFAULT_TILE_COLOR = '#1D3557';

const LUCIDE_ICON_NODES: Record<LucideIconName, IconNode> = {
  archive: Archive,
  lightbulb: Lightbulb,
  rocket: Rocket,
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
  ideaArchiveIcon: string;
}): string {
  const serializedOptions = serializePageData(options);

  return `(() => {
    const body = document.body;
    const options = ${serializedOptions};
    body.className = 'codex-page';
    body.dataset.csrfToken = options.csrfToken;
    body.dataset.ideaBuildIcon = options.ideaBuildIcon;
    body.dataset.ideaArchiveIcon = options.ideaArchiveIcon;
    delete body.dataset.ideaDeleteIcon;
    delete body.dataset.versionId;
    delete body.dataset.gameFavorited;
    delete body.dataset.codegenProvider;
    body.style.removeProperty('--game-tile-color');
  })();`;
}

function toIdeasBaseGameOption(version: GameVersion): IdeasBaseGameOption {
  return {
    id: version.id,
    displayName: (version.threeWords ?? version.id).replaceAll('-', ' '),
    tileColor: typeof version.tileColor === 'string' ? version.tileColor : DEFAULT_TILE_COLOR,
    tileSnapshotPath:
      typeof version.tileSnapshotPath === 'string' && version.tileSnapshotPath.length > 0
        ? version.tileSnapshotPath
        : null,
  };
}

function buildIdeasBaseGameOptions(versions: readonly GameVersion[]): IdeasBaseGameOption[] {
  const starterVersion = versions.find((version) => version.id === IDEAS_STARTER_VERSION_ID);
  const favoriteNonStarterVersions = versions.filter(
    (version) => version.favorite === true && version.id !== IDEAS_STARTER_VERSION_ID,
  );

  const options: IdeasBaseGameOption[] = [];
  if (starterVersion) {
    options.push(toIdeasBaseGameOption(starterVersion));
  } else {
    options.push({
      id: IDEAS_STARTER_VERSION_ID,
      displayName: IDEAS_STARTER_VERSION_ID,
      tileColor: DEFAULT_TILE_COLOR,
      tileSnapshotPath: null,
    });
  }

  for (const version of favoriteNonStarterVersions) {
    options.push(toIdeasBaseGameOption(version));
  }

  return options;
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
  const versions = await listGameVersions(path.join(process.cwd(), 'games'));
  const baseGameOptions = buildIdeasBaseGameOptions(versions);
  const ideasData: IdeasPageData = {
    csrfToken,
    ideas,
    isGenerating: readSharedIdeaGenerationRuntimeState().isGenerating(),
    baseGameOptions,
    initialBaseGameVersionId: IDEAS_STARTER_VERSION_ID,
    lightbulbIdeaIcon: renderLucideIcon('lightbulb', 'idea-icon'),
    rocketIdeaIcon: renderLucideIcon('rocket', 'idea-icon'),
    archiveIdeaIcon: renderLucideIcon('archive', 'idea-icon'),
  };

  return (
    <>
      <script
        id="ideas-body-setup"
        dangerouslySetInnerHTML={{
          __html: renderBodySetupScript({
            csrfToken,
            ideaBuildIcon: ideasData.rocketIdeaIcon,
            ideaArchiveIcon: ideasData.archiveIdeaIcon,
          }),
        }}
      />
      <div id="ideas-react-root">
        <IdeasPageClient initialData={ideasData} />
      </div>
    </>
  );
}
