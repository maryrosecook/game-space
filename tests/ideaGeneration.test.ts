import { describe, expect, it } from 'vitest';

import { buildIdeaGenerationInput } from '../src/services/ideaGeneration';

describe('idea generation prompt composition', () => {
  it('builds a starter ideation prompt with a full-concept directive', () => {
    const fullPrompt = buildIdeaGenerationInput({
      gameBuildPrompt: 'Build prompt.',
      ideationPrompt: 'Shared guidance.',
      baseGameVersionId: 'starter',
    });

    expect(fullPrompt).toContain('Base game for ideation: `starter`.');
    expect(fullPrompt).toContain('Ideation mode: full game concept.');
    expect(fullPrompt).toContain(
      'Generate one original game concept that can be built from the starter template.',
    );
    expect(fullPrompt).toContain('Shared guidance.');
  });

  it('builds a non-starter ideation prompt with a focused-improvement directive', () => {
    const fullPrompt = buildIdeaGenerationInput({
      gameBuildPrompt: 'Build prompt.',
      ideationPrompt: 'Shared guidance.',
      baseGameVersionId: 'sky-runner',
    });

    expect(fullPrompt).toContain('Base game for ideation: `sky-runner`.');
    expect(fullPrompt).toContain('Ideation mode: focused mechanics improvement.');
    expect(fullPrompt).toContain(
      'Generate one focused mechanics improvement for the existing `sky-runner` game.',
    );
    expect(fullPrompt).not.toContain(
      'Generate one original game concept that can be built from the starter template.',
    );
  });
});
