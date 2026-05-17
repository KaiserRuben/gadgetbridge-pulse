# Coach insights — pipeline overview

Two pipelines run side by side today:

- **Daily v2** — primary, sentinel-gated, 7 stages + weekly + analyzer.
  Implementation: `runner/src/v2-orchestrator.ts` driving
  `runner/src/stages/stage{1..7,W}.ts` and `runner/src/analyzer/*`.
- **Snapshot** (legacy) — per-domain prompt grid, ships
  `insights/snapshot/<date>/<domain>.json`. Still wired (`tsx src/index.ts
  snapshot`) but no longer the source of the dashboard's daily verdict.
  Schemas/prompts: `docs/COACH_SCHEMAS.md`, `docs/COACH_PROMPTS.md`.

This doc covers the daily v2 pipeline.

## Pipeline (daily v2)

```
[Phone] Gadgetbridge.db   ── Syncthing ──▶  $PULSE_ROOT
                                              │
                                              ▼
[Mac] runner — two docker-compose services
        ┌───────────────────────────────────────────────────┐
        │ daily-watch (chokidar on DB mtime, 2s debounce)   │
        │   Stage 0  facts/daily.ts (deterministic SQL)     │
        │   Stage 1  rules engine → S1/S2/S3 observations   │
        │   alarms   persistAlarms() → insights/alarms/…    │
        │   write    _facts.json + _bundle.json (no LLM)    │
        └───────────────────────────────────────────────────┘
        ┌───────────────────────────────────────────────────┐
        │ daily-finalize-loop (every 5 min, 7d lookback)    │
        │   guard   skip if _complete sentinel exists       │
        │   guard   skip in-progress day unless --force     │
        │   Stage 0  facts (re-run, locked snapshot)        │
        │   Stage 1  rules                                  │
        │   abstain  if rules.abstain → deterministic DE    │
        │   Stage 2  retrieval (k-NN similar days, k=3)     │
        │   Stage 3  evidence picker  (LLM, free-form JSON) │
        │   Stage 4  prose draft      (LLM, structured)     │
        │             ↻ regen ×2 on semantic violations     │
        │             ↻ S1 stub fallback after exhaustion   │
        │   alarms   persistAlarms() → state update         │
        │   Stage 5  coaching trajectory cards (per lever,  │
        │             cached by hash(lever|inputs|prompt))  │
        │   Stage 5b surprise ranking + pattern detect/name │
        │   Stage 6  verify (5-layer gate, S1 critical)     │
        │   Stage 7  atomic write daily.json + _bundle.json │
        │             + _complete sentinel                  │
        │   Stage W  weekly recap on Sundays / on-demand    │
        └───────────────────────────────────────────────────┘
                                              │
                                           Syncthing
                                              │
                                              ▼
[Pi] Next.js reads insights/* (and pulse.db read-only).
     Dashboard renders three states per day:
       • _facts present, no daily.json → "wird heute Nacht berechnet"
       • daily.json + _complete         → finalised insight
       • verify partial / abstained     → degraded card with reason
```

LLM runs ONLY on Mac. Pi never calls the model. Latency on Mac is fine —
inference of minutes per call is acceptable; the finalize loop is a single
serialised run per tick on a single GPU.

## Stages

| Stage  | File                                  | LLM | Critical | Output                             |
|--------|---------------------------------------|-----|----------|------------------------------------|
| 0      | `facts/daily.ts`                      | no  | yes      | `FactsBundleV2`                    |
| 1      | `stages/stage1-rules.ts`              | no  | yes      | typed `Observation[]` + abstain    |
| 2      | `stages/stage2-retrieval.ts`          | no  | yes      | top-k similar days                 |
| 3      | `stages/stage3-evidence.ts`           | yes | yes      | picked evidence per driver         |
| 4      | `stages/stage4-prose.ts`              | yes | yes      | German prose, structured output    |
| (4 regen) | re-run with feedback block         | yes | —        | up to 2 attempts; stub fallback    |
| 5      | `analyzer/coaching-trajectory.ts`     | yes | no       | `CoachingCard[]`, hash-cached      |
| 5b     | `analyzer/surprise-ranking.ts` +      | yes | no       | top-5 surprise insights +          |
|        | `analyzer/pattern-{detection,naming,library}.ts` | | |  cluster naming → pattern library  |
| 6      | `stages/stage6-verify.ts` (+ stage6-paired-grounding) | no | yes | 5-layer gate result |
| 7      | `stages/stage7-write.ts`              | no  | yes      | atomic write of daily/bundle/facts |
| W      | `stages/stageW-weekly.ts`             | yes | no       | `weekly.json` per ISO week         |

Stage 6 layers (semantic + numeric + S1 protection); see
`stage6-verify.ts` for the layer registry. Only S1-related layers are
`critical: true` — when any critical layer fails, `bundle.pipeline_status`
flips to `partial` and the prose summary is replaced by a deterministic
S1 stub before write.

