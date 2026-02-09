export type GameMetadata = {
  id: string;
  parentId: string | null;
  createdTime: string;
};

export type GameVersion = GameMetadata & {
  directoryPath: string;
};
