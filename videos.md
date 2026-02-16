# PR Feature Video Plan (Recommended)

## Recommendation
Use **GitHub Actions + Playwright E2E** for reproducible PR artifacts; keep Codex/DevTools recording out of the default flow.

## Guardrails (important defaults)
- **Default = no video recording** for E2E tests.
- E2E infra exists for all features, but video capture is only enabled by a dedicated PR workflow path.
- Workflow runs on `pull_request` for **open + synchronize (new commits) + reopen**.

## Minimal implementation plan
1. **Establish Playwright E2E baseline**
   - Add Playwright config/tests so new features can include E2E coverage.
   - Set default Playwright video mode to off/non-recording for normal runs.

2. **Update app-level Codex prompt/policy**
   - Instruct model: for user-visible new features, add/update at least one E2E test.
   - Instruct model: when opening/updating a PR, explicitly declare which E2E tests (if any) should be video-recorded.

3. **PR video workflow (opt-in only)**
   - New GitHub Action on `pull_request` (including PR updates via `synchronize`).
   - Reads an explicit selector provided by model in PR metadata (e.g., PR body marker or committed manifest file).
   - Runs only selected E2E tests with video enabled; does nothing if selector is empty/missing.

4. **Artifact + PR comment behavior**
   - Upload generated videos as workflow artifacts.
   - Post a single “Feature Video” PR comment with links.
   - If comment already exists, **edit in place** instead of creating a new comment on later commits.

5. **Operational rules**
   - Keep video runs narrow (selected tests only) to control runtime and storage.
   - Treat selector format as stable contract so Codex can reliably target tests per PR update.
