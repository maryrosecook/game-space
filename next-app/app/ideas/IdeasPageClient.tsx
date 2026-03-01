'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildIdea, deleteIdea, fetchIdeas, generateIdea } from '../../../src/react/api/client';
import { IdeasApp } from '../../../src/react/components/IdeasApp';
import type { IdeasIdea, IdeasPageData } from '../../../src/react/types';

type IdeasPageClientProps = {
  initialData: IdeasPageData;
};

export function IdeasPageClient({ initialData }: IdeasPageClientProps) {
  const [ideas, setIdeas] = useState<readonly IdeasIdea[]>(initialData.ideas);
  const [isGenerating, setIsGenerating] = useState(initialData.isGenerating);
  const activeGenerationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const body = document.body;
    body.className = 'codex-page';
    body.dataset.csrfToken = initialData.csrfToken;
    body.dataset.ideaBuildIcon = initialData.rocketIdeaIcon;
    body.dataset.ideaDeleteIcon = initialData.trashIdeaIcon;
    delete body.dataset.versionId;
    delete body.dataset.gameFavorited;
    delete body.dataset.codegenProvider;
    body.style.removeProperty('--game-tile-color');
  }, [initialData.csrfToken, initialData.rocketIdeaIcon, initialData.trashIdeaIcon]);

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

    void (async () => {
      const response = await generateIdea(initialData.csrfToken, requestController.signal);
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
  }, [initialData.csrfToken]);

  const onDelete = useCallback(
    (ideaIndex: number) => {
      if (!window.confirm('Delete this idea?')) {
        return;
      }

      void (async () => {
        const response = await deleteIdea(initialData.csrfToken, ideaIndex);
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
      }}
      onGenerate={onGenerate}
      onBuild={onBuild}
      onDelete={onDelete}
    />
  );
}
