export type CodexSessionStatus = 'none' | 'created' | 'stopped' | 'error';

export type EyeState = 'stopped' | 'idle' | 'generating' | 'error';

export type GameMetadata = {
  id: string;
  threeWords?: string;
  prompt?: string;
  parentId: string | null;
  createdTime: string;
  tileColor?: string;
  favorite?: boolean;
  codexSessionId?: string | null;
  codexSessionStatus?: CodexSessionStatus;
  tileSnapshotPath?: string | null;
};

export type GameVersion = GameMetadata & {
  directoryPath: string;
};
