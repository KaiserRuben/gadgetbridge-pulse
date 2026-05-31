# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pulse is a read-only Next.js dashboard plus a local-LLM coach pipeline over a Gadgetbridge SQLite export. It is a **split-deployment monorepo**: the Mac runs the full stack (Next.js + runner + Ollama), the Pi runs only the dashboard against synced JSON insights. The Pi never calls the model.

Two top-level npm projects:
- `/` — Next.js 16 / React 19 / Tailwind v4 dashboard.
- `/runner` — Node 22 coach runner. ESM (`"type": "module"`). Imports use explicit `.ts` extensions (`allowImportingTsExtensions: true`).

The root `tsconfig.json` *excludes* `runner/` but allows `@/runner/*` imports of selected files (whitelisted in `include`) so on-demand API routes can call analyzer modules. This is intentional — do not add the whole runner to `include`.

## Commands

```bash
# Dashboard (root)
npm install
npm run dev               # http://localhost:3030
npm run build             # next build + post-build copy of public/static into .next/standalone
npm start                 # serves the standalone build
npm run typecheck
npm run gen:types         # regenerate lib/types/generated.d.ts from runner/src/schemas/

# Runner
cd runner
npm install
npm run typecheck
npm run test                          # vitest run
npx vitest run path/to/file.test.ts   # single test
npx vitest -t "test name"             # by name
npm run test:watch

# Coach pipeline (run from /runner)
npx tsx src/index.ts daily                   # full v2 pipeline for latest day
npx tsx src/index.ts daily --date=YYYY-MM-DD
npx tsx src/index.ts daily --dry-run
npx tsx src/index.ts daily --force           # bypass _complete sentinel
npx tsx src/index.ts daily-watch             # live: stage 0/1 + alarms only, no LLM
npx tsx src/index.ts daily-finalize          # one-shot finalize newest complete day
npx tsx src/index.ts daily-finalize-loop     # long-running, --lookback Nd
npx tsx src/index.ts backfill --days=30
npx tsx src/index.ts backfill-alarms --days=30

# Legacy snapshot pipeline (still wired)
npm run snapshot
npm run snapshot:dry
npm run watch

# Production: two services in docker-compose
cd runner && docker compose up -d           # gadgetbridge-runner + gadgetbridge-finalize
```

`npm run test` from root delegates to `runner` vitest. There are no Playwright/UI tests.

## Data layout — outside the repo

Source DB and insights live under `$PULSE_ROOT` (default `~/pulse`) so Syncthing can sync them independently of the code:

```
$PULSE_ROOT/
├── Gadgetbridge.db          source, written by phone — READ-ONLY here
├── pulse.db                 sidecar; Mac is the single writer
├── insights/
│   ├── daily/<YYYY-MM-DD>/
│   │   ├── _facts.json              live, rewritten on every watch tick
│   │   ├── _facts_locked.json       frozen for the verifier at finalize time
│   │   ├── _bundle.json             stage records + timings + status
│   │   ├── daily.json               final v2 insight (only after _complete)
│   │   └── _complete                sentinel — full pipeline finalised
│   ├── weekly/<YYYY>-W<WW>/weekly.json
│   ├── alarms/<YYYY-MM>/alarms.json (append-only)
│   ├── coaching_cache/<isoWeek>/<lever>/<hash>.json
│   └── snapshot/<YYYY-MM-DD>/<domain>.json   (legacy)
└── state/{pause,labs,alarm_state}.json
```

Env overrides: `PULSE_ROOT`, `GADGETBRIDGE_DB_PATH`, `PULSE_DB_PATH`, `INSIGHTS_ROOT`, `STATE_ROOT`, `ALARMS_ROOT`, `OLLAMA_URL`, `COACH_MODEL`, `PULSE_STAGING_ROOT`.

## Daily v2 pipeline

Two services run simultaneously (see `runner/docker-compose.yml`):

- **`daily-watch`** — chokidar on `Gadgetbridge.db` mtime, 2s debounce. Runs Stage 0 (facts) + Stage 1 (rules) + alarm persistence. **No LLM, no `daily.json`, no sentinel.** Writes `_facts.json` + `_bundle.json` only.
- **`daily-finalize-loop`** — every 5 min, scans the last `--lookback` days. For each day-complete period without `_complete`, runs the full 7-stage pipeline.

Stages (in `runner/src/stages/` unless noted):

