export type GameMetadata = {
  id: string;
  parentId: string | null;
  createdTime: string;
  codexSessionId?: string | null;
};

export type GameVersion = GameMetadata & {
  directoryPath: string;
};
