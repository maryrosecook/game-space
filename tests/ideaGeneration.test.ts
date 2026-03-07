import { describe, expect, it } from 'vitest';

import { buildIdeaGenerationInput, normalizeIdeaOutput } from '../src/services/ideaGeneration';

describe('idea generation prompt composition', () => {
  it('builds a starter ideation prompt with a creative single-sentence arcade directive', () => {
    const fullPrompt = buildIdeaGenerationInput({
      gameBuildPrompt: 'Build prompt.',
      ideationPrompt: 'Shared guidance.',
      baseGameVersionId: 'starter',
    });

    expect(fullPrompt).toContain('Base game for ideation: `starter`.');
    expect(fullPrompt).toContain(
      'Starter ideation directive: Generate one creative, single-sentence arcade-style game concept.',
    );
    expect(fullPrompt).toContain('Shared guidance.');
  });

  it('builds a non-starter ideation prompt with an off-the-wall single-sentence directive', () => {
    const fullPrompt = buildIdeaGenerationInput({
      gameBuildPrompt: 'Build prompt.',
      ideationPrompt: 'Shared guidance.',
      baseGameVersionId: 'sky-runner',
    });

    expect(fullPrompt).toContain('Base game for ideation: `sky-runner`.');
    expect(fullPrompt).toContain(
      'Non-starter ideation directive: Generate one off-the-wall, single-sentence improvement grounded in current game context for the existing `sky-runner` game.',
    );
    expect(fullPrompt).not.toContain(
      'Starter ideation directive: Generate one creative, single-sentence arcade-style game concept.',
    );
  });
});

describe('idea generation output normalization', () => {
  it('keeps only the first sentence when the model returns multiple sentences', () => {
    const normalized = normalizeIdeaOutput(
      '  Neon paddle ship rebounds meteor balls with tap-swaps. Add another sentence for extra detail. ',
    );

    expect(normalized).toBe('Neon paddle ship rebounds meteor balls with tap-swaps.');
  });

  it('normalizes single-sentence output whitespace without changing content', () => {
    const normalized = normalizeIdeaOutput('   Tap to launch jelly rockets through pinball tunnels   ');

    expect(normalized).toBe('Tap to launch jelly rockets through pinball tunnels');
  });
});