| Stage | File | LLM | Critical |
|-------|------|-----|----------|
| 0 | `facts/daily.ts` | no | yes |
| 1 | `stage1-rules.ts` (S1/S2/S3 observations) | no | yes |
| 2 | `stage2-retrieval.ts` (k-NN similar days) | no | yes |
| 3 | `stage3-evidence.ts` | yes | yes |
| 4 | `stage4-prose.ts` (German prose, structured output, ≤2 regen) | yes | yes |
| 5 | `analyzer/coaching-trajectory.ts` (per-lever, hash-cached) | yes | no |
| 5b | `analyzer/surprise-ranking.ts` + `pattern-{detection,naming,library}.ts` | yes | no |
| 6 | `stage6-verify.ts` + `stage6-paired-grounding.ts` (5-layer gate) | no | yes |
| 7 | `stage7-write.ts` (atomic write + `_complete`) | no | yes |
| W | `stageW-weekly.ts` | yes | no |

Orchestrator: `runner/src/v2-orchestrator.ts` (`runDaily(periodKey)`).

### Hard rules (most prior bugs come from breaking these)

- **`Gadgetbridge.db` is read-only.** All writes go to `pulse.db` or insights/state JSON. `pulse.db` is single-writer — **Pi** in the current topology (Mac runner POSTs to Pi `/api/ingest/*` over Tailscale; the Pi-served Next.js writes via `lib/data/period-store.ts`). Mac owns the JSON insight tree (`$INSIGHTS_ROOT/**`, Syncthing-replicated). Never co-write `pulse.db` from both hosts — Syncthing will silently corrupt SQLite under bidirectional writes.
- **Atomic writes only.** Insights stream through `/tmp/pulse-staging` then atomic rename, so Syncthing never picks half-files. Use the `output.ts` writer; do not `fs.writeFile` directly into `$INSIGHTS_ROOT`.
- **`_complete` is the source of truth.** The finalize loop calls `isDailyFinalised(periodKey)` and skips finalised days. Re-runs of `runDaily` exit early unless `--force`. `daily-watch` must never write the sentinel.
- **S1 safety observations have locked language.** Stage 4 paraphrases but cannot relativise. Stage 6 hard-fails on S1 violations and the prose summary is replaced by a deterministic stub before write; `bundle.pipeline_status` flips to `partial`.
- **Anomaly threshold ladder:** singleton suppressed → ≥2 info → ≥3 warn → ≥10 critical.
- **"Today" = wake-date local** (Europe/Berlin, prev-day 18:00 → this-day 12:00 sleep window). Use `period.ts` helpers, not raw `new Date()`.
- **Sleep stage codes:** 1 light · 2 REM · 3 deep · 4 awake.
- **HR signed-byte overflow:** real value = `256 + raw` when `raw < 0` and `raw !== -1`.
- **HUAWEI_ACTIVITY_SAMPLE.CALORIES is firmware-scaled — `firmware_unit / 1000 ≈ active kcal`** (verified against workout-summary kcal: 5-9 workout windows 2 297 624 fw vs 2 445 kcal, ~6% off; sedentary days 100–400 kcal, hike days 2 500+, all plausible). This is *active* kcal only, BMR not included.
- **HUAWEI_ACTIVITY_SAMPLE.DISTANCE is metres on GT 5 Pro** (verified: 5546 steps → 3164 m raw at 0.57 m/step, 24427 steps → 16535 m at 0.68 m/step matches workout-summary km). Do not apply the legacy `/100` divisor.

## Dashboard architecture

App Router under `app/(app)/` with a shared shell layout (sidebar + topbar). Domain pages: `day/[date]`, `week/[weekKey]`, `coach/`, `sleep/`, `activity/`, `heart/`, `body/`, `stress/`, `activities/`, `workouts/`, `alarms/`, `labs/`, `log/`, `profile/`, `explore/`. API routes in `app/api/`.

Key library boundaries in `lib/`:
- `db.ts` / `pulse-db.ts` — read handles. `db-writable.ts` / `pulse-db.ts` — Mac-only write handles.
- `queries/` — SQL query helpers (better-sqlite3). Treat workouts via `lib/queries/workout-stitch.ts`.
- `insights.ts` / `bundle.ts` — read insight JSON from disk.
- `state-io.ts` — read/write `state/*.json`.
- `chart-spec.ts` — schema for the dynamic chart panel; backed by `components/charts/dynamic/*` (calendar, comparison, distribution, scatter, stacked, trend, panel, meta).
- `types/generated.d.ts` is regenerated from `runner/src/schemas/` via `npm run gen:types` — do not hand-edit.

