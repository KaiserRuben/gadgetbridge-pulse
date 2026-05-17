# Training Plan Integration — Design Note

> Companion to `TRAINING_PLAN_INTEGRATION.md`. Captures the six open decisions the brief asked for, plus a phased build sequence. Not yet implemented; **awaits user feedback before structural commits**.

Date: 2026-05-16 · Author: claude · Status: revision 2, user-confirmed topology + chat behaviour

## Confirmed by user (2026-05-16)

- **Topology**: Mac owns JSON insight tree (status quo: `$INSIGHTS_ROOT/...`). Pi owns `pulse.db`. Mac runner POSTs to Pi `/api/ingest/*` for DB writes; Pi reads JSON via Syncthing.
- **Chat fallback**: none. Remote Ollama unreachable → request enters async queue, retries when reachable, surfaces stale-state in UI. No local-model degradation.

## Guiding principle (user-given, applies repo-wide)

**Build a general system that subsumes the use case, not a UI bespoke to the use case.** The training-plan-2026 content is one input to a general plan-execution + plan-adaptation engine. Schemas, components, prompts, APIs are designed for arbitrary plans / phases / session templates / exercises / movement patterns. The current reconditioning plan is *an instance*, not the system's contract.

Concrete commitments from this principle:
- Schemas hold **opaque payloads** (plan document, session template, set log) parameterised by exercise/movement-pattern references, not enums of named exercises.
- The exercise library is a first-class table (`PULSE_EXERCISE`) keyed by stable `exercise_id`, with substitutes/equipment/muscle-group tags — independent of any single plan.
- Phase count, session-templates-per-week, RPE scale (configurable 1–10 default), and progression rules are plan-document fields, not hardcoded.
- Pain-flag taxonomy + deviation-reason enum are general (apply to any plan), not phase-1-specific.
- Pipeline prompts receive the structured plan + recent context as data, not narrative templates tied to "Tag A / Tag B / Tag C".

See `feedback_general_system.md` in user memory.

## TL;DR

| # | Decision | Recommendation |
|---|---------|---------------|
| 1 | Persistence split | All training entities in `pulse.db` (M008): plan versions, sessions, set logs, pain flags, proposals. **No JSON-side artefacts for training** — plan is row-shaped, not Syncthing-shaped (Pi-writer, no Mac mirror needed). |
| 2 | Pipeline home | New **v3 use-case** (`runner/src/v3/{packagers,prompts,schemas}/training.*`), surfaced via `PULSE_INSIGHT[cluster='training']` so it lights up the dashboard independently of v2/v3 finalization. Mac runner runs it, POSTs result to Pi. |
| 3 | Session write path | Pi-served UI writes directly to `pulse.db` (Pi is the DB writer). Browser IndexedDB queue + service-worker offline shell. Mac never touches training tables. |
| 4 | Wearable stitching | Auto-link when wearable workout overlaps user session ≥60% **and** duration ratio ∈ [0.5, 2.0] **and** same `period_key` **and** sole candidate ±30 min. Tentative for 24 h, then implicit confirm. Manual picker fallback. |
| 5 | Plan import format | One-shot MD → seed JSON converter, then immediately written into `PULSE_TRAINING_PLAN.payload_json`. The `.json` is throwaway scaffolding; MD stays as historical record only. |
| 6 | Local vs remote LLM | Pipeline = local Mac Ollama only, never falls back. Chat = remote only, async queue when unreachable (no local fallback). |

The recommendations are mutually consistent — any one of them can be redirected without forcing rework of the others.

---

## Topology (confirmed)

Split writer responsibility:

- **Mac** owns `$INSIGHTS_ROOT/**.json` (atomic writes via `output.ts`, Syncthing-synced for Pi read).
- **Pi** owns `pulse.db` (write through `lib/data/period-store.ts`).
- Mac runner POSTs ingested rows to Pi `/api/ingest/*` over Tailscale.
- CLAUDE.md line about Mac being `pulse.db` writer is stale; flagged for a follow-up edit (separate task, not this one).

Implication for training: **training data is DB-shaped, not JSON-shaped.** Sessions/sets/pain/plans/proposals all live in `pulse.db` on Pi, written by the Pi-served Next.js. Mac's only training-side write is the per-day training adaptation insight, which it POSTs into `PULSE_INSIGHT[cluster='training']` like the rest of v3.

---

## 1. Persistence split

All training entities live in `pulse.db` (Pi-writer). M008 migration adds:

