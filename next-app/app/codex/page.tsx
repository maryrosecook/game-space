import path from 'node:path';

import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { CodexPageData } from '../../../src/react/types';
import {
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv,
} from '../../../src/services/adminAuth';
import { listGameVersions } from '../../../src/services/gameVersions';
import { readSharedCodegenConfigStore } from '../../../src/services/serverRuntimeState';
import { CodexPageClient } from './CodexPageClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Codex/Claude Sessions',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function codegenProviderLabel(codegenProvider: 'codex' | 'claude'): string {
  return codegenProvider === 'claude' ? 'Claude' : 'Codex';
}

function serializePageData(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderBodySetupScript(codegenProvider: 'codex' | 'claude'): string {
  const serializedProvider = serializePageData(codegenProvider);

  return `(() => {
    const body = document.body;
    body.className = 'codex-page';
    body.dataset.codegenProvider = ${serializedProvider};
    delete body.dataset.versionId;
    delete body.dataset.csrfToken;
    delete body.dataset.gameFavorited;
    delete body.dataset.ideaBuildIcon;
    delete body.dataset.ideaDeleteIcon;
    body.style.removeProperty('--game-tile-color');
  })();`;
}

export default async function CodexPage() {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? undefined;
  const authConfig = readAdminAuthConfigFromEnv();
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(cookieHeader, authConfig);

  if (!isAdmin) {
    notFound();
  }

  const versions = await listGameVersions(path.join(process.cwd(), 'games'));
  const codegenProvider = readSharedCodegenConfigStore().read().provider;
  const providerLabel = codegenProviderLabel(codegenProvider);
  const codexData: CodexPageData = {
    codegenProvider,
    versions: versions.map((version) => ({
      id: version.id,
      createdLabel: formatDateTime(version.createdTime),
    })),
    initialSelectedVersionId: versions[0]?.id ?? null,
    initialTranscript:
      versions.length > 0
        ? {
            kind: 'empty',
            title: 'Session unavailable',
            description: `Select a game version to inspect its ${providerLabel} transcript.`,
          }
        : {
            kind: 'empty',
            title: 'No versions available',
            description: `Create a game version to inspect ${providerLabel} session transcripts.`,
        },
  };

  return (
    <>
      <script
        id="codex-body-setup"
        dangerouslySetInnerHTML={{
          __html: renderBodySetupScript(codegenProvider),
        }}
      />
      <div id="codex-react-root">
        <CodexPageClient initialData={codexData} />
      </div>
    </>
  );
}