UI: Tailwind v4 (`postcss.config.mjs`), `next-themes`, `motion`, Recharts, Radix primitives. Components grouped by purpose (`charts/`, `coach/`, `domain/`, `explore/`, `log/`, `nav/`, `skeletons/`, `ui/`).

On-demand LLM routes (`/api/explain-anomaly`, `/api/ingest-screenshot`) need `OLLAMA_URL` to point at the Mac. The Pi cannot serve them without it.

## v4 (in-flight rework — slot pipeline + view-state)

`runner/src/v4/` is the in-progress replacement for v2/v3. Slot-based pre-compute (5 fixed daily slots + 1 weekly + 2 event slots), Pi single-writer view_state aggregator, Mac→Pi HTTP outbox, browser SSE. v4 coexists with v2/v3 — neither is deleted yet.

Key entry points:
- `runner/src/index.ts` → command `v4-daemon [--tick=60]` starts `startV4Daemon()` (60s tick + chokidar event derivation + SIGINT/SIGTERM shutdown).
- `runner/src/v4/scheduler/daemon.ts` — `SchedulerDaemon.tick()` builds Tier1, decays statuses, picks due slots (topo-sorted by `depends_on`), dispatches each, submits diffs through the outbox.
- `runner/src/v4/scheduler/event-watcher.ts` — pure DB-delta → `BumpEvent` derivation, cursor in `state/v4-event-cursor.json` (separate from v3's `state/event-cursor.json`).
- `runner/src/v4/transport/outbox.ts` — Mac→Pi HTTP POST with CAS retry + disk-backed queue.
- `app/api/ingest/view/[date]/route.ts` — Pi-side ingest. POST `{kind, ...diff}` → `ViewStateWriter.applyX`. 409 on `VersionConflictError`.
- `app/api/view/[date]/route.ts` + `/sse` + `/retry/[slot_id]` — UI read path.
- `lib/view-state/{fetcher,context}.tsx` — SSR loader + `ViewStateProvider` (SSE subscription, `retrySlot()`).
- `components/view/*` + `components/slots/*Body.tsx` — slot rendering layer.

Routing: `defaultViewRoot()` in `runner/src/v4/view-state/writer.ts` resolves view tree as `PULSE_VIEW_ROOT > INSIGHTS_ROOT/view > PULSE_ROOT/insights/view > ./insights/view`.

Hard rules carried over: view_state is **Pi single-writer**; Mac never writes it directly. CAS via `expected_version` field on every diff. Atomic-rename via staging file. No fallback walks across date dirs — `view/<scope>/<key>.json` is canonical.

Working surfaces today:
- `/v4?d=YYYY-MM-DD` — parallel home renders five fixed daily slots end-to-end against a seeded `view_state.json`.
- `GET /api/view/<key>` + `GET /api/view/<key>/sse` + `POST /api/view/<key>/retry/<slot_id>`.

Not yet wired: home page `/` swap, drill page rewrites, post-workout/anomaly_explain bodies, Phase 4 deletes (v2/v3 still live in production until v4 daemon proves stable).

See `docs/wip/V4_MIGRATION.md` for the full phase plan.

## v3 (work in progress)

`runner/src/v3/` is an in-flight rework using a use-case prompt pattern: per-domain prompt-only manifests (no separate format spec), per-item reasoning, self-citing prose. Packagers (`packagers/{recovery,sleep,shared}.ts`), prompts (`prompts/{recovery,sleep,activity,synthesis}.ts`), and JSON Schemas (`schemas/*.schema.json`). Not yet wired into the dashboard. Don't refactor v3 alongside v2 changes unless explicitly asked.

## Path aliases

- `@/*` → repo root (Next.js side).
- `@/runner/*` → `runner/src/*` (only files explicitly listed in root `tsconfig.json` `include`).

## Where to read more

- `docs/COACH_PLAN.md` — daily v2 pipeline detail (stage-by-stage).
- `docs/wip/TODO.md` — phased roadmap.
- `docs/PLAN.md` — UI/IA design language (mostly historical).
- `docs/legacy/COACH_SCHEMAS.md` / `docs/legacy/COACH_PROMPTS.md` — legacy snapshot pipeline.
- `docs/validation-pipeline.md` — 2026-05-08 deployment audit.
- `deploy/README.md` — Mac launchd + Pi systemd + Caddy.
- `docs/gadgetbridge-schema/` — source DB reference.
