'use client';

import { useEffect, useMemo, useState } from 'react';

import { fetchCodexSession } from '../../../src/react/api/client';
import { CodexApp } from '../../../src/react/components/CodexApp';
import type { CodexPageData, CodexTranscriptState } from '../../../src/react/types';

type CodexPageClientProps = {
  initialData: CodexPageData;
};

function parseVersionIdFromQuery(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const url = new URL(window.location.href);
  const versionId = url.searchParams.get('versionId');
  return typeof versionId === 'string' && versionId.trim().length > 0 ? versionId : null;
}

function setQueryVersionId(versionId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('versionId', versionId);
  window.history.replaceState(null, '', url);
}

function transcriptProviderLabel(codegenProvider: 'codex' | 'claude'): string {
  return codegenProvider === 'claude' ? 'Claude' : 'Codex';
}

function createUnavailableState(description: string): CodexTranscriptState {
  return {
    kind: 'empty',
    title: 'Session unavailable',
    description,
  };
}

function createInitialSelectedVersionId(data: CodexPageData): string | null {
  const versionIdFromQuery = parseVersionIdFromQuery();
  if (versionIdFromQuery === null) {
    return data.initialSelectedVersionId;
  }

  for (const version of data.versions) {
    if (version.id === versionIdFromQuery) {
      return versionIdFromQuery;
    }
  }

  return data.initialSelectedVersionId;
}

export function CodexPageClient({ initialData }: CodexPageClientProps) {
  const providerLabel = transcriptProviderLabel(initialData.codegenProvider);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(() =>
    createInitialSelectedVersionId(initialData),
  );
  const [transcriptState, setTranscriptState] = useState<CodexTranscriptState>(
    initialData.initialTranscript,
  );

  useEffect(() => {
    const body = document.body;
    body.className = 'codex-page';
    body.dataset.codegenProvider = initialData.codegenProvider;
    delete body.dataset.versionId;
    delete body.dataset.csrfToken;
    delete body.dataset.gameFavorited;
    delete body.dataset.ideaBuildIcon;
    delete body.dataset.ideaDeleteIcon;
    body.style.removeProperty('--game-tile-color');
  }, [initialData.codegenProvider]);

  useEffect(() => {
    if (selectedVersionId === null || selectedVersionId.length === 0) {
      setTranscriptState({
        kind: 'empty',
        title: 'No version selected',
        description: 'Choose a game to inspect transcript messages.',
      });
      return;
    }

    setQueryVersionId(selectedVersionId);
    setTranscriptState({ kind: 'loading' });

    let isCanceled = false;
    void (async () => {
      const response = await fetchCodexSession(selectedVersionId);
      if (isCanceled) {
        return;
      }

      if (!response.ok && response.status === 0) {
        setTranscriptState(createUnavailableState('Could not reach the server.'));
        return;
      }

      if (!response.ok) {
        setTranscriptState(createUnavailableState(`Server returned ${response.status}.`));
        return;
      }

      if (response.result.kind === 'no-session') {
        setTranscriptState({
          kind: 'empty',
          title: 'No session linked',
          description: `This game version does not have a saved ${providerLabel} session id.`,
        });
        return;
      }

      if (response.result.kind === 'session-file-missing') {
        setTranscriptState({
          kind: 'empty',
          title: 'Session file not found',
          description: 'The linked session id exists in metadata but no matching JSONL file was found.',
        });
        return;
      }

      if (response.result.kind === 'invalid') {
        setTranscriptState(createUnavailableState('Unexpected transcript payload.'));
        return;
      }

      setTranscriptState({
        kind: 'ready',
        sessionId: response.result.sessionId,
        messages: response.result.messages,
      });
    })();

    return () => {
      isCanceled = true;
    };
  }, [providerLabel, selectedVersionId]);

  useEffect(() => {
    if (transcriptState.kind !== 'ready') {
      return;
    }

    const sessionView = document.getElementById('codex-session-view');
    if (!(sessionView instanceof HTMLElement)) {
      return;
    }

    sessionView.scrollTop = sessionView.scrollHeight;
  }, [transcriptState]);

  const appData = useMemo(
    () => ({
      ...initialData,
      initialSelectedVersionId: selectedVersionId,
      initialTranscript: transcriptState,
    }),
    [initialData, selectedVersionId, transcriptState],
  );

  return (
    <CodexApp
      data={appData}
      onVersionChange={(versionId) => {
        setSelectedVersionId(versionId.length > 0 ? versionId : null);
      }}
    />
  );
}
