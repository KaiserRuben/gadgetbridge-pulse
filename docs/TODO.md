# Master roadmap

Living plan. Reset 2026-05-10 against actual code in `app/(app)/` and
`runner/src/`. Older versions referenced routes that never shipped or that
were superseded by the daily v2 pipeline; those items have been dropped or
re-cast as honest `[ ]` entries.

## Legend

- `[ ]` not started · `[~]` in progress · `[x]` done
- Priority: H (must), M (should), L (nice)
- Effort: S (<1h), M (half-day), L (1+ day)

---

## Phase 0 — Deploy basics

Goal: app survives Syncthing replacing the DB and runs on Mac (full) +
Pi (read-only viewer).

- [x] H · M — `lib/db.ts` mtime hot-reload (close + reopen on change, bust caches).
- [x] H · S — `next.config.ts` `output: "standalone"` for slim Pi runtime.
- [x] H · S — Bind to `0.0.0.0`. mDNS `pulse.local`. (`deploy/pulse.service`)
- [x] M · S — `systemd` unit `deploy/pulse.service`.
- [x] M · S — `/api/health` (DB readable + last mtime).
- [x] L · M — Caddy snippets (HTTP / Tailscale TLS / Let's Encrypt) — `deploy/README.md`.
- [x] H · M — Mac launchd plist `deploy/pulse-runner.plist` watching DB mtime.
- [x] H · M — Two-service docker-compose for runner: `daily-watch` + `daily-finalize-loop` (`runner/docker-compose.yml`).
- [ ] H · S — Pi `pulse.service` Environment block: export `PULSE_DB_PATH`, `PULSE_READONLY=1`, `OLLAMA_URL=http://<mac>:11434`. (See `validation-pipeline.md` §3.)
- [ ] H · M — Single-writer policy for `pulse.db` across hosts (Pi read-only OR Mac-side write endpoint via Tailscale). Bidirectional Syncthing on SQLite corrupts WAL.
- [ ] M · S — `runner/src/db-migrate.ts:15` opens **Gadgetbridge.db** writable instead of `pulse.db`. Footgun — fix path.
- [ ] M · S — Pi memory headroom: add `Environment="NODE_OPTIONS=--max-old-space-size=384"` to `pulse.service`.

## Phase 1 — Anomaly + drill-down

- [x] H · S — `KpiTile` href prop; tiles deep-link.
- [x] H · M — Anomaly + data-note rows deep-link to source page anchors.
- [x] H · M — Profile alarms tile expanded to inline list.
- [x] H · M — Stress bucket rows on `/body` push `?stress=high` URL state.
- [ ] H · L — Stage donut click on `/sleep` filters hypnogram + HR-during-sleep. URL state `?stage=deep`.
- [x] M · M — Hypnogram block click → anchor scroll (`#stage-N`).
- [ ] M · L — Apnea event row click → in-page HR/SpO₂ chart zoom ±5 min.
- [x] L · S — Calendar count tile expands to sync log.
- [x] L · S — Battery cycle markers (ReferenceArea + ReferenceDot).

## Phase 2 — UI polish

- [x] H · S — Recharts tooltip fix (no `contentStyle` overrides).
- [x] H · M — Shared `<ChartTooltip>` (rounded-12, border, blur, mono labels).
- [x] H · M — `loading.tsx` per route with shimmer skeletons.
- [x] H · M — RingGauge polish (drop-shadow glow + breathing pulse + 1.4s NumberTicker).
- [ ] H · M — Hypnogram: merge consecutive same-stage runs; hover scrub line; round only first/last block.
- [ ] M · M — `<RouteBackdrop>` per-route accent blob, crossfade on path change.
- [x] M · S — Direction-aware page transition (`x ±16` based on NAV index, 0.24 s).
- [x] M · S — Mobile nav: `safe-area-inset-bottom`, active tinted glow, `size-11` hits.
- [x] M · M — Shared `<AnomalyRow>` + status-dot.
- [x] M · S — `<Area>`/`<Line>` `strokeLinecap="round"`. Grid opacity 0.5 → 0.35.

## Phase 3 — Polish micro-fixes

- [x] M · S — `--color-text-subtle` 46% → 52% (WCAG AA).
- [x] M · S — Stress timeline: only `activeDot`.
- [x] M · S — Heatmap stagger per-column.
- [ ] M · S — Eyebrow type token (10 px or 11 px + tracking 0.18 em).
- [ ] L · S — Icon stroke-width policy (1.75 surface, 2 status). Sweep + fix.
- [ ] L · S — KPI tile: drop hover lift on non-interactive.
- [ ] L · S — Topbar scroll progress + pulsing sync dot.
- [x] L · S — Sidebar: `focus-visible:ring`, left-edge accent on active.
- [x] L · M — Empty state: dot-grid pattern bg + floating icon.

## Phase 4 — Time-aware data layer

- [x] H · L — `since`/`until` on every `lib/queries/*` query. DST-aware bucketing.
- [x] H · M — `getAvailableDays()` + `loadAllInsightsForDay()` + `getTrendRows()` in `lib/insights.ts`.
- [x] M · M — `<DateStrip>` + `<DatePicker>` topbar nav. `?date=YYYY-MM-DD` URL state.
- [x] M · M — Page-level `?date=` honoured by `/sleep`, `/activity`, `/heart`, `/body`, `/stress` via `[date]` segment.
- [x] M · M — Wake-date semantics (`localDateKey` + `sleepWindowForDate`, Europe/Berlin, prev-day 18:00 → this-day 12:00).
- [ ] L · L — Sidecar SQLite cache. Skipped — SQL aggregation is microseconds at current scale.

## Phase 5 — Long-range views

The original P5 plan called for `/trends` and `/year` routes. Neither
shipped; `/week` + `/coach` cover the long-range surface today via Stage W
weekly recaps and per-lever coaching trajectories.

- [x] H · L — `/week` + `/week/[weekKey]` rendered from `weekly.json` (Stage W).
- [x] H · M — `/coach` overview composes per-lever trajectory cards (Stage 5 output).
- [x] M · M — Comparison chip ("+3 vs prev day") on cards via optional `prev` prop.
- [ ] M · L — `/trends` route (per-domain score line + streaks + records). Open.
- [ ] L · L — `/year` route (full year heatmap + season + quarterly + records). Open.
- [ ] M · M — Streaks card (best score-≥70 run per domain).
- [ ] M · M — Personal records (best score per domain, click-through to that day).
- [ ] L · L — Year-in-review long-form composer — defer until full year of data.

## Phase 6 — Coach pipeline (Mac-side LLM)

### 6a — Snapshot pipeline (legacy, still wired)

- [x] H · M — `runner/` package, ESM, tsconfig.
- [x] H · M — `runner/src/facts/snapshot.ts` builder.
- [x] H · M — `runner/src/ollama.ts` POST `/api/chat` w/ `format` + retries.
- [x] H · S — `runner/src/output.ts` atomic tmp+rename writer.
- [x] H · M — `runner/src/index.ts` chokidar watch + debounced re-run.
- [x] H · M — `runner/src/confidence-weights.ts` per-domain weight tables.
- [x] H · M — `runner/src/validate.ts` ajv + confidence math guard (Σ w·s vs reported, ±0.10).
- [x] H · M — Domain prompts: sleep, cardio, activity, body, stress, anomalies, coach (`runner/src/prompts/snapshot/*.ts`).
- [ ] L · M — `prompts/snapshot/dashboard.ts` — skipped, `/coach` aggregates deterministically.

### 6b — Daily v2 pipeline (primary)

Sentinel-gated 7-stage pipeline driving the dashboard's daily verdict.
End-to-end flow in `COACH_PLAN.md`; orchestrator at `runner/src/v2-orchestrator.ts`.

- [x] H · L — `v2-orchestrator.ts` with abstain shortcut, regen-with-feedback loop, day-complete sentinel, re-run guard.
- [x] H · M — Stage 0 facts (`facts/daily.ts`) + Stage 1 rules engine (`stages/stage1-rules.ts` + `rules/*`) — typed `Observation[]` w/ S1/S2/S3 tier.
- [x] H · M — Stage 2 retrieval (k-NN similar days), Stage 3 evidence picker, Stage 4 prose (German, structured output, regen on semantic violation).
- [x] H · M — Stage 5 coaching trajectories (`analyzer/coaching-trajectory.ts` + `levers.ts` + hash cache + validator).
- [x] H · M — Stage 5b surprise ranking + pattern detect/name (`analyzer/surprise-ranking.ts` + `pattern-{detection,naming,library}.ts`).
- [x] H · M — Stage 6 verifier (5 layers; only S1 layers `critical: true`).
- [x] H · M — Stage 7 atomic write via `/tmp/pulse-staging` → rename + `_complete` sentinel.
- [x] H · M — Stage W weekly recap (`stageW-weekly.ts` + `WeeklyInsightV2`).
- [x] H · M — JSON Schemas under `runner/src/schemas/v2/` regenerated into `lib/types/generated.d.ts` via `npm run gen:types`.
- [x] H · S — `backfill` + `backfill-alarms` CLI.
- [x] H · M — Two-service docker-compose: `daily-watch` (live stages 0/1) + `daily-finalize-loop` (5-min poll, full LLM).
- [ ] L · L — Optional month / year stages on top of the v2 facts builders.

### 6c — Coach UI surface

- [x] H · M — `<CoachCard>` + `<CoachTakeaway>` components.
- [x] H · M — `/coach` overview route.
- [x] M · S — Insight muting when `confidence < 0.5`.
- [x] M · S — Empty state when insight file missing.
- [x] M · M — Per-page CoachCard slot at top of each domain page.
- [x] M · M — "Wird heute Nacht berechnet" state for in-progress days (no `daily.json` yet, only `_facts.json`).

## Phase 7 — Telemetry + observability

- [x] M · M — `_bundle.json` per daily run with stage records, timings, pipeline_status, model, run_id (`BundleManifestV2`).
- [ ] M · M — `/coach/status` page reading `_bundle.json` (last run, parse-failure rate, mean confidence).
- [ ] L · S — Slack/email alert when 3 consecutive runs fail or hit critical verifier layers.
- [ ] L · S — Runner Prom metrics endpoint (or write metrics into `_bundle.json` and expose via `/api/health`).

## Phase 8 — On-demand LLM surfaces (Mac-only)

- [x] H · M — `/api/explain-anomaly` "Why?" button (`components/ui/why-button.tsx`).
- [x] H · M — `/api/ingest-screenshot` body-comp OCR + `/api/ingest-screenshot/commit` writeback.
- [ ] H · S — Graceful Pi fallback when Ollama unreachable: HTTP 503 + translated message (currently surfaces ECONNREFUSED).

## Phase 9 — Future ideas (not committed)

- Apple Health / Google Fit import
- Multi-user (family) view
- Export / PDF report (year-in-review)
- VO₂max history page
- Apnea trend if RDI ever computed
- Compare with anonymised cohort (privacy-first)
- LLM Q&A chat ("what stood out this week?") on top of insights bundle
- `/trends` + `/year` full long-range surfaces (see Phase 5)

---

## Operating reminders

- `Gadgetbridge.db` is read-only. Writes go to `pulse.db` or insights/state JSON.
- Insights generated only on Mac. Pi never calls the model.
- Atomic tmp+rename for any file Syncthing might touch.
- The day-complete `_complete` sentinel gates the full LLM pipeline. Re-runs of `runDaily()` skip finalised days unless `--force`.
- Stage 6 verifier hard-fails on S1 violations; Stage 4 swaps the summary for a deterministic stub and `pipeline_status` flips to `partial`.
- S1 prose is locked language — paraphrase, do not relativise.
- Anomaly tiering: singleton suppressed → ≥2 info → ≥3 warn → ≥10 critical.
- Coach can never exceed avg input confidence by more than +0.10.
- "Today" = wake-date local (Europe/Berlin, prev-day 18:00 → this-day 12:00 sleep window).
- Stage codes: 1 light · 2 REM · 3 deep · 4 awake.
- HR signed-byte overflow: real value = 256 + raw when raw < 0 ≠ −1.
- Calorie counter = firmware unit, not kcal. Distance ×100 (cm).
- Snapshot schemas only: process-first JSON ordering, confidence keys last. Daily v2 puts `reasoning_trace` first (chain-of-thought) and lets the schema enforce the rest.
- `pulse.db` is single-writer (Mac). Bidirectional Syncthing on SQLite + WAL/SHM corrupts the file.

## Reference docs

- `COACH_PLAN.md` — daily v2 pipeline (sentinel, 7 stages + W).
- `PLAN.md` — initial design + IA (historical; live IA in `app/(app)/`).
- `COACH_SCHEMAS.md`, `COACH_PROMPTS.md` — snapshot pipeline (legacy).
- `PATTERN_COVERAGE.md` — long-term pattern catalogue (design memo).
- `validation-pipeline.md`, `validation-v2.1.md`, `v2.1-interaction-map.md` — 2026-05-08 audits.
- `gadgetbridge-schema/` — DB schema reference (5 markdown files).
- v2 daily JSON Schemas live in `runner/src/schemas/v2/` (regenerated into `lib/types/generated.d.ts`).
