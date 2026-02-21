export type CodegenProvider = 'codex' | 'claude';

export type CodegenConfig = {
  provider: CodegenProvider;
  claudeModel: string;
  claudeThinking: string;
};

export const DEFAULT_CODEGEN_PROVIDER: CodegenProvider = 'codex';
export const DEFAULT_CODEGEN_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_CODEGEN_CLAUDE_THINKING = 'adaptive';

function readNonEmptyEnvOrDefault(value: string | undefined, defaultValue: string): string {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : defaultValue;
}

export function isCodegenProvider(value: unknown): value is CodegenProvider {
  return value === 'codex' || value === 'claude';
}

export function normalizeCodegenProvider(value: unknown): CodegenProvider {
  if (isCodegenProvider(value)) {
    return value;
  }

  return DEFAULT_CODEGEN_PROVIDER;
}

export function readCodegenConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CodegenConfig {
  return {
    provider: normalizeCodegenProvider(env.CODEGEN_PROVIDER),
    claudeModel: readNonEmptyEnvOrDefault(env.CODEGEN_CLAUDE_MODEL, DEFAULT_CODEGEN_CLAUDE_MODEL),
    claudeThinking: readNonEmptyEnvOrDefault(env.CODEGEN_CLAUDE_THINKING, DEFAULT_CODEGEN_CLAUDE_THINKING)
  };
}

export class RuntimeCodegenConfigStore {
  private provider: CodegenProvider;
  private readonly claudeModel: string;
  private readonly claudeThinking: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(initialConfig: CodegenConfig = readCodegenConfigFromEnv(), env: NodeJS.ProcessEnv = process.env) {
    this.provider = initialConfig.provider;
    this.claudeModel = initialConfig.claudeModel;
    this.claudeThinking = initialConfig.claudeThinking;
    this.env = env;
  }

  read(): CodegenConfig {
    return {
      provider: this.provider,
      claudeModel: this.claudeModel,
      claudeThinking: this.claudeThinking
    };
  }

  setProvider(provider: CodegenProvider): void {
    this.provider = provider;
    this.env.CODEGEN_PROVIDER = provider;
  }
}
