# Pulse v4 migration — pipeline + UI rework

Status: **Phase 3 partial — v4 home page at `/v4` working end-to-end.** Home swap + remaining drill pages + Phase 4 cleanup queued.

## Why we're doing this

The current event-driven cluster pipeline (v2 daily + v3 use-case + Phase-3
cluster registry) has structural holes the dashboard cannot paper over:

- **Cluster-name drift** between writer (`synthesis`) and reader (`synthesis_v3`)
  → JobCell rows never reconcile, status pill misleading.
- **Silent `pushInsight` failures** since ~2026-05-13 → activity/recovery/day_score
  rows stop landing in PULSE_INSIGHT; dashboard runs on disk-JSON fallback only.
- **`findLatest*` walks** across dates → home page tiles drift to different
  source dates with no global "as-of" anchor visible to the user.
- **Quiet-day blind spot** → activity insight needs `workout_complete` to fire;
  rest days never get an insight until hourly day_end sweep, often hours late.
- **10-min chokidar poll** on `Gadgetbridge.db` → unbounded latency between
  phone-sync and first dashboard update.
- **No view-state aggregator** → every page composes 5–12 loader calls + N
  client-side `DerivedCell` polls; no single doc represents "what does the
  user see right now."

See full audit in the conversation transcript (overview-pass, 2026-05-27).

## Target architecture

- **Single source of truth per period:** one `view_state.json` doc per period
  key (`view/daily/<YYYY-MM-DD>.json`, `view/weekly/<YYYY-Www>.json`),
  Pi-resident, atomic-merged from Mac POSTs. No fallback walks.
- **Slot-based pre-compute:** 5 fixed daily slots + 1 weekly + 2 dynamic
  event slots. Each slot has explicit `scheduled_for`, `ttl_ms`, and
  status state machine.
- **Two tiers:** tier-1 deterministic refresher (60s tick, no LLM) and
  tier-2 LLM slots (scheduled cron + event bumps).
- **Pi single-writer:** Mac POSTs `Tier1Diff` / `SlotDiff` / `MetaDiff` via
  HTTP. Pi atomic-merges. Syncthing not in the hot path → no
  bidirectional-write corruption risk.
- **Slots compose prior slots:** each slot's package declares `prior_slot_refs`.
  Failure isolation: missing prior slot → `degraded` status, slot still runs.
- **SSE for browser updates:** one connection per tab; server pushes diffs as
  slot computes land.

## Slot inventory

| Slot | Scope | Default trigger | TTL | Depends on |
|---|---|---|---|---|
| `night_review`     | daily | wake (sleep_complete) | 22h | — |
| `morning_briefing` | daily | max(wake+10m, 08:00 local) | 6h | night_review |
| `midday_check`     | daily | 13:00 local | 4h | morning_briefing |
| `evening_review`   | daily | 19:00 local | 4h | midday_check |
| `day_synthesis`    | daily | 23:00 local / day_end | 24h | evening_review |
| `week_synthesis`   | weekly | Sun 22:00 / day_end | 7d | — (soft: 7 day_synthesis) |
| `post_workout`     | daily (event) | workout_complete + 5m | 12h | — |
| `anomaly_explain`  | daily (event) | manual click | 7d | — |

GPU budget: 6–8 LLM calls/day (similar to current). Always pre-computed; no
view-triggered LLM.

## Phase plan

### Phase 0 — Foundation ✓ (scaffold only)

- [x] `runner/src/v4/` directory skeleton
- [x] `slot-entry.schema.json` (universal envelope)
- [x] `tier1.schema.json`
- [x] `view-state.schema.json`
- [x] `runner/src/v4/types.ts` (TS contracts mirroring schemas)
- [x] `runner/src/v4/slots/*/types.ts` (per-slot payload placeholders)
- [x] `runner/src/v4/slots/_registry.ts` (slot registry with schedules + deps)
- [x] `runner/src/v4/view-state/{builder,reader,writer}.ts`
- [x] vitest smoke (4/4 green) + typecheck clean
- [x] this migration doc

**Output:** v4 directory scaffolds compile + writer round-trips with CAS;
no behavior change anywhere; v3 untouched.

### Phase 1 — Slot data layer ✓

All 8 slots have payload types, JSON schemas, packagers, prompts, validators,
schedule re-exports. Shared grounding harness ported to
`runner/src/v4/validate/grounding.ts`. Cross-slot registry/schema consistency
covered by `runner/src/v4/__tests__/slots-smoke.test.ts`. 19/19 tests green,
typecheck clean.

