# Repo-specific Codex instructions

- Do not run `npm run lint` and `npm run typecheck` in parallel.
- Run them sequentially to avoid memory overload, in this order:
  1. `npm run typecheck`
  2. `npm run lint`
