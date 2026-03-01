import path from 'node:path';

import {
  Bot,
  ChevronLeft,
  Mic,
  Rocket,
  Settings,
  Star,
  Trash2,
  Video,
  type IconNode,
} from 'lucide';
import { cookies, headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { GameApp } from '../../../../src/react/components/GameApp';
import type { GamePageData } from '../../../../src/react/types';
import {
  ADMIN_SESSION_TTL_SECONDS,
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv,
} from '../../../../src/services/adminAuth';
import {
  CSRF_COOKIE_NAME,
  ensureCsrfTokenFromCookieHeader,
} from '../../../../src/services/csrf';
import { pathExists } from '../../../../src/services/fsUtils';
import {
  gameDirectoryPath,
  hasGameDirectory,
  isSafeVersionId,
  readMetadataFile,
} from '../../../../src/services/gameVersions';
import { readSharedCodegenConfigStore } from '../../../../src/services/serverRuntimeState';
import { GamePageClientBootstrap } from './GamePageClientBootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

type LucideIconName =
  | 'bot'
  | 'chevron-left'
  | 'mic'
  | 'rocket'
  | 'settings'
  | 'star'
  | 'trash-2'
  | 'video';

const LUCIDE_ICON_NODES: Record<LucideIconName, IconNode> = {
  bot: Bot,
  'chevron-left': ChevronLeft,
  mic: Mic,
  rocket: Rocket,
  settings: Settings,
  star: Star,
  'trash-2': Trash2,
  video: Video,
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

function codegenProviderLabel(codegenProvider: 'codex' | 'claude'): string {
  return codegenProvider === 'claude' ? 'Claude' : 'Codex';
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
  className: string;
  versionId: string;
  csrfToken: string | null;
  gameFavorited: boolean;
  codegenProvider: 'codex' | 'claude';
  tileColor: string;
}): string {
  const serializedOptions = serializePageData(options);

  return `(() => {
    const body = document.body;
    const options = ${serializedOptions};
    body.className = options.className;
    body.dataset.versionId = options.versionId;
    if (typeof options.csrfToken === 'string') {
      body.dataset.csrfToken = options.csrfToken;
    } else {
      delete body.dataset.csrfToken;
    }
    body.dataset.gameFavorited = options.gameFavorited ? 'true' : 'false';
    body.dataset.codegenProvider = options.codegenProvider;
    delete body.dataset.ideaBuildIcon;
    delete body.dataset.ideaDeleteIcon;
    delete body.dataset.gameReactHydrated;
    body.style.setProperty('--game-tile-color', options.tileColor);
  })();`;
}

function renderInteractionGuardsScript(): string {
  return `(() => {
    let lastTouchEndAt = 0;

    const isTextEntryTarget = (target) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    document.addEventListener(
      'touchend',
      (event) => {
        const now = Date.now();
        if (now - lastTouchEndAt <= 300) {
          event.preventDefault();
        }
        lastTouchEndAt = now;
      },
      { passive: false }
    );

    document.addEventListener(
      'dblclick',
      (event) => {
        event.preventDefault();
      },
      { passive: false }
    );

    document.addEventListener(
      'selectstart',
      (event) => {
        if (isTextEntryTarget(event.target)) {
          return;
        }

        event.preventDefault();
      },
      { passive: false }
    );

    document.addEventListener(
      'contextmenu',
      (event) => {
        if (isTextEntryTarget(event.target)) {
          return;
        }

        event.preventDefault();
      },
      { passive: false }
    );
  })();`;
}

export async function generateMetadata(context: RouteContext): Promise<Metadata> {
  const { versionId } = await context.params;

  return {
    title: `Game ${versionId}`,
  };
}

export default async function GamePage(context: RouteContext) {
  const { versionId } = await context.params;
  if (!isSafeVersionId(versionId)) {
    notFound();
  }

  const gamesRootPath = path.join(process.cwd(), 'games');
  if (!(await hasGameDirectory(gamesRootPath, versionId))) {
    notFound();
  }

  const gameBundlePath = path.join(gamesRootPath, versionId, 'dist', 'game.js');
  if (!(await pathExists(gameBundlePath))) {
    notFound();
  }

  const metadataPath = path.join(gameDirectoryPath(gamesRootPath, versionId), 'metadata.json');
  const metadata = await readMetadataFile(metadataPath);
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? undefined;
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(cookieHeader, authConfig);
  const csrfToken = isAdmin ? await ensurePageCsrfToken(cookieHeader) : null;

  const codegenProvider = readSharedCodegenConfigStore().read().provider;
  const providerLabel = codegenProviderLabel(codegenProvider);
  const isFavorite = metadata?.favorite === true;
  const tileColor =
    typeof metadata?.tileColor === 'string' && metadata.tileColor.length > 0
      ? metadata.tileColor
      : '#1D3557';
  const gameData: GamePageData = {
    versionId,
    isAdmin,
    isFavorite,
    codegenProvider,
    providerLabel,
    enableLiveReload: process.env.GAME_SPACE_DEV_LIVE_RELOAD === '1',
    homeIcon: renderLucideIcon('chevron-left', 'game-view-icon', 22),
    settingsIcon: renderLucideIcon('settings', 'game-view-icon'),
    micIcon: renderLucideIcon('mic', 'game-view-icon'),
    rocketIcon: renderLucideIcon('rocket', 'game-view-icon'),
    starIcon: renderLucideIcon('star', 'game-view-icon'),
    botIcon: renderLucideIcon('bot', 'game-view-icon'),
    videoIcon: renderLucideIcon('video', 'game-view-icon'),
    trashIcon: renderLucideIcon('trash-2', 'game-view-icon'),
  };

  return (
    <>
      <script
        id="game-body-setup"
        dangerouslySetInnerHTML={{
          __html: renderBodySetupScript({
            className: isAdmin ? 'game-page game-page--admin' : 'game-page game-page--public',
            versionId,
            csrfToken,
            gameFavorited: isFavorite,
            codegenProvider,
            tileColor,
          }),
        }}
      />
      <div id="game-react-root">
        <GameApp data={gameData} />
      </div>
      <GamePageClientBootstrap
        versionId={versionId}
        isAdmin={isAdmin}
        enableLiveReload={gameData.enableLiveReload}
      />
      <script
        id="game-interaction-guards"
        dangerouslySetInnerHTML={{
          __html: renderInteractionGuardsScript(),
        }}
      />
    </>
  );
}