Per slot: 4 files in `runner/src/v4/slots/<slot>/`:

- `schedule.ts` — exports schedule constants pulled from `_registry.ts`
- `package.ts` — declares input shape + `buildPackage(ctx)` builder. Reads
  tier-1 + prior SlotEntry payloads. Returns a structured input bundle.
- `prompt.ts` — exports `SYSTEM_PROMPT` + `buildUserPrompt(pkg)`. German
  prose. References field names from package.
- `validate.ts` — exports `validate(payload, pkg): { ok, errors,
  grounding_errors }`. Schema check (Ajv against the slot's payload
  schema) + grounding (every number in prose ∈ pkg facts).

Plus per slot a payload JSON schema at `v4/schemas/slot-<slot>.schema.json`.

Implementation order:
1. `night_review`  — depends on nothing; foundation for morning
2. `morning_briefing` — depends on night_review
3. `day_synthesis` — depends on all (worst case for composition logic)
4. `midday_check`, `evening_review` — intermediate slots
5. `post_workout` — event slot, fast iteration
6. `anomaly_explain` — user-triggered; simpler input
7. `week_synthesis` — separate weekly path

Stage L is gone — slots run sequentially per dependency order, not parallel
clusters. Single GPU lane via Ollama mutex.

### Phase 2 — Scheduler + worker cutover ✓ (scaffold)

Built so far (38 tests green):
- `runner/src/v4/tier1/refresher.ts` — deterministic Tier1 builder
- `runner/src/v4/scheduler/calendar.ts` — pickDueSlots, applyBump, decayStatuses
- `runner/src/v4/worker/invoke-llm.ts` — Ollama wrapper with retry-on-validation
- `runner/src/v4/worker/slot-handlers.ts` — per-slot handler registry
- `runner/src/v4/worker/dispatch.ts` — slot dispatcher (status state machine)
- `runner/src/v4/transport/outbox.ts` — Mac → Pi HTTP outbox with disk-backed retry
- `app/api/ingest/view/[date]/route.ts` — Pi ingest endpoint (GET + POST)
- `runner/src/v4/scheduler/daemon.ts` — tick orchestrator + event bump entry point

### Phase 2b — CLI + event watcher ✓

- `runner/src/v4/scheduler/event-watcher.ts` — pure DB-delta → BumpEvent
  derivation, separate cursor (`state/v4-event-cursor.json`) so v3 + v4
  can coexist
- `runner/src/v4/scheduler/run.ts` — `startV4Daemon()` + `blockForever()`:
  60s tick loop, chokidar watcher with debounce, SIGINT/SIGTERM shutdown
- `runner/src/index.ts` — `pulse v4-daemon [--tick=60]` CLI command
- 42/42 tests green; typecheck clean both sides

v3 + v4 run side-by-side; the legacy event-driven loop stays put until
Phase 4 cleanup.

### Phase 3 — UI cutover (in progress)

**Shipped:**
- `app/api/view/[date]/route.ts` — GET (HTTP 200 verified with seeded view-state)
- `app/api/view/[date]/sse/route.ts` — SSE stream (initial `event: view` chunk verified)
- `app/api/view/[date]/retry/[slot_id]/route.ts` — POST retry
- `lib/view-state/{fetcher,context}.tsx` — SSR loader + ViewStateProvider with SSE
- `components/view/{SlotCell,SlotStrip,SlotStatusPill,Tier1Tile,PipelineHealthBadge,NextRefreshIndicator,SlotRetryButton}.tsx`
- `components/slots/{NightReview,MorningBriefing,MiddayCheck,EveningReview,DaySynthesis,WeekSynthesis}Body.tsx`
- `app/(app)/v4/page.tsx` — parallel v4 home (renders all 5 daily slots end-to-end with seeded view-state)
- `defaultViewRoot()` helper in writer.ts now resolves PULSE_ROOT → INSIGHTS_ROOT → PULSE_VIEW_ROOT; reader reuses

**Queued (Phase 3 finish):**
- Swap `app/(app)/(home)/page.tsx` to read view-state (defer until daemon writes a real doc)
- Rewrite `app/(app)/day/[date]/page.tsx`, `coach/`, `sleep/recovery/activity/[date]/`, `week/[weekKey]/`
- `components/slots/{PostWorkout,AnomalyExplain}Body.tsx`

### Phase 3 — UI cutover (original scope, retained for reference) (2.5d)

