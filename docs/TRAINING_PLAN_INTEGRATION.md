# Claude Code Prompt — Pulse Training Plan Integration

> Source brief, archived in the repo so future agents can `@docs/TRAINING_PLAN_INTEGRATION.md` for the original mission statement. The structured design decisions live in `TRAINING_PLAN_DESIGN.md`.

---

## Mission

Pulse currently ingests passive health data and surfaces it as daily/weekly insights. Add a **training plan layer** so that the same system can drive the user's gym sessions: prescribe what to do today (with LLM-justified reasoning), capture set-level feedback during the session, fuse it with the wearable's auto-recorded workout window, analyse it, surface it in dashboards, and propose plan adjustments that the user approves explicitly.

The user is returning from a 2+ year gym pause. The plan content is documented in `@docs/training-plan-2026.md` (Phase 1 reconditioning → Phase 2 hypertrophy → Phase 3 powerbuilding). That file is the seed data for the system you are building, not a separate concern.

The hard parts here are: **UI on a phone in a gym**, **time-correlation of subjective set logs with the wearable's HR/duration record**, and **a single coherent data integration** that does not bolt-on parallel to the existing pipeline.

---

## Read Before Starting

Required reading, in order:

1. `@CLAUDE.md` — full architecture, hard rules (atomic writes, `_complete` sentinel, single-writer constraints, period helpers, Gadgetbridge oddities). **All hard rules apply unchanged to this work.**
2. `@docs/training-plan-2026.md` — the concrete plan: phases, exercises, sessions, progression logic, red flags, entry criteria. This is the seed payload.
3. `@runner/src/v2-orchestrator.ts` + `@runner/src/stages/` — how a daily insight is produced. New training-related insights should follow this pattern, not invent a new one.
4. `@runner/src/schemas/v2/` — schema versioning conventions. New schemas go here with the same patterns (`schema_version`, atomic write, JSON Schema validation).
5. `@app/(app)/workouts/page.tsx` + `@app/(app)/activity/page.tsx` + `@lib/queries/workouts.ts` + `@lib/queries/workout-stitch.ts` — how workouts are read today.
6. `@app/(app)/coach/` — existing coaching UI patterns (`anchor/tiny/why/horizon`, `micro_experiment`) — reuse these idioms in plan-adaptation suggestions; do not invent a parallel design language.

---

## Goals — in order of priority

**G1. Plan-as-data, owned by Pulse.**
The plan in `docs/training-plan-2026.md` becomes a structured, versioned artefact inside Pulse — readable by the runner, displayable by the dashboard, editable through explicit user actions. Plan history is preserved; every adjustment produces a new version with an audit trail of *what changed, why, by which actor (LLM proposal vs user edit)*. The Markdown file remains the human-readable source-of-record for the *initial* import; thereafter Pulse is authoritative.

**G2. A pre-workout "Today" view.**
When the user opens the training surface, they immediately see what today's session is, why this session and not another (Phase + day-of-week + LLM-justification grounded in recovery context: HRV, RHR, sleep, cumulative 7d load, recent pain flags), and a one-tap "start session" affordance. Justification text follows the existing daily-insight prose conventions (German, sober, evidence-anchored — not motivational fluff).

**G3. Frictionless set-level logging during the session.**
The user is in a gym, sweaty, one hand on a dumbbell. The logging surface must work at that ergonomic budget. Per exercise: numeric input for reps and weight, RPE 1–10, a pain/discomfort flag (none / mild / sharp + free-text location), an optional note. Per session: subjective energy post-workout (1–5), adherence status (full / abbreviated / substituted). Logging state survives accidental backgrounding, network blips, and process kills — local-first, sync when possible.

**G4. Time-correlation with wearable record.**
After the session, the corresponding wearable-recorded workout window (start_iso, end_iso, HR samples, calories, hr_zones) is fused with the set logs into a single `workout_session` record. The wearable record gives the involuntary truth (when did you actually lift, what was your HR doing); the set logs give the volitional truth (what you intended, what you felt). Pulse stitches them through timestamp overlap, with a manual override if the wearable's auto-detection missed or split the session.

**G5. LLM analysis becomes a new use-case in the existing pipeline.**
A new daily-pipeline stage (or v3 use-case, your call — propose, do not just pick) ingests recent sessions + recovery context and produces a `training_adaptation` insight: per-session-quality KPIs, pattern callouts (e.g. "RPE creeping up on Lat Pulldown over 3 sessions, no progression → likely fatigue, not weakness"), and concrete adjustment proposals for the next instance of each session. **Local Ollama** runs this preprocessing (`OLLAMA_URL`, `COACH_MODEL=qwen3.6:latest`).

