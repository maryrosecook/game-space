# Claude Code Path Plan (No API/Behavior Breaks)

1. **Add env-driven provider/model config**
   - Introduce `CODEGEN_PROVIDER` (`codex` | `claude`) and default it to `codex`.
   - Introduce Claude defaults in env (`CODEGEN_CLAUDE_MODEL=claude-sonnet-4-6`, `CODEGEN_CLAUDE_THINKING=adaptive`) and document in `.env.example`.
   - Keep request/response payloads and existing routes unchanged.

2. **Generalize prompt execution service behind current interface**
   - Keep `CodexRunner` API contract exactly as-is (`run(prompt, cwd, options)` + same result shape).
   - Refactor current spawn logic into provider-specific runners:
     - `codex` runner (current behavior unchanged).
     - `claude` runner using Claude Code CLI with equivalent non-interactive execution and transcript/session capture.
   - Add a provider selector factory that reads env and returns the correct runner without changing call sites.

3. **Preserve transcript behavior for both providers**
   - Ensure generated session ids can still be persisted to game metadata and resolved by existing transcript endpoints.
   - If Claude emits different event formats, add parsing/normalization so transcript tab receives the same shape currently consumed by UI.
   - Do not change transcript API contracts (`/api/codex-sessions/:versionId` output remains compatible).

4. **Auth page selector wired to env-backed provider setting**
   - Add a provider selector control on `/auth` (Codex vs Claude) visible to admin users.
   - On save, update the server-side env-backed setting used for codegen provider selection (no client-side secret exposure).
   - Show current active provider/model on the auth page for operator clarity.

5. **UI behavior constraints**
   - Keep Cog/Edit flow behavior unchanged except **skip spinner behavior on the cog tab for Claude v1**.
   - Keep transcript tab visible/functional; transcript must continue updating during/after runs.

6. **Validation checklist**
   - Run provider switch smoke test (Codex -> Claude -> Codex) from Auth page.
   - Verify prompt submission route still returns existing response shape and game forking/build flow works.
   - Verify transcript tab renders sessions/messages for both providers.
   - Run `npm run typecheck` then `npm run lint`.