Pi-side:
- `app/api/view/[date]/route.ts` — GET view_state.json
- `app/api/view/[date]/sse/route.ts` — SSE stream
- `app/api/view/[date]/retry/[slot_id]/route.ts` — POST retry
- `app/api/ingest/view/{tier1,slot,meta}/route.ts` — Mac → Pi PATCH endpoints
- `app/api/ingest/view/[date]/route.ts` — Pi-side: Mac POSTs diff, Pi calls
  `ViewStateWriter.applyX`

Components:
- `lib/view-state/{fetcher,context}.tsx` — SSR loader + ViewStateProvider
- `components/view/{SlotCell,SlotStrip,SlotStatusPill,Tier1Tile,PipelineHealthBadge,NextRefreshIndicator,SlotRetryButton}.tsx`
- `components/slots/{NightReview,MorningBriefing,MiddayCheck,EveningReview,DaySynthesis,PostWorkout,AnomalyExplain}Body.tsx`

Pages:
- Rewrite `app/(app)/(home)/page.tsx` → reads `<ViewStateProvider date={active}>` only
- Rewrite `app/(app)/day/[date]/page.tsx`
- Rewrite `app/(app)/coach/page.tsx` (reads morning_briefing + day_synthesis)
- Rewrite drill pages: `/sleep/[date]`, `/recovery/[date]`, `/activity/[date]` → tier1 charts + per-slot prose subsections
- Rewrite `app/(app)/week/[weekKey]/page.tsx` → reads weekly view_state

Delete:
- `lib/v3-loaders.ts`, `lib/insights.ts`, `lib/bundle.ts`, `lib/derived/*`
- `components/derived/*`
- `components/domain/{morning-insight-cell,synthesis-cell,weekly-recap-cell,explain-spike-button,insight-section,pending-insights-bar}.tsx`
- `app/api/{jobs,insights,runner,patterns,explain-anomaly}/*`

### Phase 4 — Cleanup (0.5d)

- Delete `runner/src/{v2-orchestrator.ts,v3-orchestrator.ts,clusters/,stages/,events/,jobs/,scheduler/poll-loop.ts,scheduler/triggers.ts,analyzer/,v3/,prompts/snapshot/,prompts/{daily,weekly,evidence-picker}.ts}`
- Delete `app/api/{jobs,insights,runner,patterns,explain-anomaly,ingest-screenshot,chart}/*`
- Delete `state/{completion-log.jsonl,event-cursor.json,events.jsonl,triggers.json}`
- Repurpose `PULSE_INSIGHT` + `PULSE_BUNDLE` as audit-only (or drop)
- Wipe legacy `$INSIGHTS_ROOT/daily/<date>/*.json` (keep `$INSIGHTS_ROOT/view/`
  only)
- Update `CLAUDE.md` with v4 architecture
- Update `deploy/` docs (single service: `pulse v4-daemon`)

## Hole-by-hole resolution map

| Hole | v3 problem | v4 fix |
|---|---|---|
| H1 cluster-name drift | `synthesis` vs `synthesis_v3` | One name per slot, scoped inside view_state |
| H2 silent pushInsight | rows stop landing | No PULSE_INSIGHT in hot path; pushView fails loud, outbox retries |
| H3 findLatest walks | tiles drift dates | Tiles read `tier1.kpis_today` only (single date) |
| H4 quiet day no activity | rest day → no insight | day_synthesis runs unconditionally; activity context lives in evening_review |
| H5 live `_bundle.json` ambiguity | half-baked pipeline_status | Slot statuses explicit; tier1 always fresh |
| H6 10-min chokidar | event lag | 60s poll + event hooks |
| H7 noStore + walks | slow page | One file read, no walks |
| H8 v2 + v3 daily.json | dual writes diverge | Only `view_state.slots.day_synthesis` |
| H9 no view-state aggregator | scattered reads | view_state IS the aggregator |
| H10 PULSE_RUN telemetry hidden | runner status invisible | `view_state.meta.pipeline_health` surfaced to UI |

## Decisions locked

- view_state writer: **Pi single-writer**. Mac POSTs diffs via HTTP. No Syncthing.
- Browser transport: **SSE**.
- v2 pipeline: **full delete**. S1 safety obs → deterministic `tier1.context.anomalies_today`.
- weekly: **parallel rework** (`view/weekly/<weekKey>.json` + `week_synthesis` slot).

## Total estimate: ~9 days focused work

Phase 0: 1.5d (done)
Phase 1: 3d
Phase 2: 1.5d
Phase 3: 2.5d
Phase 4: 0.5d