- **`PULSE_TRAINING_PLAN`** — `(version PK, created_at, created_by ENUM[seed,user,proposal], parent_version FK NOT NULL except v1, accepted_proposal_id FK NULL, change_summary TEXT NOT NULL except v1, is_active BOOL, payload_json TEXT, payload_sha256 TEXT)`. The full plan document (phases, exercise library, entry criteria) lives in `payload_json`. Diffing two versions = JSON diff over the column; cheaper than a multi-table reconstruction. `is_active` enforced single-true via partial unique index. `change_summary` is the user's "why I changed this" note (mirrors `resolution_note` on the proposal that produced this version) and is mandatory so future LLM analysis always has the *reason*, not just the *delta*.
- **`PULSE_PLANNED_SESSION`** — `(id PK, period_key, plan_version FK, template_id, target_json)`. One row per dated session. Materialised lazily on first read or on plan-version change.
- **`PULSE_ACTUAL_SESSION`** — `(id PK uuid, planned_session_id FK NULL, deviation_reason ENUM[user_choice,recovery,schedule,other] NULL, state ENUM[in_progress,completed,abandoned], started_at, completed_at NULL, subjective_energy NULL, note NULL, last_edited_at NULL, wearable_workout_id NULL, wearable_link_status ENUM[none,tentative,confirmed,manual] DEFAULT 'none')`. `deviation_reason` is non-null when the user picked a non-suggested session (Q5).
- **`PULSE_SET_LOG`** — `(id PK, actual_session_id FK, exercise_id FK, set_idx, reps, weight_kg NULL, rpe NULL, note NULL, last_edited_at NULL)`. Index on `(actual_session_id, set_idx)`. Edits land in `PULSE_SET_LOG_AUDIT (id PK, set_log_id FK, edited_at, before_json, after_json, source ENUM[user_edit,delete])` so the original numbers are recoverable.
- **`PULSE_EXERCISE`** — canonical exercise library. `(id PK stable string e.g. 'goblet_squat', display_de, display_en, movement_pattern ENUM[squat,hinge,push_horizontal,push_vertical,pull_horizontal,pull_vertical,carry,lunge,core_anti_ext,core_anti_rot,core_anti_lat_flex,isolation_other], primary_muscles_json, equipment_json, substitutes_json string[] of other exercise_ids, contraindications_json string[] of pain location_codes, notes_de NULL)`. Plans + set logs reference `exercise_id` here. New exercises added via UI or admin script; no enum migration needed.
- **`PULSE_PAIN_FLAG`** — first-class for pattern detection. `(id PK, actual_session_id FK, exercise_id FK NULL, location_code ENUM, side ENUM[left,right,bilateral,n/a], severity ENUM[mild,sharp], free_text NULL, raised_at)`. Index on `(location_code, raised_at)`. See §7 below for what the LLM is allowed to do with `free_text`.
- **`PULSE_ADJUSTMENT_PROPOSAL`** — `(id PK, generated_at, target_plan_version FK, diff_json, reasoning_trace, cited_data_json, status ENUM[pending,accepted,rejected,edited], resolved_at NULL, resolution_note NULL)`. Index on `(status, generated_at)`.

**Why not JSON-on-Syncthing for plan versions.** Earlier draft kept plan payloads as JSON files. With Pi-as-DB-writer that's strictly worse: every accept-proposal action on the Pi UI would have to round-trip through the Mac to write the JSON, then back through Syncthing to read it. Putting the plan document in a TEXT column on the same DB the Pi already writes eliminates the round-trip and keeps the write atomic with the proposal-state transition.

**Why training stays out of `$INSIGHTS_ROOT/`.** Training data is volitional (user-typed) and read-write from the Pi-served UI. JSON on Syncthing is Mac-writer-only — using it for Pi-writes inverts the topology that's already working. The one exception is the daily training-adaptation **insight** the runner emits (§2), which follows the existing Mac→JSON→Pi-read path *and* lands in `PULSE_INSIGHT[cluster='training']` via the ingest POST.

**Pain-flag vocabulary — two-channel.** `location_code` is a closed enum (general, not user-specific): `back, shoulder, elbow, wrist, thumb, hip, knee, ankle, foot, neck, head, chest, abdominal, other` × `side ENUM[left,right,bilateral,n/a]`. Pattern detection / recurrence alarms / aggregation count by `(location_code, side)`. `free_text` is verbatim user input, carried into per-flag LLM context (see §7) but never paraphrased or grouped on. If a user repeatedly writes free text that the enum can't capture, that's a signal to extend the enum (cheap migration), not to relax the locked-language rule.

