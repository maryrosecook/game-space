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

export type IdeasBaseGameOption = {
  id: string;
  displayName: string;
  tileColor: string;
  tileSnapshotPath: string | null;
};

export type IdeasPageData = {
  csrfToken: string;
  ideas: readonly IdeasIdea[];
  isGenerating: boolean;
  baseGameOptions: readonly IdeasBaseGameOption[];
  initialBaseGameVersionId: string;
  lightbulbIdeaIcon: string;
  rocketIdeaIcon: string;
  archiveIdeaIcon: string;
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
  paintbrushIcon: string;
  rocketIcon: string;
  starIcon: string;
  botIcon: string;
  videoIcon: string;
  trashIcon: string;
};
