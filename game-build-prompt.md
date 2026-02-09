# Game Build Prompt

Use this repository's planning docs as the source of truth:
- `game-plan.md`
- `factory/spec-game-plan-v1.md`

When you modify a game version:
- Keep the runtime fully client-side.
- Prioritize simple geometric visuals (circles, rectangles, lines).
- Target phone-first play in portrait orientation (`9:16`) as the primary layout.
- Keep controls and gameplay readable on small screens.
- Preserve compatibility with older game versions by changing only the selected version directory.
- Update that version's `metadata.json` only when lineage/version semantics require it.