**G6. Dashboard integration, not a parallel app.**
Training KPIs surface inside existing surfaces: the daily synthesis mentions today's session and yesterday's adherence; the activity page shows training load alongside steps and active minutes; the body / heart pages reflect the new training stimulus in their trends; a new dedicated `/training` route gives the focused workflow but does not become an island. Existing components (`Section`, `Card`, `Eyebrow`, `Pill`, `FadeRise`, `Glyph`) are reused.

**G7. Plan adjustments require explicit confirmation.**
The LLM never silently mutates the plan. Proposed adjustments appear as a diff view (current → proposed, per exercise, with the LLM's reasoning trace and the data points it cited). User accepts, edits, or rejects. Only accepted diffs produce a new plan version. Rejected proposals are preserved with the rejection reason for future learning.

**G8. A chat surface for ad-hoc questions, backed by the remote LLM.**
A separate chat panel — context-aware (current plan version, current phase, recent sessions, today's recovery state are passed as system context) — answers questions like "should I deadlift today, my back feels tight?" or "what if I swap Tag B with Tag C this week?". This is the **remote** Ollama endpoint at `http://<your-ollama-host>:11434` (Tailscale), used because it is the user's higher-capability model host; the local one is reserved for the deterministic preprocessing pipeline. If the remote endpoint is unreachable, the chat surface degrades gracefully (queue + retry + clear status, no silent failure).

---

## User Journeys (concretely, not abstractly)

### J1. Morning, day-of-training
User opens Pulse on the Pixel Fold. The daily-synthesis page already shows recovery status. Either inline on that page or via a clear nav affordance, the user sees: *"Heute Tag A — Push-dominant. HRV 78 ms, gut für Plan-volle Session. Letzte Tag-A-Session: vor 4 Tagen, alle Sätze sauber. Vorschlag: Goblet Squat 3×10 mit 16 kg (letzte: 14 kg, RPE 6)."* Tapping enters the session view.

### J2. Mid-session
One-screen-per-exercise layout. The exercise name, the target sets/reps/load (from plan), the last-time values for the same exercise (so the user has a comparison), three numeric inputs, an RPE selector, a pain toggle. "Done" advances to the next exercise. A rest timer appears if useful. Mid-session adjustments allowed: "skip exercise", "substitute exercise" (picker showing plan-compatible alternatives), "end session early". State persisted continuously; reopening the app mid-session resumes exactly where the user left off.

### J3. Right after the session
A 30-second post-session check: subjective energy 1–5, free-text note (optional, skippable). The wearable-stitching happens in the background — if the wearable saw the workout window, it auto-links. If not, the user is offered a manual "this was my workout" picker over recent wearable activity entries.

### J4. Next morning
Daily synthesis mentions yesterday's session: adherence (n/n sets logged), RPE distribution, pain flags if any, fused wearable summary (duration, avg HR, kcal). If the LLM has a small adjustment proposal for the next instance of that session, it surfaces here as a tappable suggestion (consistent with how `suggestions_today` works in the existing daily insight).

### J5. Sunday weekly review
The weekly insight (existing pattern) gains a training section: weekly volume per muscle group, RPE trends, adherence rate, pain-flag recurrence. If any phase-entry criteria are met (or violated), the weekly insight surfaces a "phase progression / phase hold" recommendation with a diff preview of the proposed Phase 2 plan.

### J6. Plan adjustment review (any time)
A pending-proposals inbox: each card is a proposed diff with the LLM reasoning. User accepts whole, edits in-place, or rejects with optional reason. Accepted diffs produce `plan_v(n+1)`; rejections are persisted as training signal.

### J7. Ad-hoc chat
A "Frag Pulse"-style entry point (anywhere in the app, but prominent in the training surface). The user types a question. Context auto-injected: current plan version snippet, current phase, last 7 days of sessions + recovery. Streamed response from the remote LLM. The chat is **not** a persistent assistant — sessions are scoped, ephemeral, but logged for review.

---

## Data Model Goals (the *what*, not the *how*)

The entities you need to represent are:

- **TrainingPlan**: a versioned document with phases, current-phase pointer, exercise library (canonical exercise definitions with substitutes), entry/exit criteria per phase, created/updated metadata, and a parent pointer (for version history). The seed import comes from `docs/training-plan-2026.md`; thereafter it lives in Pulse.
- **PlannedSession**: a specific instance of a session-template-from-plan, dated, with the *intended* exercise list and target loads at the moment it was scheduled.
- **ActualSession**: the live record. Has set-by-set logs, subjective post-data, and an optional `wearable_workout_link` once stitched. State transitions: `planned` → `in_progress` → `completed` / `abandoned`.
- **SetLog**: one row per set actually performed. Includes RPE, pain flag, note.
- **PainFlag** (as a first-class concept, not buried inside a set log): location, severity, exercise it was raised on, session it was raised in. So pattern detection can ask "is left back recurring across multiple Tag-B sessions over 3 weeks?".
- **AdjustmentProposal**: an LLM-generated diff against the current plan, with status (`pending` / `accepted` / `rejected` / `edited`), reasoning trace, and citations to the data that prompted it.

Persistence layer: **propose** (don't blindly pick) the right split between `pulse.db` (structured, queryable, transactional) and the JSON-on-disk insight pattern (atomic, versioned, Syncthing-friendly). Both have precedent in the current codebase. The user wants a written design rationale before you commit one way or the other.

---

## LLM Integration Goals

**Local Ollama (`OLLAMA_URL`, `COACH_MODEL=qwen3.6:latest`, currently only wired in preprocessing):**
- Today's-session justification text (J1).
- Post-session quality scoring + KPI computation (J4).
- Weekly synthesis training section (J5).
- Adjustment proposals (J6).

This runs as a new stage in the existing daily/weekly pipeline. It is deterministic-as-possible, prompt-versioned, schema-validated, and goes through the existing `ollama.ts` helper and prose-stage patterns (Stages 3/4 are your reference template). It must respect the same locked-language rules as S1-safety observations: pain flags get template language, not LLM paraphrasing. Stage 6 verification must extend to training claims.

**Remote Ollama (`http://<your-ollama-host>:11434`, same model or whatever is loaded there — auto-detect):**
- Powers the chat surface (J7) only.
- Has access to a context bundle (current plan, current phase, recent sessions, today's recovery state) but does not write — the chat cannot mutate the plan; if the user asks it to, it produces a structured adjustment proposal that enters the J6 review flow.
- Reachability is unreliable (laptop-on-Tailscale dependent). Fail loud, queue locally, retry on reconnect.

---

## Integration Points with Existing System

- **Daily pipeline** (`runner/src/v2-orchestrator.ts`): a new stage runs *after* facts (Stage 0) and rules (Stage 1) but before prose (Stage 4), so its outputs are available to the prose stage to fold into the day summary. Or add a parallel `training_*` use-case in `runner/src/v3/` if v3 is the more natural home — propose, then proceed.
- **Daily insight schema** (`runner/src/schemas/v2/daily.schema.json`): extend (don't replace) with optional training fields. Pi must keep rendering days without training data.
- **Weekly insight** (`stageW-weekly.ts`): training section added analogously.
- **Activity page** (`app/(app)/activity/`): adds a training-load lane next to steps/active-minutes. Same chart vocabulary.
- **Workouts page** (`app/(app)/workouts/page.tsx`): each workout row, if linked to an ActualSession, deep-links into the session detail with set logs visible alongside the wearable's HR trace.
- **Alarms** (`runner/src/rules/`): new alarm classes — `training_pain_recurrence` (S2), `training_overload` (S2), `training_phase_stall` (S3). Same threshold ladder (singleton suppressed → ≥2 info → ≥3 warn → ≥10 critical).
- **Profile / Settings**: a profile area lists active plan version, allows manual plan import (paste-MD or upload), shows phase status, allows manual phase-advance override (for power-user escape hatch).

---

## Constraints (non-negotiable)

- **All hard rules in `CLAUDE.md` continue to apply.** Read them. Especially: `Gadgetbridge.db` is read-only; `pulse.db` is single-writer (Mac); atomic writes via `output.ts`; `_complete` sentinel semantics; period helpers, not raw dates.
- **Mac is the runner host. Pi is the dashboard.** The training pipeline runs on Mac. The Pi serves the UI and writes only the user-facing state files (in the bidirectional `state/` folder). Session logs the user creates from the Pi-served UI flow through whatever write channel state files already use — do not introduce a new direct-DB write path from the Pi.
- **Schema-first.** Every new entity has a JSON Schema in `runner/src/schemas/`. Types are generated via `npm run gen:types`. No hand-edited types in `lib/types/generated.d.ts`.
- **Local-first UX during a session.** A logged set must persist locally before any network IO. The user must be able to complete an entire session offline.
- **Confirmation gating.** Plan mutations never happen silently. The LLM is a proposer, not an actor.
- **No motivational language.** Pulse's voice is sober, evidence-anchored, German. Match the existing daily-insight prose tone. Avoid hype, avoid emoji, avoid imperatives without justification.
- **Pain-flag language is locked.** Do not let the LLM paraphrase pain locations or severities. Use template strings driven by structured fields.
- **Do not refactor v3 alongside v2** unless explicitly necessary. If v3 is the right home for the training use-case, document the boundary clearly.

## Non-Goals

- **No native app, no Watch app.** Web UI only. The user is on GrapheneOS / Pixel Fold; a well-built PWA-quality web view is sufficient.
- **No multi-user.** Pulse is single-user. Do not introduce a `user_id` concept now.
- **No prescription of medical advice.** Pain flags get logged and surfaced; the system never says "this is/isn't a serious injury". The plan document (`docs/training-plan-2026.md`) already has a "Sport-Physio-Termin" as a manual TODO — leave medical judgement to the human.
- **No video / form-checking.** Out of scope.
- **No social, no sharing, no leaderboards.** Out of scope.
- **Do not build a generic workout-tracker.** This is a plan-execution and plan-adaptation system. The plan is the spine.

---

## Verification Loop

You can verify your work yourself; use it.

1. **Dev server**: `npm run dev` from repo root → `http://localhost:3030`. Use Playwright (headed or headless) to drive the training surface, capture screenshots of each user journey, and visually verify against the existing dashboard's design language.
2. **Runner pipeline**: `cd runner && npx tsx src/index.ts daily --date=YYYY-MM-DD --dry-run` to validate the new stage emits valid JSON against its schema without writing. Then a full run on a real recent day.
3. **Pi deploy**: SSH access available as `ssh pi`. Build, deploy, and verify the Pi-served dashboard renders training data correctly (read-only path). Run Playwright against the Pi-served URL too — Mac-only-features failing on the Pi is a class of bug you should catch.
4. **Local LLM reachability**: `curl http://host.docker.internal:11434/api/tags` from the runner container; same from the dev server context for the local Mac route.
5. **Remote LLM reachability**: `curl http://<your-ollama-host>:11434/api/tags`. Tolerate unreachability and document the failure mode.
6. **Screenshots committed to** a scratch folder under `tmp/` so the user can review the user journey without running the stack himself.

Visual quality bar: the new surfaces should be indistinguishable in feel from the existing dashboard. If they look bolted-on, they are bolted-on.

---

## Open Decisions (propose, do not silently pick)

Before writing significant code, produce a short design note (`docs/TRAINING_PLAN_DESIGN.md`) covering these decisions with rationale. Wait for user feedback on the design note **before** committing to large structural choices. Small/clear decisions can proceed without waiting.

1. **Persistence split**: `pulse.db` (SQLite, structured) vs JSON-on-disk (atomic, versioned). Which entities go where, and why? Specifically, set logs are write-heavy and queryable (DB), plan versions are document-shaped and history-tracked (JSON-on-disk feels natural), proposals are pending+resolution states (could go either way).
2. **Pipeline home**: new stage in v2 orchestrator, or new v3 use-case? v2 is wired into the live dashboard today; v3 is the future direction. Argue both ways.
3. **Session write path from Pi**: the user might open a session from the Pi-served UI but the runner lives on Mac. Either (a) Pi writes to a bidirectional state-folder file that the Mac runner picks up on next watch tick, (b) the Pi-served UI calls a Mac-hosted API directly when Mac is reachable, or (c) the session-logging is only available when served from Mac. Choose with rationale, accounting for the gym-with-bad-WiFi scenario.
4. **Wearable stitching threshold**: what counts as "same workout"? Strict timestamp overlap is naive — the user starts logging before the watch detects the workout. Propose a stitching policy (e.g. overlap ≥50% + duration within 30% + same calendar day) with explicit fallback to manual link.
5. **Plan import format**: read `docs/training-plan-2026.md` directly (parse the Markdown tables), or convert it to a structured seed file once-and-for-all? Markdown is fragile to parse; a structured seed loses round-trip with the human document. Propose.
6. **Local vs remote LLM split**: confirm or push back on the split as stated above (local = pipeline preprocessing; remote = chat). Is there a use-case where remote should help preprocessing (e.g. when local Mac is asleep)? Is there a use-case where the chat could degrade to the local model? Propose.

---

## What "done" looks like for the first iteration

- A user can open Pulse on the phone, see today's session prescribed with LLM justification, log every set with one-handed friction, see post-session fusion with the wearable, and the next morning see the LLM's adjustment proposal.
- The plan from `docs/training-plan-2026.md` is loaded and authoritative inside Pulse.
- Existing pages (daily synthesis, activity, workouts) reflect training data without losing their original purpose.
- The chat surface answers a question grounded in current plan + current state.
- The Pi deploys and serves the new pages correctly.
- Playwright screenshots, committed to `tmp/`, walk the user through J1–J7.
- A design note exists and was reviewed before structural commits.

Out of scope for the first iteration but worth designing-toward: programmatic phase advancement, exercise-library management UI, plan-version-rollback UI, training-data export.
