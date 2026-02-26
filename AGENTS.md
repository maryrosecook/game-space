# Repo-specific Codex instructions

- Do not run `npm run lint` and `npm run typecheck` in parallel.
- Run them sequentially to avoid memory overload, in this order:
  1. `npm run typecheck`
  2. `npm run lint`
- For every change, add at least one end-to-end test unless the change is clearly not demonstrable with an end-to-end test.
- For PRs that change user-visible behavior, keep the PR body `video-tests` selector block present and updated on every commit:
  - `<!-- video-tests:start -->`
  - `<one Playwright selector per line>`
  - `<!-- video-tests:end -->`
  - If there are no user-visible changes or no demonstrable E2E path, leave the block empty intentionally.
