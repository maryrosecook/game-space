export type CodexSessionStatus = 'none' | 'created' | 'stopped' | 'error';

export type EyeState = 'stopped' | 'idle' | 'generating' | 'error';

export type GameMetadata = {
  id: string;
  parentId: string | null;
  createdTime: string;
  tileColor?: string;
  favorite?: boolean;
  codexSessionId?: string | null;
  codexSessionStatus?: CodexSessionStatus;
};

export type GameVersion = GameMetadata & {
  directoryPath: string;
};
