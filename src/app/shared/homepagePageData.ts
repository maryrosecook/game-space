import type { GameVersion } from "../../types";
import { groupGameVersionsByLineage } from "../../services/gameLineages";
import { compareByCreatedTimeDesc } from "../../services/gameVersions";
import type { HomepagePageData, HomepageTile } from "./types";

type BuildHomepagePageDataOptions = {
  isAdmin: boolean;
};

function toHomepageTile(
  version: GameVersion,
  lineageId: string,
  isFavorite: boolean,
): HomepageTile {
  const tileName = version.threeWords ?? version.id;
  const tileSnapshotPath =
    typeof version.tileSnapshotPath === "string" && version.tileSnapshotPath.length > 0
      ? version.tileSnapshotPath
      : null;

  return {
    lineageId,
    id: version.id,
    href: `/game/${encodeURIComponent(version.id)}`,
    displayId: tileName.replaceAll("-", " "),
    tileColor: typeof version.tileColor === "string" ? version.tileColor : "#1D3557",
    isFavorite,
    tileSnapshotPath,
  };
}

export function buildHomepagePageData(
  versions: readonly GameVersion[],
  options: BuildHomepagePageDataOptions,
): HomepagePageData {
  const tiles = groupGameVersionsByLineage(versions)
    .flatMap((lineage) => {
      const visibleVersions = options.isAdmin
        ? lineage.versions
        : lineage.versions.filter((version) => version.favorite === true);
      const representativeVersion = [...visibleVersions].sort(compareByCreatedTimeDesc)[0];
      if (!representativeVersion) {
        return [];
      }

      return [
        {
          representativeVersion,
          tile: toHomepageTile(
            representativeVersion,
            lineage.lineageId,
            lineage.versions.some((version) => version.favorite === true),
          ),
        },
      ];
    })
    .sort((left, right) =>
      compareByCreatedTimeDesc(left.representativeVersion, right.representativeVersion),
    )
    .map(({ tile }) => tile);

  return {
    authLabel: options.isAdmin ? "Admin" : "Login",
    showIdeasLink: options.isAdmin,
    tiles,
  };
}
