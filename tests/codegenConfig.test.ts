import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CODEGEN_CLAUDE_MODEL,
  DEFAULT_CODEGEN_CLAUDE_THINKING,
  normalizeCodegenProvider,
  readCodegenConfigFromEnv,
  RuntimeCodegenConfigStore
} from '../src/services/codegenConfig';

describe('codegen config service', () => {
  it('reads defaults when env values are missing', () => {
    expect(readCodegenConfigFromEnv({ NODE_ENV: 'test' })).toEqual({
      provider: 'codex',
      claudeModel: DEFAULT_CODEGEN_CLAUDE_MODEL,
      claudeThinking: DEFAULT_CODEGEN_CLAUDE_THINKING
    });
  });

  it('normalizes invalid providers back to codex', () => {
    expect(normalizeCodegenProvider('unknown')).toBe('codex');
    expect(normalizeCodegenProvider('claude')).toBe('claude');
  });

  it('persists provider updates back into the env-backed store', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    const store = new RuntimeCodegenConfigStore(
      {
        provider: 'codex',
        claudeModel: 'claude-sonnet-4-6',
        claudeThinking: 'adaptive'
      },
      env
    );

    store.setProvider('claude');

    expect(store.read().provider).toBe('claude');
    expect(env.CODEGEN_PROVIDER).toBe('claude');
  });
});