## 2. Pipeline home — v3 use-case

**Recommended: new v3 use-case** (`packagers/training.ts`, `prompts/training.ts`, `schemas/training_insight.schema.json`), emitted as `PULSE_INSIGHT[cluster='training']` per day.

**Why v3:**

- v3's use-case shape (per-domain prompt manifest, per-item reasoning, self-citing) matches what training adaptation needs (per-exercise reasoning, citing RPE/load trends, citing recovery signals).
- v2's daily.schema.json is already battle-hardened for sleep/recovery/activity prose. Adding training there forces a schema bump and risks regressions in the live dashboard. v3 is supposed to absorb new use-cases.
- Memory feedback explicitly says don't refactor v3 alongside v2 changes.

**Why not v2:**

- Adding a v2 stage means another LLM call inside the finalize loop, lengthening the critical-path latency on every day (currently 25–90 s LLM time per day).
- Training insights have a different cadence — they want to fire on `workout_complete` *now*, not at day-end. v2 is end-of-day batch; v3 + the event bus (`runner/src/events/bus.ts`) is the right fit.

**Wiring strategy:**

- Subscribe the training use-case to three event kinds on `runner/src/events/bus.ts`:
  - `workout_complete` → emit post-session quality insight (just this session's KPIs).
  - `manual` (`session_logged`) → same, when user finishes via UI without a paired wearable workout yet.
  - `day_end` → emit tomorrow's prescription insight (the J1 morning view).
- Mac runner produces the insight. Pi-side `/api/ingest/insight` (or equivalent) writes it into `PULSE_INSIGHT[cluster='training']` over Tailscale. Dashboard reads use the same `readInsight(date, 'training')` path as recovery/sleep/activity.
- The runner also reads recent session/set/pain data via a thin `/api/training/context/:date` endpoint on the Pi — Mac doesn't need a direct DB read handle, and the context bundle stays small.
- v2 daily prose can opt-in to training context by reading the latest training insight for the same period (one extra read, no LLM cost), so the J4 "yesterday's session" mention in the daily synthesis stays cohesive.

**Cost of choosing v3 today:** v3 not yet wired into the dashboard. Mitigation: the `PULSE_INSIGHT[cluster='training']` row is already a supported read path on the Pi (see `period-store.readInsight`), so the dashboard renders training independently of the broader v3 cutover.

## 3. Session write path from Pi

**Recommended: Pi writes pulse.db directly, browser does local-first with IndexedDB queue.**

Concretely:
- New API routes: `POST /api/training/session/start|set|finish|pain` on the Next.js (Pi) side.
- Browser keeps an IndexedDB queue keyed by `session_uuid + set_idx`. Each user action enqueues an event, fires the API call optimistically, marks the event as synced on 200.
- On reconnect, the queue replays in order. Idempotency via `PULSE_INGEST_LOG` (existing M007 table) keyed on `session_uuid + set_idx + kind`.
- The "Mac runner picks up via watch tick" pattern (state folder dropbox) is rejected — too high-latency (5 min loop) for a flow the user is actively in, and it forces Syncthing into the write path (corruption risk per CLAUDE.md hard rule).
- Direct-to-Mac-API at gym time is rejected — adds the cellular-Tailscale dependency to a flow that must work in a basement gym.

**Gym-with-bad-WiFi scenario:**
- All writes are local-first in the browser. Pi reachability only matters for *sync*, not for *logging*.
- Service worker keeps the session view alive offline. We don't need a PWA install (the spec says no native app), just an offline-capable shell.
- A small "X sets unsynced" indicator surfaces in the UI when the queue isn't empty.

**Mac-not-reachable scenario (Pi still up):** zero impact — the only Mac dependency is Ollama, and the v3 training pipeline runs from `workout_complete` / `day_end` events emitted on the Mac side. If Mac is asleep when the user finishes a session, the post-session quality insight is delayed; the logged data is safe on the Pi.

## 4. Wearable stitching threshold

The user starts logging *before* the watch detects the workout. Strict overlap is wrong.

**Policy:**

```
auto_link = overlap_ratio >= 0.60
            AND duration_ratio in [0.5, 2.0]   # user/wearable
            AND same period_key (wake-date local)
            AND no other unlinked candidate within ±30 min
```

Where `overlap_ratio` is `intersection / union` between the user session window [first_set_logged_at, finish_pressed_at] and the wearable workout window. Single-candidate constraint avoids accidentally stitching to a separate cardio session that started right after.

**Tentative state.**
- An auto-linked pair is `wearable_link_status = 'tentative'` for 24 h.
- After 24 h with no user correction, transitions to `confirmed`.
- The user can unlink/relink any time; explicit confirmation clears tentative immediately.

**Manual fallback UI (J3):**
- If no candidate matches, show a picker of recent (last 6 h) wearable activities with delta to user session.
- "No matching wearable workout" is also a valid outcome — sessions without a wearable record are first-class (the user might have forgotten to start the watch).

**Edge case.** Watch frequently splits long sessions into multiple `WORKOUT_ID`s (existing `STITCH_GAP_MAX_SEC = 20 min` heuristic in `workout-stitch.ts`). The training stitcher should compose with this: link to the *stitched session id*, not the raw `WORKOUT_ID`, so the wearable side already represents the merged effort.

## 5. Plan import format

One-shot MD → JSON conversion at install time, then DB-authoritative.

- Script `runner/src/scripts/import-plan.ts` parses the seed Markdown once, builds the plan-document JSON, POSTs to Pi `/api/training/plan/import` which inserts `PULSE_TRAINING_PLAN` `version=1, created_by='seed', is_active=1`. The MD stays in `docs/` for human reference only — Pulse never re-parses it.
- Parser is bespoke for this one file (we know the tables), not a generic engine. Brittleness fine — runs once.
- Subsequent edits land via UI + accepted-proposal flow. No MD round-trip.

**Why not parse MD live.** Markdown tables are fragile; user will reasonably want to edit phase 2 prose in the file, which would silently break the parser. One-shot avoids the trap.

**Why not abandon the seed.** User wrote it as initial source of truth. Asking them to redefine in a UI before they've used the system is bad UX.

## 6. Local vs remote LLM split (user-confirmed)

- Pipeline (training prescription, post-session quality, adjustment proposals, weekly training section) → **local Mac Ollama only**, never falls back. Format-grammar constrained, reproducible. Remote may have a different model loaded → would silently change outputs.
- Chat (J7 "Frag Pulse") → **remote only, async queue when unreachable**. No local fallback.
  - New `PULSE_CHAT_QUEUE` rows (or piggyback on `PULSE_EVENT_LOG[kind='chat_request']`): user's question + frozen context bundle. UI shows "wartet auf Mac-Erreichbarkeit" pill on the message.
  - Background worker on Pi polls remote `/api/tags` every ~60 s; when reachable, drains queue oldest-first, streams reply back via SSE/WS or persists final answer for next page load.
  - Browser shows live "wartet…" until drained. User can dismiss queued requests.
- Pipeline-on-Mac-asleep: event-bus is durable (`events.jsonl`). Insights delayed until Mac wakes; no fallback needed.

**Chat-as-proposer-only enforcement:** chat replies pass through a structured-extraction step (cheap second prompt) — if the assistant suggests a plan change, it materialises as a `PULSE_ADJUSTMENT_PROPOSAL` row and renders as a diff card in the chat thread, never a direct write.

---

## 7. Pain-flag free-text handling (LLM contract)

Two access modes for the LLM, matching aggregation vs zoom-in:

- **Aggregate context** (week summary, phase-stall checks, training_pain_recurrence alarm): only structured fields visible — `(location_code, side, severity)` + counts/timestamps. No free text. Reason: pattern claims must rest on stable keys; free-text smuggled into aggregate prompts produces ungrounded LLM clustering.
- **Per-flag zoom-in** (post-session insight that cites a specific pain entry, chat answering "tell me about the left-knee thing yesterday"): full row including `free_text` is in the context bundle. The prompt instructs the model to **quote** the free text verbatim if it surfaces it ("der Nutzer notierte: «...»"), never to paraphrase or interpret beyond the literal words. This mirrors the existing S1 locked-language rule from `stage4-prose` (paraphrase-OK, relativisation-forbidden) but adapted: for pain text the rule is **echo-verbatim-or-omit**.
- **Stage-6-equivalent grounding gate** for the training insight enforces this: any sentence that mentions a pain location must either (a) reference the structured `(location_code, side)` exactly, or (b) be a verbatim quote of `free_text` in guillemets. Violations → regen, then deterministic stub.

This keeps the aggregation surface analytically tight while still letting the chat / per-session zoom-in carry the user's actual words into the analysis — which is where the nuance lives.

## Build sequence (proposed)

Tasks #3–#11 in the session task list map to this sequence. Tasks #3, #4, #7 are the structural ones I'd like sign-off on before commits.

- **A. Schemas + M008 migration** — JSON schemas for all entities in `runner/src/schemas/training/`: `training_plan_v1.schema.json` (plan document — general: arbitrary phases, arbitrary session templates per week, arbitrary exercise references, generic progression rules), `session_template.schema.json`, `actual_session.schema.json`, `set_log.schema.json`, `pain_flag.schema.json`, `adjustment_proposal.schema.json`, `exercise.schema.json`, `training_insight.schema.json`. M008 SQL in `db-migrations.ts` adds the seven tables + `PULSE_SET_LOG_AUDIT` + `PULSE_CHAT_QUEUE`. `npm run gen:types` regenerates `lib/types/generated.d.ts`. Vitest round-trips migration + seed exercise library (~30 baseline exercises covering all movement patterns, not just the user's plan).
- **B. Plan import + read** — `import-plan.ts` parses seed MD and POSTs `plan_v1` + referenced exercises to Pi; `lib/training-plan.ts` (latest active, history list, plan-by-version, plan diff util); `GET /api/training/plan?version=…`. Verified by importing seed and round-tripping into dashboard read. Plan document schema is generic — re-importable for any future plan, not just reconditioning.
- **C. Session UI** — `/training` route group with three states (today / in-session / post). IndexedDB queue + service worker offline shell. `/api/training/session/*`. Local-first verified with browser DevTools "offline" toggle.
- **D. Wearable stitching** — pure function over (session, recent_workouts), unit tests for the policy edges. Stitch on session finalize + nightly sweep job for orphaned cases. Manual picker UI.
- **E. v3 training use-case** — `packagers/training.ts`, `prompts/training.ts`, `schemas/training_insight.schema.json`. Event subscribers (`workout_complete`, `manual`, `day_end`). Locked-language stub for pain flags; stage-6-equivalent grounding check.
- **F. Proposal review UI** — `/training/proposals` route. Diff renderer. Accept produces `plan_v(n+1)` atomic write + pointer update in one DB transaction.
- **G. Chat surface** — `/training/chat` panel with streaming. Context builder. Remote→local fallback. Structured-proposal extractor.
- **H. Dashboard integration** — Daily synthesis training section (read training insight in v2 daily prose); activity-page training-load lane; workouts deep-link to session detail. New alarm classes (`training_pain_recurrence` S2, `training_overload` S2, `training_phase_stall` S3) wired into `runner/src/rules/`.
- **I. Verify + Pi deploy** — Playwright J1–J7 walk, screenshots into `tmp/`. `ssh pi` deploy. Smoke test with Mac Ollama off (chat fallback) and Mac Ollama on.

First-iteration scope = A through I as listed. Out-of-scope per brief: programmatic phase advancement, exercise-library management UI, plan-version-rollback UI, training-data export — those are second-iteration.

## Resolved questions

- **Q1 Topology** — Mac writes JSON, Pi writes DB. §1 + §3 + §5 rewritten.
- **Q2 Plan-version retention** — keep all versions forever. Plan diffs + `change_summary` per version + `resolution_note` per proposal feed the LLM context bundle on every subsequent analysis. `PULSE_TRAINING_PLAN.parent_version` + `change_summary` are NOT NULL except for v1. Plan-history timeline on `/training/plan` (data ready, full visualisation second-iteration).
- **Q3 Pain-flag vocabulary** — two-channel. Structured `(location_code, side)` enum for aggregation + recurrence alarms (closed vocabulary, general body regions, ~14 codes × 4 sides). Free text retained verbatim; LLM may **echo-verbatim-or-omit** in per-flag zoom-in context but never paraphrase or use for grouping. Aggregate prompts see structured only. Stage-6-equivalent grounding gate enforces the rule. See §7.
- **Q4 Chat fallback** — no local fallback; async queue with stale-state UI. §6 rewritten.
- **Q5 Today's training UI** — Training page shows the suggested session at the top (recovery-justified, LLM-prosed) + a session-template picker covering every defined template in the plan + "Custom". Non-suggested picks are first-class: `ActualSession.deviation_reason ENUM[user_choice,recovery,schedule,other]`. Runner does not editorialise; logs deviation and adapts future suggestions. No "Tag A/B/C" hardcoded — picker enumerates plan-defined templates.
- **Q6 Edit after finish** — option (b): editable + audit. `PULSE_SET_LOG.last_edited_at`, `PULSE_SET_LOG_AUDIT` row per edit (before_json/after_json/source). If an emitted training insight cited the old numbers, mark `stale=true` and re-emit on next event tick.

All open questions resolved. Phase A unblocked.
