export type ClientCodegenProvider = "codex" | "claude";

export type HomepageTile = {
  id: string;
  href: string;
  displayId: string;
  tileColor: string;
  isFavorite: boolean;
  tileSnapshotPath: string | null;
};

export type HomepagePageData = {
  authLabel: string;
  showIdeasLink: boolean;
  tiles: readonly HomepageTile[];
};

export type CodexVersionOption = {
  id: string;
  createdLabel: string;
};

export type CodexMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CodexTranscriptState =
  | { kind: "loading" }
  | { kind: "empty"; title: string; description: string }
  | { kind: "ready"; sessionId: string; messages: readonly CodexMessage[] };

export type CodexPageData = {
  codegenProvider: ClientCodegenProvider;
  versions: readonly CodexVersionOption[];
  initialSelectedVersionId: string | null;
  initialTranscript: CodexTranscriptState;
};

export type IdeasIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
};

export type IdeasPageData = {
  csrfToken: string;
  ideas: readonly IdeasIdea[];
  isGenerating: boolean;
  lightbulbIdeaIcon: string;
  rocketIdeaIcon: string;
  trashIdeaIcon: string;
};

export type GamePageData = {
  versionId: string;
  isAdmin: boolean;
  isFavorite: boolean;
  codegenProvider: ClientCodegenProvider;
  providerLabel: string;
  enableLiveReload: boolean;
  homeIcon: string;
  settingsIcon: string;
  micIcon: string;
  rocketIcon: string;
  starIcon: string;
  botIcon: string;
  videoIcon: string;
  trashIcon: string;
};
