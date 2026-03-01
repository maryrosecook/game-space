# Filesystem Invariants Snapshot (Phase 0 Baseline)

Snapshot date: 2026-02-28

Purpose:
- Record exact filesystem contracts that must remain stable during migration.
- Establish parity targets for `games/<versionId>/...` and root `ideas.json`.

Scope:
- Runtime and API path usage in current Express implementation.
- Backed by current source and tests.

## 1) Root locations

Current defaults:
- `repoRootPath`: process working directory.
- `gamesRootPath`: `<repoRootPath>/games`.
- `ideasPath`: `<repoRootPath>/ideas.json` (overridable in app options).

References:
- `src/app.ts` (`createApp` option defaults)

## 2) `games/` hierarchy contract

Primary persisted tree:
- `games/`
  - `<versionId>/`
    - `metadata.json` - canonical game version metadata record.
    - `src/` - version source files.
    - `dist/` - built runtime assets (`dist/game.js` required for `/game/:versionId` renderability).
    - `snapshots/`
      - `tile.png` - manual tile snapshot target path.

Invariant:
- The path shape remains `games/<versionId>/...` with no migration to other roots.

References:
- `src/services/gameVersions.ts`
- `src/app.ts`
- `tests/gameVersions.test.ts`
- `tests/app.integration.test.ts`

## 3) `versionId` path safety contract

Invariant:
- Accepted `versionId` must:
1. Match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`
2. Not contain `..`

Effects:
- Unsafe IDs are rejected for route access and filesystem path use.
- Game existence checks require directory existence (`fs.stat(...).isDirectory()`).

References:
- `src/services/gameVersions.ts` (`isSafeVersionId`, `hasGameDirectory`)
- `tests/gameVersions.test.ts`

## 4) Metadata file contract (`games/<versionId>/metadata.json`)

Normalized runtime shape:
```ts
{
  id: string;
  parentId: string | null;
  createdTime: string; // parseable date normalized to ISO
  threeWords?: string;
  prompt?: string;
  tileColor?: string; // normalized #RRGGBB if valid
  favorite: boolean; // normalized to false when omitted
  codexSessionId: string | null;
  codexSessionStatus: "none" | "created" | "stopped" | "error";
  tileSnapshotPath?: string | null;
}
```

Invariants:
- Invalid/missing metadata is treated as absent and skipped by list/read helpers.
- Metadata writes are serialized and persisted via temp-file + rename semantics.

References:
- `src/services/gameVersions.ts`
- `tests/gameVersions.test.ts`

## 5) Route-to-filesystem mutation contract

`POST /api/games/:versionId/favorite`
- Writes `games/<versionId>/metadata.json` (`favorite` toggle).

`POST /api/games/:versionId/tile-snapshot`
- Writes `games/<versionId>/snapshots/tile.png`.
- Returns `/games/<versionId>/snapshots/tile.png` in API payload.

`DELETE /api/games/:versionId`
- Removes `games/<versionId>/` directory.

`POST /api/games/:versionId/prompts`
- Forks source version into new `games/<forkId>/`.
- Excludes `node_modules` from copy.
- Ensures fork package has `scripts.typecheck` and `devDependencies.typescript`.
- Writes fork `metadata.json` with lineage/session fields.
- After successful prompt execution, may write `games/<forkId>/snapshots/tile.png` and update `metadata.json.tileSnapshotPath`.

`POST /api/ideas/generate`
- Prepends a new entry in root `ideas.json`: `{ prompt, hasBeenBuilt: false }`.

`POST /api/ideas/:ideaIndex/build`
- Uses `games/starter` as source for fork creation.
- Updates `ideas.json` built-state and creates fork in `games/<forkId>/`.

`DELETE /api/ideas/:ideaIndex`
- Removes the indexed entry from root `ideas.json`.

References:
- `src/app.ts`
- `src/services/forkGameVersion.ts`
- `src/services/ideas.ts`
- `tests/app.integration.test.ts`
- `tests/forkGameVersion.test.ts`

## 6) Static serving allowlist contract for `/games/*`

Allowed:
- Runtime-safe assets under `dist/*` constrained by extension allowlist.
- `snapshots/tile.png` only.

Denied:
- Traversal/dot segments and hidden path segments.
- Sourcemaps (`*.map`).
- `dist/reload-token.txt`.
- Non-allowlisted extensions and protected internal files.

Invariant:
- Public `/games/*` serving remains allowlist-based, not broad static serving.

References:
- `src/services/gameAssetAllowlist.ts`
- `src/app.ts`
- `tests/app.integration.test.ts`

## 7) Root `ideas.json` contract

Path:
- Default `ideas.json` at repository root.

On-disk format:
```json
[
  { "prompt": "non-empty string", "hasBeenBuilt": false }
]
```
- `hasBeenBuilt` is a boolean (`false` before build, `true` after build).

Read normalization:
- Missing file (`ENOENT`) => `[]`.
- Invalid JSON or non-array => `[]`.
- Invalid entries are dropped; valid entries preserved.

Write format:
- Pretty JSON (2-space indent) + trailing newline.

Mutation invariants:
- Generate prepends new `{ prompt, hasBeenBuilt: false }`.
- Build validates `ideaIndex`, requires starter game, marks selected idea built.
- Delete validates `ideaIndex`, removes selected entry.

References:
- `src/services/ideas.ts`
- `src/app.ts`
- `tests/app.integration.test.ts`
- `tests/e2e/phase0-flows.spec.ts`

## 8) Regression expectations

A filesystem regression is any change that violates one or more contracts above, including:
- Moving persisted game data away from `games/<versionId>/...`.
- Moving ideas persistence away from root `ideas.json`.
- Relaxing `versionId` safety constraints.
- Expanding `/games/*` serving beyond the runtime allowlist model.