## Layout on disk

```
$PULSE_ROOT/insights/
├── daily/<YYYY-MM-DD>/
│   ├── _facts.json              live, rewritten on every watch tick
│   ├── _facts_locked.json       facts snapshot frozen for the verifier
│   ├── _bundle.json             run trace: stages, timings, status
│   ├── daily.json               final v2 insight (only after _complete)
│   └── _complete                sentinel; finalised_at + run_id
├── weekly/<YYYY>-W<WW>/
│   └── weekly.json
├── alarms/<YYYY-MM>/
│   └── alarms.json              append-only event log
├── coaching_cache/<isoWeek>/<lever>/<hash>.json   per-card cache
└── snapshot/<YYYY-MM-DD>/<domain>.json            legacy snapshot pipeline
```

`_complete` is the source-of-truth flag. The finalize loop reads it via
`isDailyFinalised(periodKey)` to skip already-shipped days; `daily-watch`
never writes it.

State files are bidirectional (`state/`):

```
$PULSE_ROOT/state/
├── pause.json          i_feel_fine override + paused-domain flags
├── labs.json           experimental-feature toggles
└── alarm_state.json    snooze/dismiss/mute counts; written by Mac runner
```

## Schemas

JSON Schemas live in `runner/src/schemas/v2/` and are the single source for
TypeScript types in `lib/types/generated.d.ts` (regenerated via
`npm run gen:types`).

| Schema                  | TS type            | Used by                              |
|-------------------------|--------------------|--------------------------------------|
| `facts.schema.json`     | `FactsBundleV2`    | Stage 0 output, Stage 6 verifier     |
| `daily.schema.json`     | `DailyInsightV2`   | Stage 4 prose, Stage 7 write         |
| `weekly.schema.json`    | `WeeklyInsightV2`  | Stage W                              |
| `bundle.schema.json`    | `BundleManifestV2` | every stage records into manifest    |
| `alarms.schema.json`    | `AlarmsV2`         | `output/alarms.ts`                   |
| `alarm-state.schema.json` | `AlarmStateV1`   | state file, mutated by Stage 1 + 7   |
| `pause.schema.json`     | `PauseState`       | bootstrap                            |
| `labs.schema.json`      | `LabsState`        | bootstrap                            |

`daily.schema.json` versions: `daily/v2` (base), `daily/v2.1` (adds
`coaching_cards`), `daily/v2.2` (adds `surprise_insights`). Stage 5/5b
upgrade `schema_version` additively.

## Model

Production: `qwen3.6:latest` via Ollama. `think:false` on every call,
structured output via `format: <JSON schema>`. See `runner/src/config.ts`
for ctx/temperature/num_predict defaults; per-stage overrides live in the
stage modules (e.g. `coaching-trajectory.ts` uses temp=0.4, num_ctx=4096).

Reference: https://docs.ollama.com/capabilities/structured-outputs

## Cadence

- Mac runner watches `Gadgetbridge.db` mtime. Live stages 0/1 + alarms
  fire on every change with a 2s debounce.
- The finalize loop wakes every 5 min (`FINALIZE_INTERVAL_SEC`), looks
  back up to 7 days (`FINALIZE_LOOKBACK_DAYS`), and runs the full
  pipeline for the oldest day that is `isDayComplete && !isDailyFinalised`.
  Single-shot per tick — never queues two LLM runs concurrently.
- Stage W weekly runs whenever a Sunday day finishes its full pipeline,
  or when called with `runWeekly: true`.

## Failure modes

- **Stage 4 semantic violation** → up to 2 regenerations with feedback
  block. After exhaustion, S1-violating summaries are swapped for a
  deterministic stub; non-S1 residuals are logged as a synthetic
  `stage4_residuals` record in the bundle manifest.
- **Stage 5 / 5b / W catastrophic failure** → caught and logged; the daily
  pipeline still ships. Stage 5 falls back to a deterministic per-lever
  stub if both LLM attempts fail.
- **Verify critical fail** → `pipeline_status: "partial"`. Daily.json still
  written with the (possibly S1-stubbed) prose so the dashboard never
  silently swallows safety signal.
- **Ollama unreachable / timeout** → AbortSignal at 60s per call; surfaces
  as a stage failure for non-critical stages, retries via outer regen
  loop for Stage 4.
- **Re-run guard** — finalised days are skipped unless `--force`. Avoids
  the historical bug where `daily-watch` re-fired all LLM stages on every
  DB sync.

## UI integration

Domain pages render a `<CoachCard>` slot at the top. `/coach` composes the
day's headline + drivers + action + the per-lever coaching trajectory
cards. `/week` renders the weekly recap from `weekly.json`. Three render
states per day: _facts-only (pre-finalize), partial (verify failed), full
(`pipeline_status: "ok"`).

Confidence < 0.5 → render greyed out with "low-confidence draft" label.
File missing → "wird heute Nacht berechnet" empty state.
