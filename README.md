<div align="center">

# Pulse

**A health-coaching dashboard built around a Gadgetbridge SQLite export.**

A read-only Next.js dashboard reads insights produced by a local-LLM
coach pipeline over phone-synced wearable data.

<br/>

[![Status: Experimental](https://img.shields.io/badge/status-experimental-orange?style=for-the-badge)](#limitations)
[![License: Source-Available](https://img.shields.io/badge/license-source--available-blue?style=for-the-badge)](COPYRIGHT.md)
[![Local-First](https://img.shields.io/badge/data-local--first-success?style=for-the-badge)](#architecture)

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=000)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Node 22](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-qwen3.6-000?style=flat-square&logo=ollama&logoColor=white)](https://ollama.com)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-runner-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)

<br/>

**[Setup](docs/SETUP.md)** · **[Pipeline](docs/COACH_PLAN.md)** · **[Deployment](deploy/README.md)** · **[Schema](docs/gadgetbridge-schema/)** · **[License](COPYRIGHT.md)**

</div>

---

> [!IMPORTANT]
> **Personal reference implementation, source-available.** Published for
> reading and study, not as a turnkey product. See
> [COPYRIGHT.md](COPYRIGHT.md) for usage terms. Building this for
> yourself today requires porting the SQL layer, the LLM prompts, and
> the timezone code.

### Highlights

- **Local-first by design.** Every byte of biometric data stays on your
  hardware. The runner calls Ollama on `localhost`; nothing reaches an
  external API.
- **Deterministic where it counts, LLM where it pays.** Facts + rules +
  verifier are pure code. Prose generation, evidence selection, and
  coaching trajectories are the only LLM-driven stages. A 5-layer
  verifier hard-fails on safety drift before any output reaches the UI.
- **Split deployment baked in.** Mac runs the full stack (runner +
  Ollama + dashboard). Raspberry Pi serves the dashboard read-only over
  Syncthing-replicated JSON insights. The Pi never calls the model.
- **Atomic writes only.** Insights stream through a staging dir then
  atomic-rename into place, so Syncthing never picks half-files even
  mid-write.

### Verified scope

| What | Tested with |
|---|---|
| Watch | Huawei Watch GT 5 Pro (firmware `6.0.0.23(SP10C00M06)`) |
| LLM   | Ollama · `qwen3.6:latest` (batch) + `ministral-3:3b` (interactive) |
| Language | German prompts + UI (output, abstain text, S1 safety strings) |
| Timezone | Europe/Berlin (wake-window math is timezone-coupled) |
| Mac    | Apple Silicon, ≥16 GB RAM (qwen3.6 inference needs ~15 GB free) |
| Pi     | Raspberry Pi 4/5 running Raspbian 12, Node 22 |

---

## What it does

| Surface | What you see |
|---|---|
| `/` (home) | One hero verdict + drivers for the most decision-relevant moment in the last 24 h (post-wake review, midday recovery read, or last workout — picked deterministically). |
| `/day/[date]` | The full daily article: prose summary, per-domain sections, anomaly inbox, "Why?" explanations on demand. |
| `/week/[weekKey]` | Sunday weekly recap over the previous 7 finalised days. |
| `/sleep`, `/recovery`, `/activity`, `/heart`, `/body`, `/stress` | Per-domain drill-downs with the runner's narrative, metric tiles, and chart layer. |
| `/coach` | Per-lever coaching trajectory cards: trend, 90-day projection, single tiny step per week. |
| `/workouts`, `/activities` | Workout / activity log with stitched HR + zones + GPX route if present. |
| `/explore` | Chart playground driven by a typed metric registry; the same chart-spec runtime the LLM emits into. |
| `/nutrition`, `/training` | Per-meal entry + macro/micro tracking; versioned training-plan execution with chat panel. |
| `/log`, `/labs`, `/profile`, `/settings` | Manual entry (journal, feel, weight), experimental toggles, profile/device. |

The runner pipeline runs locally — no insights ever leave the host. The
Pi dashboard serves the resulting JSON statically; only on-demand routes
(`/api/explain-anomaly`, `/api/ingest-screenshot`) call back to Ollama.

---

## Architecture

```
[Phone] Gadgetbridge auto-exports Gadgetbridge.db
                       │
                    Syncthing
                       │
                       ▼
[Mac] coach runner (Docker)
        • daily-watch        — fires on DB mtime change.
                                Stages 0 + 1 only (facts + rules + alarms).
                                No LLM, no daily.json. Cheap, ~2 s.
        • daily-finalize-loop — every 5 min scans the last N days for
                                day-complete periods that lack `_complete`.
                                Runs the full 7-stage v2 pipeline.
                                Calls Ollama on the Mac host.
                       │
                    Syncthing
                       │
                       ▼
[Pi]  Next.js standalone (systemd or docker)
       Serves /, /day, /sleep, /activity, /heart, /body, /stress,
              /coach, /workouts, /alarms, /labs, /log, /profile,
              /explore, /nutrition, /training.
       Reads JSON insights as static files. Never calls the model.
```

Single-machine variant (no Pi) collapses both rows onto the Mac — see
[docs/SETUP.md](docs/SETUP.md).

---

## Prerequisites

**Hardware:**
- A wearable supported by [Gadgetbridge](https://gadgetbridge.org) (tested:
  Huawei Watch GT 5 Pro).
- Android phone running Gadgetbridge.
- Mac (Apple Silicon recommended). ≥16 GB RAM, ≥30 GB free disk for the
  runner container + Ollama model.
- *(Optional)* Raspberry Pi 4/5 or any always-on Linux box for the
  read-only dashboard split.

**Software, on the Mac:**
- Node 22+
- Docker Desktop (Apple Silicon image)
- [Ollama](https://ollama.com), with these models pulled:
  ```bash
  ollama pull qwen3.6:latest      # batch pipeline (default $COACH_MODEL)
  ollama pull ministral-3:3b      # on-demand chart / chat panel
  ```
- Syncthing (if using the Pi split)

**Software, on the phone:**
- [Gadgetbridge](https://gadgetbridge.org) paired with your watch.
- Enable **Settings → Data management → Auto-export** to a Syncthing-watched
  folder.

---

## Setup

See [docs/SETUP.md](docs/SETUP.md) for the full linear walkthrough
covering single-machine + two-machine variants, env-var configuration,
first-run + backfill, and deployment as launchd / systemd.

Minimal cheat-sheet:

```bash
git clone <this-repo> pulse
cd pulse

# 1. install dashboard deps
npm install

# 2. install runner deps
cd runner && npm install && cd ..

# 3. point at your data root
export PULSE_ROOT="$HOME/pulse"        # wherever your Gadgetbridge.db lives
mkdir -p "$PULSE_ROOT"
cp /path/to/Gadgetbridge.db "$PULSE_ROOT/Gadgetbridge.db"

# 4. start Ollama (on the Mac)
ollama serve &

# 5. first run — backfill last 30 days
cd runner
npx tsx src/index.ts backfill --days=30

# 6. start the dashboard
cd ..
npm run dev
# → http://localhost:3030
```

For production: the runner runs as a Docker service via launchd on the
Mac; the dashboard runs as a systemd service on the Pi. Templates under
`deploy/*.template`.

---

## Daily commands

```bash
# Dashboard
npm run dev               # localhost:3030, hot reload
npm run build && npm start  # standalone production build
npm run typecheck
npm run gen:types         # regenerate lib/types/generated.d.ts

# Runner (from runner/)
npx tsx src/index.ts daily                    # full v2 pipeline, latest day
npx tsx src/index.ts daily --date=2026-01-15  # specific day
npx tsx src/index.ts daily --dry-run          # no writes
npx tsx src/index.ts daily --force            # bypass _complete sentinel
npx tsx src/index.ts daily-watch              # live: stage 0/1 only, mtime-driven
npx tsx src/index.ts daily-finalize           # one-shot finalise newest complete day
npx tsx src/index.ts daily-finalize-loop      # long-running, --lookback N days
npx tsx src/index.ts backfill --days=30       # rerun missing days
npm run test                                  # vitest run
```

---

## Repo layout

```
pulse/
├── README.md                this file
├── COPYRIGHT.md             usage terms
├── CLAUDE.md                hard rules for anyone (human or AI) editing here
├── docs/                    design + reference docs (see "Read next")
├── deploy/                  systemd + launchd templates + Caddy + build scripts
├── public/                  PWA shell, icons, service worker
│
├── app/                     Next.js App Router
│   ├── (app)/               authenticated dashboard shell
│   │   ├── (home)/                  landing
│   │   ├── day/[date]/              day detail
│   │   ├── week/[weekKey]/          weekly recap
│   │   ├── sleep|activity|heart|body|stress/[date]/  domain pages
│   │   ├── coach/                   trajectory cards
│   │   ├── workouts|activities/     session log
│   │   ├── alarms|labs|log|profile|settings/
│   │   ├── explore/[metric]/        chart playground
│   │   └── nutrition|training/      newer feature surfaces
│   ├── api/                 server-only endpoints
│   └── globals.css          Tailwind v4 tokens
├── components/              ui, charts, coach, domain, log, nav, …
├── lib/                     db, queries, types, formats, insights, state-io
│
└── runner/                  coach runner (Mac-only)
    ├── docker-compose.yml   two services: daily-watch + daily-finalize
    ├── Dockerfile           node:22-alpine + sqlite-dev + python build deps
    └── src/
        ├── index.ts                 CLI entry
        ├── v2-orchestrator.ts       daily v2 pipeline (stages 0..7 + W)
        ├── config.ts / period.ts / db.ts / ollama.ts
        ├── facts/                   stage 0 — per-day fact builder
        ├── rules/                   stage 1 — deterministic S1/S2/S3 observations
        ├── stages/                  stage 2-7 + W (retrieval → write)
        ├── analyzer/                stage 5 — coaching levers + surprise + pattern
        ├── prompts/                 daily.ts (v2) + snapshot/* (legacy) + weekly.ts
        ├── schemas/v2|snapshot|nutrition|training/    JSON Schemas
        ├── ingest/                  Mac → Pi outbox client
        ├── events/                  bus + cluster-aware subscribers (v3)
        ├── scheduler/               watch trigger + finalize poll
        ├── v3/                      WIP use-case prompt pattern
        └── test/                    probe + drift fixtures
```

Source DB + generated insights live **outside** the repo so Syncthing can
sync data independently of code:

```
$PULSE_ROOT/
├── Gadgetbridge.db                 source, written by phone (read-only here)
├── pulse.db                        sidecar (journal, feel, manual log,
│                                   pattern library, user attribute overrides)
├── insights/
│   ├── daily/<YYYY-MM-DD>/
│   │   ├── _facts.json             rewritten on every watch tick
│   │   ├── _facts_locked.json      frozen for the verifier at finalize time
│   │   ├── _bundle.json            stage records + timings + pipeline status
│   │   ├── daily.json              final v2 insight (only after `_complete`)
│   │   └── _complete               sentinel — full pipeline finalised
│   ├── weekly/<YYYY>-W<WW>/weekly.json
│   ├── alarms/<YYYY-MM>/alarms.json
│   ├── coaching_cache/<isoWeek>/<lever>/<hash>.json
│   └── snapshot/<YYYY-MM-DD>/<domain>.json   legacy
└── state/
    ├── pause.json
    ├── labs.json
    └── alarm_state.json
```

---

## Environment variables

All resolution is env-driven, no hardcoded paths:

| Variable | Default | Purpose |
|---|---|---|
| `PULSE_ROOT` | `./pulse` | Root for `Gadgetbridge.db`, `pulse.db`, `insights/`, `state/` |
| `GADGETBRIDGE_DB_PATH` | `$PULSE_ROOT/Gadgetbridge.db` | Override the read-only source DB |
| `PULSE_DB_PATH` | `$PULSE_ROOT/pulse.db` | Override the writable sidecar |
| `INSIGHTS_ROOT` | `$PULSE_ROOT/insights` | Override insight output tree |
| `STATE_ROOT` | `$PULSE_ROOT/state` | Override state JSON dir |
| `ALARMS_ROOT` | `$PULSE_ROOT/insights/alarms` | Override append-only alarm log dir |
| `PULSE_STAGING_ROOT` | `/tmp/pulse-staging` | Atomic-write staging directory |
| `OLLAMA_URL` | `http://localhost:11434` | Where the runner reaches Ollama |
| `COACH_MODEL` | `qwen3.6:latest` | Batch-pipeline model |
| `INGEST_TOKEN` | *(required for Mac→Pi)* | Bearer token guarding `/api/ingest/*` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | *(required for push)* | Web Push keypair |

Web Push keys are generated once with `npx web-push generate-vapid-keys
--json`.

---

## How the pipeline works

The daily v2 pipeline runs in 7 stages plus a weekly recap. Stages 0, 1,
6, and 7 are deterministic (no LLM); stages 2, 3, 4, 5, and W are LLM-
backed but each call is narrow and structured-output. The verifier
hard-fails on S1 safety drift and the prose summary gets replaced by a
deterministic stub before write rather than relativised.

See [docs/COACH_PLAN.md](docs/COACH_PLAN.md) for the stage-by-stage
detail.

---

## Operating rules

Hard facts every contributor (human or AI) needs to internalise. These
are repeated in [CLAUDE.md](CLAUDE.md) for tool-side enforcement.

- **`Gadgetbridge.db` is read-only.** Every write goes to `pulse.db` or
  to JSON files under `insights/` / `state/`.
- **`pulse.db` is single-writer** (Pi in the current topology). Mac
  pushes through `/api/ingest/*` over HTTP. Never co-write from both
  hosts — Syncthing silently corrupts SQLite under bidirectional writes.
- **Atomic writes only.** Insights stream through `$PULSE_STAGING_ROOT`
  and atomic-rename into `$INSIGHTS_ROOT`. Use the `output.ts` writer;
  never `fs.writeFile` directly into the insight tree.
- **`_complete` is the source of truth.** The finalize loop checks
  `isDailyFinalised(periodKey)` and skips finalised days. Re-runs of
  `runDaily` exit early unless `--force`. `daily-watch` must never
  write the sentinel.
- **S1 safety observations have locked language.** Stage 4 paraphrases
  but cannot relativise. Stage 6 hard-fails on S1 drift and replaces
  the prose summary with a deterministic stub. `bundle.pipeline_status`
  flips to `partial`.
- **Anomaly threshold ladder:** singleton suppressed → ≥2 info → ≥3
  warn → ≥10 critical.
- **"Today" = wake-date local** (Europe/Berlin, prev-day 18:00 →
  this-day 12:00 sleep window). Use `period.ts` helpers, never raw
  `new Date()`.
- **Huawei encoding quirks:**
  - Sleep stage codes: `1` light · `2` REM · `3` deep · `4` awake
  - HR signed-byte overflow: real value = `256 + raw` when
    `raw < 0` and `raw !== -1`
  - `HUAWEI_ACTIVITY_SAMPLE.CALORIES` is firmware-scaled — divide by
    1000 for active kcal; BMR not included
  - `HUAWEI_ACTIVITY_SAMPLE.DISTANCE` is **metres** on the GT 5 Pro
    (verified against workout-summary km). Do not apply a `/100`
    divisor.

---

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · motion · Recharts ·
react-leaflet · better-sqlite3 · undici · ajv · chokidar · zod · Radix
primitives · next-themes · web-push · vitest · Ollama (qwen3.6,
ministral-3).

---

## Limitations

- **Watch lock-in.** The runner's facts/rules layer assumes the
  `HUAWEI_*` table family. Other watches (Mi Band, Fitbit, Polar,
  Garmin) export different Gadgetbridge schemas and would need a
  re-implementation of `runner/src/facts/queries/*`.
- **German output only.** Every prompt + the Stage 6 critic + the
  abstain text is German. Switching languages is a prompt-suite rewrite
  + verifier re-validation, not a config flag.
- **Europe/Berlin assumed.** Wake-window logic + ~26 files use the
  fixed timezone. A user in a different timezone needs `runner/src/
  period.ts` adjusted before insights make sense.
- **Single user.** Schemas + paths assume one user. `USER_ID = 1`
  hardcoded in several queries.
- **Mac-only runner today.** The runner image targets `linux/arm64`
  (Apple Silicon). Linux/AMD64 builds work but haven't been validated
  for Ollama throughput.

---

## Read next

- [docs/SETUP.md](docs/SETUP.md) — linear setup walkthrough
- [docs/COACH_PLAN.md](docs/COACH_PLAN.md) — daily v2 pipeline detail
- [deploy/README.md](deploy/README.md) — launchd / systemd / Caddy
- [docs/gadgetbridge-schema/](docs/gadgetbridge-schema/) — DB schema
  reference (per-domain)
- [docs/PLAN.md](docs/PLAN.md) — UI / IA design language
- [CLAUDE.md](CLAUDE.md) — repository constraints + invariants

---

## License

See [COPYRIGHT.md](COPYRIGHT.md). All rights reserved; source-available
for reading and study, no use rights granted by default.
