import type { GameVersion } from "../types";
import type { HomepagePageData, HomepageTile } from "./types";

type BuildHomepagePageDataOptions = {
  isAdmin: boolean;
};

function toHomepageTile(version: GameVersion): HomepageTile {
  const tileName = version.threeWords ?? version.id;
  const tileSnapshotPath =
    typeof version.tileSnapshotPath === "string" && version.tileSnapshotPath.length > 0
      ? version.tileSnapshotPath
      : null;

  return {
    id: version.id,
    href: `/game/${encodeURIComponent(version.id)}`,
    displayId: tileName.replaceAll("-", " "),
    tileColor: typeof version.tileColor === "string" ? version.tileColor : "#1D3557",
    isFavorite: version.favorite === true,
    tileSnapshotPath,
  };
}

export function buildHomepagePageData(
  versions: readonly GameVersion[],
  options: BuildHomepagePageDataOptions,
): HomepagePageData {
  const visibleVersions = options.isAdmin
    ? versions
    : versions.filter((version) => version.favorite === true);

  return {
    authLabel: options.isAdmin ? "Admin" : "Login",
    showIdeasLink: options.isAdmin,
    tiles: visibleVersions.map((version) => toHomepageTile(version)),
  };
}
