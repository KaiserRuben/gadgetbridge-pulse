# Pulse — health dashboard over Gadgetbridge

> **Status: personal reference implementation, source-available.**
> Published for reading, not as a turnkey product. Building this for
> yourself today requires porting the SQL layer, the LLM prompts, and
> the timezone code. See [COPYRIGHT.md](COPYRIGHT.md) for usage terms.
>
> **Tested scope:**
> - Watch: **Huawei GT 5 Pro** (firmware `6.0.0.23`). Other watches export
>   different Gadgetbridge schemas; the runner's facts/rules layer assumes
>   the `HUAWEI_*` tables and the GT 5 Pro's distance / calorie scaling.
> - LLM output language: **German only**. All prompts + Stage 6 critic +
>   abstain text are German. Switching languages requires rewriting the
>   prompt suite and re-validating the verifier.
> - Timezone: **Europe/Berlin** hardcoded across ~26 files. Wake-window
>   logic (`prev-day 18:00 → this-day 12:00`) is timezone-coupled.
> - Hardware: Mac runner needs ~15 GB free RAM for qwen3.6 inference;
>   Pi is anything that runs Node 22.

A read-only Next.js dashboard + local-LLM coach pipeline over a Gadgetbridge
SQLite export. Designed for a Mac (full stack) → Pi (read-only viewer) split
deployment over Syncthing.

```
[Phone] Gadgetbridge exports Gadgetbridge.db
                          │
                       Syncthing
                          │
                          ▼
[Mac] runner — two services in docker-compose:
        • daily-watch  — fires on DB mtime change.
                         Runs stage 0/1 only (facts + rules + alarms).
                         No LLM, no daily.json.
        • daily-finalize-loop — polls every 5 min for past days that
                                completed but lack _complete sentinel.
                                Runs full 7-stage v2 pipeline (Ollama).
                          │
                       Syncthing
                          │
                          ▼
[Pi]   Next.js serves /, /day, /sleep, /activity, /heart, /body, /coach,
       /week, /alarms, /labs, /log, /workouts, /activities, /explore, /profile.
       Pi never calls the model. JSON insights are static at serve time.
```

The Pi is read-only by design — Mac owns every write to `pulse.db` and the
insights tree. On-demand LLM routes (`/api/explain-anomaly`,
`/api/ingest-screenshot`) require `OLLAMA_URL` to point at the Mac.

## Repo layout

```
pulse/
├── README.md                          this file
├── docs/                              design docs + audits
│   ├── PLAN.md                        IA + design language
│   ├── TODO.md                        master phased roadmap
│   ├── COACH_PLAN.md                  daily v2 pipeline overview
│   ├── COACH_SCHEMAS.md               snapshot-pipeline schemas (legacy)
│   ├── COACH_PROMPTS.md               snapshot-pipeline prompts (legacy)
│   ├── PATTERN_COVERAGE.md            long-term pattern catalogue (design)
│   ├── v2.1-interaction-map.md        2026-05-08 interaction audit
│   ├── validation-pipeline.md         2026-05-08 deployment audit
│   ├── validation-v2.1.md             2026-05-08 outside review
│   └── gadgetbridge-schema/           Gadgetbridge DB schema reference
│
├── app/                               Next.js App Router
│   ├── (app)/                         shell layout (sidebar/topbar)
│   │   ├── (home)/                    landing
│   │   ├── day/[date]/                day detail view
│   │   ├── week/[weekKey]/            weekly recap
│   │   ├── coach/                     coach trajectories
│   │   ├── sleep/, activity/, heart/, body/, stress/    domain pages
│   │   ├── activities/, workouts/     activity logs
│   │   ├── alarms/, labs/, log/, profile/, explore/
│   ├── api/                           health, alarms, chart, heatmap,
│   │                                  explain-anomaly, ingest-screenshot, …
│   └── globals.css
├── components/                        ui, charts, coach, domain, log, nav, …
├── lib/                               db, queries, types, formats, insights, state-io
├── deploy/                            launchd plist, systemd unit, Caddy snippets
│   ├── pulse.service                  Pi systemd unit
│   ├── pulse-runner.plist  Mac launchd plist
│   ├── pulse-runner.sh                bootstrap helper
│   └── README.md                      deploy notes (3 Caddy flavors etc.)
├── package.json
├── next.config.ts                     output: standalone
├── tsconfig.json                      @/runner/* → ./runner/src/*
├── postcss.config.mjs
│
└── runner/                            coach runner (Mac-only)
    ├── docker-compose.yml             two services: runner + finalize
    ├── Dockerfile                     node:22-alpine + sqlite-dev
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                   CLI: snapshot|watch|daily|daily-watch|
        │                              daily-finalize|daily-finalize-loop|
        │                              backfill|backfill-alarms
        ├── v2-orchestrator.ts         daily v2 pipeline (stages 0..7 + W)
        ├── orchestrator.ts            legacy snapshot orchestrator
        ├── config.ts                  paths, model, env vars
        ├── period.ts                  wake-date, ISO-week, day-complete sentinel
        ├── db.ts                      read-only Gadgetbridge.db handle
        ├── pulse-db.ts                writable sidecar (PULSE_* tables)
        ├── db-writable.ts             writable handle for state mutations
        ├── db-migrate.ts              one-shot migration CLI
        ├── db-migrations.ts           migration registry
        ├── migrate-to-pulse-db.ts     extract PULSE_* tables out of GB.db
        ├── ollama.ts                  undici fetch w/ no-body-progress timeout
        ├── output.ts                  atomic writer + bundle manifest (snapshot)
        ├── output/alarms.ts           append-only alarm log writer
        ├── validate.ts                ajv + confidence math guard (snapshot)
        ├── confidence-weights.ts      per-domain weight tables (snapshot)
        ├── zip-extract.ts             extracts Gadgetbridge.zip → .db
        ├── facts/                     facts builders (daily + snapshot)
        ├── rules/                     deterministic rule engine (S1/S2/S3)
        ├── analyzer/                  levers, coaching cards, surprise+pattern
        ├── stages/                    stage1-rules .. stageW-weekly
        ├── prompts/                   daily.ts (v2) + snapshot/* (legacy)
        ├── schemas/v2/                JSON Schemas for daily v2 outputs
        ├── schemas/snapshot/          JSON Schemas for snapshot prompts
        ├── state/                     pause/labs/alarm-state bootstrap
        └── test/                      probe + drift fixtures
```

