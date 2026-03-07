'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { archiveIdea, buildIdea, fetchIdeas, generateIdea } from '../../../src/react/api/client';
import { IdeasApp } from '../../../src/react/components/IdeasApp';
import type { IdeasBaseGameOption, IdeasIdea, IdeasPageData } from '../../../src/react/types';

type IdeasPageClientProps = {
  initialData: IdeasPageData;
};

const IDEAS_STARTER_VERSION_ID = 'starter';

function resolveBaseGameVersionId(
  options: readonly IdeasBaseGameOption[],
  requestedVersionId: string,
): string {
  if (options.some((option) => option.id === requestedVersionId)) {
    return requestedVersionId;
  }

  return options[0]?.id ?? IDEAS_STARTER_VERSION_ID;
}

export function IdeasPageClient({ initialData }: IdeasPageClientProps) {
  const [ideas, setIdeas] = useState<readonly IdeasIdea[]>(initialData.ideas);
  const [isGenerating, setIsGenerating] = useState(initialData.isGenerating);
  const [baseGameVersionId, setBaseGameVersionId] = useState(() =>
    resolveBaseGameVersionId(initialData.baseGameOptions, initialData.initialBaseGameVersionId),
  );
  const [isBaseGameSelectorOpen, setIsBaseGameSelectorOpen] = useState(false);
  const baseGameSelectorRef = useRef<HTMLDivElement | null>(null);
  const activeGenerationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const body = document.body;
    body.className = 'codex-page';
    body.dataset.csrfToken = initialData.csrfToken;
    body.dataset.ideaBuildIcon = initialData.rocketIdeaIcon;
    body.dataset.ideaArchiveIcon = initialData.archiveIdeaIcon;
    delete body.dataset.ideaDeleteIcon;
    delete body.dataset.versionId;
    delete body.dataset.gameFavorited;
    delete body.dataset.codegenProvider;
    body.style.removeProperty('--game-tile-color');
  }, [initialData.archiveIdeaIcon, initialData.csrfToken, initialData.rocketIdeaIcon]);

  const syncIdeasState = useCallback(async () => {
    const response = await fetchIdeas(initialData.csrfToken);
    if (!response.ok) {
      return;
    }

    if (response.ideas !== null) {
      setIdeas(response.ideas);
    }
    setIsGenerating(response.isGenerating);
  }, [initialData.csrfToken]);

  const onGenerate = useCallback(() => {
    activeGenerationRef.current?.abort();

    const requestController = new AbortController();
    activeGenerationRef.current = requestController;
    setIsGenerating(true);
    setIsBaseGameSelectorOpen(false);

    void (async () => {
      const response = await generateIdea(
        initialData.csrfToken,
        requestController.signal,
        baseGameVersionId,
      );
      if (activeGenerationRef.current !== requestController) {
        return;
      }

      if (response.ok && response.ideas !== null) {
        setIdeas(response.ideas);
      }
    })()
      .catch(() => {
        // Best-effort refresh only.
      })
      .finally(() => {
        if (activeGenerationRef.current === requestController) {
          activeGenerationRef.current = null;
          setIsGenerating(false);
        }
      });
  }, [baseGameVersionId, initialData.csrfToken]);

  const onSelectBaseGame = useCallback((nextBaseGameVersionId: string) => {
    setBaseGameVersionId(
      resolveBaseGameVersionId(initialData.baseGameOptions, nextBaseGameVersionId),
    );
    setIsBaseGameSelectorOpen(false);
  }, [initialData.baseGameOptions]);

  const onToggleBaseGameSelector = useCallback(() => {
    setIsBaseGameSelectorOpen((isOpen) => !isOpen);
  }, []);

  useEffect(() => {
    if (!isBaseGameSelectorOpen) {
      return;
    }

    function handleWindowPointerDown(event: PointerEvent): void {
      if (!(event.target instanceof Node) || !baseGameSelectorRef.current?.contains(event.target)) {
        setIsBaseGameSelectorOpen(false);
      }
    }

    function handleWindowEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsBaseGameSelectorOpen(false);
      }
    }

    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowEscape);

    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowEscape);
    };
  }, [isBaseGameSelectorOpen]);

  const onArchive = useCallback(
    (ideaIndex: number) => {
      if (!window.confirm('Archive this idea?')) {
        return;
      }

      void (async () => {
        const response = await archiveIdea(initialData.csrfToken, ideaIndex);
        if (response.ok && response.ideas !== null) {
          setIdeas(response.ideas);
        }
      })();
    },
    [initialData.csrfToken],
  );

  const onBuild = useCallback(
    (ideaIndex: number) => {
      void (async () => {
        const response = await buildIdea(initialData.csrfToken, ideaIndex);
        if (!response.ok) {
          return;
        }

        if (response.ideas !== null) {
          setIdeas(response.ideas);
        }

        if (typeof response.forkId === 'string' && response.forkId.length > 0) {
          window.location.assign(`/game/${encodeURIComponent(response.forkId)}`);
        }
      })();
    },
    [initialData.csrfToken],
  );

  useEffect(() => {
    const handlePageShow = () => {
      void syncIdeasState();
    };

    window.addEventListener('pageshow', handlePageShow);
    void syncIdeasState();

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      activeGenerationRef.current?.abort();
      activeGenerationRef.current = null;
    };
  }, [syncIdeasState]);

  return (
    <IdeasApp
      data={{
        ...initialData,
        ideas,
        isGenerating,
        baseGameVersionId,
      }}
      onGenerate={onGenerate}
      onSelectBaseGame={onSelectBaseGame}
      onToggleBaseGameSelector={onToggleBaseGameSelector}
      onBuild={onBuild}
      onArchive={onArchive}
      baseGameSelectorRef={baseGameSelectorRef}
      isBaseGameSelectorOpen={isBaseGameSelectorOpen}
    />
  );
}
