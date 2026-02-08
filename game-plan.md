# Game Plan

## Goal

Build a web repo where the homepage has a playable game in the top half and a
prompt input near the bottom that sends requests to a headless Codex CLI, which
edits the repo and commits game changes.

## Core Loop

1. User submits a prompt.
2. Backend enqueues a `change_request` job with prompt + current commit.
3. Headless Codex worker edits code, runs checks, and creates a commit.
4. UI streams status, then reloads the updated game on success.
5. UI shows failure logs and retry options on error.

## Background Evolution Loop

- Trigger after successful game-changing commits (primary trigger).
- Optional low-frequency idle trigger (fallback only).
- Generate 3 short evolution directions with expected impact and effort.
- Let user choose to:
  - apply to current branch
  - create a new branch (recommended default)
  - dismiss
- Notify asynchronously via non-blocking toasts + a review inbox.

## Divergent Ideation

- Run separate async ideation jobs for mechanics, themes, and feature twists.
- Prioritize novelty when recent changes are incremental.
- Keep work non-blocking so users can continue interacting while ideas are
  generated.

## Recommendations For Open Questions

- **When to ideate:** trigger mainly post-commit for meaningful game edits; use
  rare idle-time runs only as a backup.
- **How to control cost:** enforce daily/weekly token budgets, use trigger
  scoring (novelty + stagnation + acceptance rate), and suppress ideation when
  acceptance stays low.
- **Framework trade-off:** start with **Phaser** and a strict thin architecture
  around it. This gives higher Codex productivity and lower bug risk versus a
  custom engine; revisit custom framework only if repeated complexity pain
  appears.
- **Graphics path:** start with geometric primitives for rapid iteration, then
  add optional shader-based rendering behind a feature flag once core loop is
  stable.

## Initial Milestones

1. Build homepage layout: top-half game viewport + bottom prompt input + status
   area.
2. Implement Codex worker pipeline: queue, isolated edits, validation, commit
   metadata, log streaming.
3. Implement post-commit suggestion worker that returns 3 evolution options.
4. Add branch-based exploration + notifications inbox.
5. Add ideation scoring, budget controls, and outcome telemetry.

## Success Criteria

- Prompt-to-play loop works end-to-end with committed updates.
- Async suggestions regularly produce viable directions without interrupting
  user flow.
- Token spend stays within budget while suggestion acceptance improves over
  time.
