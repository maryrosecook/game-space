# Game Codegen Speed Investigation

_Date: 2026-03-12_

## Goal

Reduce end-to-end latency for:
- **new game creation** (currently “several minutes”), and
- **small edits** (currently ~30–90s)

while preserving high success rate against user intent.

---

## What the current pipeline is doing (and where time goes)

From repository inspection:

1. A prompt request forks a game version and composes a combined build+user prompt.  
2. The backend starts a provider runner (`codex` or `claude`) in the fork directory and streams events.  
3. The API returns quickly with a fork id; generation runs in the background.  
4. On successful generation completion, it optionally runs a **headless snapshot** command to produce/update `snapshots/tile.png`.

### Latency implications

- The dominant latency for user-visible “done” is likely **model/tool execution inside `codex exec` / `claude`**, not server orchestration.
- For every successful run, snapshot capture adds extra wall-clock work after generation.
- Prompt size and prompt ambiguity directly increase both latency and failure-retry probability.

---

## High-leverage speed strategy (broad, out-of-the-box)

Think in 4 multiplicative terms:

`total_time ≈ attempts_needed × tokens_per_attempt × ms_per_token + validation_overhead`

So speed can come from:

1. **Fewer attempts** (higher first-pass success)
2. **Fewer tokens** (shorter prompts + smaller edits)
3. **Faster model throughput**
4. **Less post-processing overhead**

The best improvements usually combine all four.

---

## 1) Model speed ↔ intelligence frontier (rough planning map)

Use this as an **illustrative operating map** (relative placement, not benchmark gospel).

- X-axis: relative speed (higher is faster)
- Y-axis: relative reasoning/coding quality (higher is smarter)

```text
Intelligence ↑
            |
  Very high |                          Opus 4.6 Extended Thinking
            |                         /
            |                Codex 5.4 extra-high thinking
            |                      /
     High   |            Codex 5.4 standard
            |                 /          Claude Sonnet-class standard
            |        GPT-4.1 /  Gemini 1.5 Pro style
            |
   Medium   |   fast coding models / mini variants
            |
            +--------------------------------------------------------→ Speed
                    slow-ish                       medium             fast
```

### Practical policy

Adopt a **2-tier router**:

- **Tier A (fast path, default)**: medium-high intelligence, high throughput.
- **Tier B (rescue path)**: very high reasoning mode (e.g., extra-high/extended thinking) only when confidence is low or first pass fails.

This avoids paying premium latency on easy edits.

### Routing trigger ideas

Escalate to Tier B if any are true:
- prompt asks for deep refactor / architecture shift,
- multi-file semantic coupling is high,
- first pass fails a deterministic acceptance check.

---

## 2) Engine “batteries included” to reduce generation work per request

For arcade-style games, add defaults that eliminate repeated invention.

### Missing batteries likely causing repeated generation cost

1. **Collision/event system beyond no-op adapter** (AABB/circle checks, layers, triggers)
2. **Built-in movement/controller helpers** (8-dir, platformer, top-down, acceleration/friction)
3. **Camera helpers** (follow, deadzone, shake, clamp)
4. **Sprite animation state machine** (idle/run/hit/death)
5. **Timer/tween utilities** (cooldowns, delayed actions, easing)
6. **Projectile/combat kit** (spawners, hit logic, invulnerability frames)
7. **Wave/spawn director** (arcade progression)
8. **HUD primitives** (score, lives, health bars)
9. **Audio manager** (one-shots, loops, channels, ducking-lite)
10. **Prefab archetypes** (player ship, asteroids, bullets, enemies, pickups)

### Why this speeds codegen

Each battery shifts work from “synthesize + debug bespoke logic” to “configure known API”, which lowers tokens, ambiguity, and retries.

---

## 3) Documentation legibility gaps likely hurting model reliability

Current docs are solid but can be made much more generation-friendly.

### Gaps I’d prioritize

1. **No “golden recipes” section**  
   Add copy/paste recipes: “top-down shooter”, “breakout”, “platform jumper”, “endless runner”.

2. **Lifecycle order is not explicit enough in one place**  
   A single canonical tick sequence diagram (`input → update → physics → collision → render`) with constraints.

3. **Insufficient “do this, not that” guardrails**  
   E.g. object allocation inside hot loops, unstable IDs, mutating shared globals incorrectly.

4. **Weak acceptance checklist for model self-verification**  
   Add a strict “before finish” checklist for deterministic headless validation and common failure signatures.

5. **API surface reference is spread out**  
   Create one compact API table with signatures + minimal examples + gotchas.

6. **Prompting contract could be more explicit on diff-minimization**  
   For simple edits, instruct model to preserve architecture and touch minimal files first.

---

## 4) Make “simple change” path radically faster

Most requests are minor edits. Build a dedicated fast lane:

1. **Intent classifier** (tiny model / heuristic) → label request as `small_tweak | feature_add | overhaul`.
2. **Small_tweak policy**:
   - use fast model,
   - tight token budget,
   - single-file-first edit plan,
   - minimal validation script.
3. **If check fails**, automatically escalate once to stronger model with richer context.

This alone often cuts median latency dramatically while keeping tail quality.

---

## 5) If you constrain product scope to “arcade-style games”, does it help?

**Yes — substantially.**

Constraining to arcade-style games enables:
- a narrower, stable runtime API,
- richer domain-specific batteries,
- fewer ambiguous prompts,
- reusable prefab libraries,
- tighter acceptance tests.

### Recommended scope contract

“Supported genres (v1): top-down shooter, arena survival, breakout/arkanoid, endless dodger, simple platformer-lite.”

Then optimize hard for those with templates and recipes. You can still permit experimental prompts, but treat them as best-effort slower path.

---

## 6) Concrete roadmap (highest ROI first)

### Phase 1 (1–2 weeks): latency wins without major architecture change

1. Add model router (fast default + smart fallback).
2. Add prompt-size controls (concise build prompt variant for minor edits).
3. Add request classifier for `small_tweak` fast lane.
4. Add deterministic acceptance checks to trigger one automatic retry/escalation.

### Phase 2 (2–4 weeks): reduce generation complexity

1. Ship arcade batteries (collision + movement + camera + timers + projectile kit).
2. Publish “golden recipes” and compact API quick reference.
3. Add prefab starter variants (shooter, breakout, runner).

### Phase 3 (ongoing): optimize reliability-speed frontier

1. Instrument per-stage timings and failure causes.
2. Track P50/P90 latency by request class and model tier.
3. Tune router thresholds using real production traces.

---

## Suggested north-star metrics

- **P50 simple-edit completion time**
- **P90 simple-edit completion time**
- **First-pass success rate** (no manual retry)
- **Average tokens per successful request**
- **Escalation rate** (fast → slow model)
- **User-visible “good enough on first render” score**

---

## Key takeaways

1. The biggest practical gains come from **routing + constrained scope + batteries**, not model swapping alone.
2. A fast-default / smart-fallback architecture is the most robust way to improve both median latency and success.
3. Constraining to arcade genres is a strong strategic move if speed/reliability is your priority.
4. Documentation should evolve toward “recipe + checklist + gotcha” format to reduce model confusion and retries.
