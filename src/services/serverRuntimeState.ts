import { LoginAttemptLimiter } from './adminAuth';
import { RuntimeCodegenConfigStore } from './codegenConfig';
import { SpawnCodegenRunner, type CodexRunner } from './promptExecution';

type ActiveIdeaGeneration = {
  requestId: number;
  abortController: AbortController;
};

export class IdeaGenerationRuntimeState {
  private activeRequest: ActiveIdeaGeneration | null = null;
  private nextRequestId = 1;

  isGenerating(): boolean {
    return this.activeRequest !== null;
  }

  startRequest(): ActiveIdeaGeneration {
    if (this.activeRequest) {
      this.activeRequest.abortController.abort();
    }

    const activeRequest = {
      requestId: this.nextRequestId,
      abortController: new AbortController(),
    };
    this.nextRequestId += 1;
    this.activeRequest = activeRequest;
    return activeRequest;
  }

  clearIfCurrent(requestId: number): void {
    if (this.activeRequest?.requestId === requestId) {
      this.activeRequest = null;
    }
  }
}

const sharedCodegenConfigStore = new RuntimeCodegenConfigStore();
const sharedLoginAttemptLimiter = new LoginAttemptLimiter();
const sharedIdeaGenerationRuntimeState = new IdeaGenerationRuntimeState();
const sharedCodexRunner: CodexRunner = new SpawnCodegenRunner(() =>
  sharedCodegenConfigStore.read(),
);

export function readSharedCodegenConfigStore(): RuntimeCodegenConfigStore {
  return sharedCodegenConfigStore;
}

export function readSharedLoginAttemptLimiter(): LoginAttemptLimiter {
  return sharedLoginAttemptLimiter;
}

export function readSharedIdeaGenerationRuntimeState(): IdeaGenerationRuntimeState {
  return sharedIdeaGenerationRuntimeState;
}

export function readSharedCodexRunner(): CodexRunner {
  return sharedCodexRunner;
}