Source DB and generated insights live OUTSIDE the repo so Syncthing can sync
them independently. Default root: `~/pulse`.

```
$PULSE_ROOT/
├── Gadgetbridge.db                  source, written by phone (read-only here)
├── pulse.db                         sidecar (manual log, journal, feel,
│                                    pattern library, user attribute overrides)
├── insights/                        runner output, read by Pi
│   ├── daily/<YYYY-MM-DD>/
│   │   ├── _facts.json              live, rewritten on every watch tick
│   │   ├── _facts_locked.json       frozen for the verifier at finalize time
│   │   ├── _bundle.json             stage records + timings + status
│   │   ├── daily.json               final v2 insight (only after _complete)
│   │   └── _complete                sentinel — full pipeline finalised
│   ├── weekly/<YYYY>-W<WW>/
│   │   └── weekly.json
│   ├── alarms/<YYYY-MM>/
│   │   └── alarms.json              append-only
│   ├── coaching_cache/              per-lever JSON, hash-keyed
│   └── snapshot/<YYYY-MM-DD>/<domain>.json    legacy snapshot pipeline
└── state/
    ├── pause.json
    ├── labs.json
    └── alarm_state.json
```

Override via env: `PULSE_ROOT`, `GADGETBRIDGE_DB_PATH`, `PULSE_DB_PATH`,
`INSIGHTS_ROOT`, `STATE_ROOT`, `ALARMS_ROOT`, `OLLAMA_URL`, `COACH_MODEL`,
`PULSE_STAGING_ROOT`.

## Run locally

```bash
# dashboard
cd pulse
npm install
npm run dev               # http://localhost:3030
npm run typecheck
npm run gen:types         # regenerate lib/types/generated.d.ts from runner/src/schemas/

# coach runner
cd runner
npm install

# Daily v2 pipeline (recommended)
npx tsx src/index.ts daily                 # latest day, full pipeline (force=false)
npx tsx src/index.ts daily --date=2026-05-09
npx tsx src/index.ts daily --dry-run
npx tsx src/index.ts daily --force         # bypass day-complete + sentinel guards
npx tsx src/index.ts daily-watch           # live mode (facts + rules + alarms)
npx tsx src/index.ts daily-finalize        # one-shot finalize for newest complete day
npx tsx src/index.ts daily-finalize-loop   # long-running, scans past --lookback days
npx tsx src/index.ts backfill --days=30
npx tsx src/index.ts backfill-alarms --days=30

# Legacy snapshot pipeline (per-domain prompts; still wired for now)
npm run snapshot
npm run snapshot:dry
npm run watch

# Tests
npm run test
npm run typecheck
```

Production runs both runner services in docker-compose:

```bash
cd runner
docker compose up -d        # gadgetbridge-runner + gadgetbridge-finalize
docker compose logs -f
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · motion · Recharts ·
better-sqlite3 · undici · ajv · chokidar · Ollama (qwen3.6).

## Read next

- `docs/COACH_PLAN.md` — daily v2 pipeline (7 stages + Stage W weekly)
- `docs/TODO.md` — phased roadmap, what's done, what's next
- `docs/PLAN.md` — UI/IA design language (mostly historical)
- `deploy/README.md` — Mac launchd + Pi systemd + Caddy
- `docs/validation-pipeline.md` — 2026-05-08 deployment audit (still mostly current)

## Operating reminders

- `Gadgetbridge.db` is read-only. All writes go to `pulse.db` (sidecar) or
  insights/state JSON files.
- `pulse.db` is single-writer: Mac owns it. Pi must run with the Mac DB
  treated as read-only or routed through a Mac-side write endpoint —
  Syncthing will silently corrupt SQLite under bidirectional writes.
- Insights written via `/tmp/pulse-staging` → atomic rename so Syncthing
  never picks half-files.
- The day-complete `_complete` sentinel gates the full LLM pipeline. Once
  finalised, re-runs of `runDaily(periodKey)` exit early unless `--force`.
- S1 safety observations have locked language; the prose stage paraphrases
  but cannot relativise. Stage 6 verifier hard-fails on S1 violations.
- Anomaly threshold ladder: singleton suppressed → ≥2 info → ≥3 warn → ≥10 critical.
- "Today" = wake-date local (Europe/Berlin, prev-day 18:00 → this-day 12:00 sleep window).
- Stage codes: 1 light · 2 REM · 3 deep · 4 awake.
- HR signed-byte overflow: real value = 256 + raw when raw < 0 ≠ −1.
- Calorie counter = firmware unit, not kcal. Distance ×100 (cm).
