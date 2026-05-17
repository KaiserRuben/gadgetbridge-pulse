# Pattern Coverage — long-term insights map

Design memo. Two parallel pattern catalogues for when the DB grows beyond
one day: a **DATA layer** of deterministic queries, and an **LLM layer**
of synthesis-grade reasoning. Reference v2 schema (`docs/legacy/COACH_SCHEMAS.md`)
and Phase 4–6 of `docs/wip/TODO.md`.

Status: design only. No code edits proposed here are wired up.

---

## 1. Executive summary

The three highest-leverage pattern types to ship first:

1. **Sleep regularity index (SRI-lite)** — std dev of bedtime + wake time
   over a 7-night rolling window. Cheap to compute, single number, drives
   immediate action ("you slept on time 4 of 7 nights"). Activates at
   day 7 and improves the `comparison` block on every snapshot/sleep run.
2. **Resting-HR drift slope** — linear regression of `cardio.resting_hr.avg`
   across the trailing 14 days. Single bpm/day number; surfaces overreach
   weeks before the user feels them. Foundation for cardio coaching.
3. **Step-goal streak + weekly volume** — counts consecutive goal-met
   days plus weekly step total vs trailing-4-week mean. Trivial SQL,
   immediately tangible (Apple Watch / Garmin parity), and Heisenberg-
   positive (charts that move behavior in the right direction).

Why these first: each is **100% deterministic**, each crosses the
"day-count threshold" at a different point (1 / 7 / 14), and together they
give the abstraction LLM real `comparison.deltas` to reason about
instead of forcing single-night fabrication.

---

## 2. Pattern catalogue — A (DATA layer, deterministic)

These are pure-math patterns. The query layer computes them; the LLM
consumes the numbers via `comparison.deltas`, `metric_findings.value`, or
new analysis-layer fields. **No model needed.**

| # | Pattern | Metric definition | Min window | Query approach | Output shape | Priority |
|---|---|---|---|---|---|---|
| A1 | **Sleep regularity index** | `1 − stddev(bedtime_min_local) / 60` over N nights, clamped 0..1 | 7 nights | `SELECT BED_TIME % 86400 ...` then JS stddev | `{value: 0.78, n: 7, sd_minutes: 23}` | H |
| A2 | **Sleep-debt accumulation** | `Σ max(0, sleep_goal_min − total_asleep_min)` over trailing 7 days | 3 nights | sum(`SLEEP_GOAL_MPD − asleep`) per day from sleep_stats | `{debt_min_7d: 142, days_under_goal: 4}` | H |
| A3 | **Bedtime drift** | linear regression slope of bedtime-of-day, minutes/day | 14 nights | OLS on `(day_index, bedtime_min)` | `{slope_min_per_day: +12, r2: 0.41}` | M |
| A4 | **RHR drift slope** | OLS slope of daily mean RHR, bpm/day | 14 days | `AVG(RESTING_HEART_RATE) ... GROUP BY date` then OLS | `{slope_bpm_per_day: +0.21, drift_bpm_14d: +2.9}` | H |
| A5 | **HRV baseline + dip events** | rolling 30-day median HRV; flag day if `< 0.85 × median` | 14 days | window function; HUAWEI_HRV_VALUE_SAMPLE | `{baseline_ms: 62, dip_days: ["2026-05-12","..."]}` | H |
| A6 | **HR zone time-in-zone** | minutes per zone, computed against age-predicted HRmax | 1 day (works at any window) | bucket activity HR by zone bands | `{z1: 380, z2: 240, z3: 60, z4: 18, z5: 2}` | H |
| A7 | **Step-goal streak** | consecutive days where `daily_steps ≥ step_goal` | 1 day | running count from `getDaySummary(since,until)` | `{current: 9, longest_30d: 14}` | H |
| A8 | **Weekly step volume vs trailing-4-week mean** | Δ%-change of week sum vs prior-4-week rolling mean | 28 days | week aggregate + 4-week trailing mean | `{this_week: 64210, mean_4w: 58300, pct: +10.1}` | H |
| A9 | **Weekday vs weekend deltas** | mean(weekend) − mean(weekday) for steps, sleep duration, RHR | 14 days (≥4 weekend days) | grouped query by `strftime('%w', date)` | `{steps_delta: -2400, sleep_delta_min: +38, rhr_delta_bpm: -1.2}` | M |
| A10 | **Active-minute consistency** | days hitting active-min target / total days in window | 7 days | per-day count of active minutes ≥ goal | `{hit_rate_pct: 71, days_hit: 5, days: 7}` | M |
| A11 | **Stress diurnal stability** | Pearson r of stress vs hour-of-day across N days; lower r = noisier diurnal | 7 days | hourly mean per day, correlation across days | `{r_hourly: 0.62, days: 7}` | L |
| A12 | **Skin-temp seasonal trend** | OLS of daily mean temp; flag |slope| > 0.05 °C/day sustained 7+ days | 14 days | OLS on daily mean | `{slope_c_per_day: +0.04, baseline_c: 33.8}` | M |
| A13 | **Apnea event clustering** | events/night vs trailing 30-night mean; flag nights ≥ 2σ above | 14 nights | per-night count + rolling mean+sd | `{baseline_per_night: 0.7, flagged_dates: ["..."]}` | M |
| A14 | **Battery cadence anomaly** | charge cycles/day vs trailing-7d median, daily drain rate | 7 days | charge-cycle detection on BATTERY_LEVEL | `{drain_pct_per_h: 0.5, cycles_today: 1, cycles_median: 1}` | L |
| A15 | **Peak-hour HR stability** | std dev of hour-of-peak HR across N days; lower = more routine | 7 days | argmax(hr) per day → std dev | `{peak_hour_sd: 1.4, mode_hour: 11}` | L |
| A16 | **SpO2 desaturation count** | sleep-window samples below 90% per night; rolling 30-night baseline | 7 nights | filter SPO < 90 in BED_TIME..WAKEUP window | `{events_per_night: 0.2, flagged_nights: []}` | M |
| A17 | **Wake-count drift** | daily `WAKE_COUNT` vs personal mean (when not −1 sentinel) | 14 nights | sleep_stats per day | `{mean: 1.9, this_night: 4, z_score: +1.6}` | M |
| A18 | **Sleep-stage architecture stability** | std dev of nightly deep-share% and rem-share% over window | 7 nights | derived shares per night | `{deep_sd_pct: 4.2, rem_sd_pct: 3.1}` | M |
| A19 | **Cross-domain: post-workout RHR recovery** | next-morning RHR delta vs 7-day mean for days with workout markers | 14 days (≥3 workouts) | join workout markers with next-day RHR | `{deltas_bpm: [-1.2, +0.8, ...], mean: -0.3}` | M |
| A20 | **Cross-domain: high-stress → next-night sleep latency** | for days where stress-high% > 30%, compare next-night latency to mean | 14 days (≥3 high-stress days) | filter high-stress days, group next-night latency | `{latency_delta_min: +9.3, n: 4}` | M |

### Notes on A1–A20

- **A1 SRI** is the cheapest high-value win. Every Garmin/Whoop ships a
  variant; we get it for free with two columns and a stddev. Surfaces in
  `comparison.deltas` and a new analysis-layer `regularity_index` field.
- **A4 RHR drift** is the textbook overreach signal. Minimum 14 days;
  needs at least one RHR sample/day (currently sparse — 5 rows on day 1).
  Pre-compute as a derived value and cite it in cardio facts.
- **A5 HRV dip** depends on HRV sample density. Today: 62 HRV rows in
  ~16h. Should be ≥30/day average for stable baseline.
- **A6 HR zone** works at any window length but becomes a "trend" only at
  ≥7 days. Already half-implemented in cardio prompt; needs the SQL
  bucketer.
- **A19/A20** are the only cross-domain ones in this catalogue. Both are
  simple joins on date keys, but they need a **workout markers table**
  (currently `RAW_KIND=2` in HUAWEI_ACTIVITY_SAMPLE; not surfaced).

---

## 3. Pattern catalogue — B (LLM layer, synthesis only)

These need an LLM because the pattern is in the **narrative**, not in
the math. The data layer can pre-compute the inputs (deltas, slopes,
clusters), but the synthesis step writes the hypothesis.

| # | Pattern | When to fire | Facts the prompt consumes | New schema fields | Priority |
|---|---|---|---|---|---|
| B1 | **Behavioral hypothesis from regularity dip** | weekly, when SRI drops > 0.15 from prior week | A1 series, sleep_stats per night, weekday split | `analysis.behavioral_hypotheses[]` (id, evidence_refs, confidence) | H |
| B2 | **Causal narrative for RHR climb** | weekly/monthly, when A4 slope > +0.5 bpm/14d | A4 slope, A20 stress correlation, workout volume, sleep debt | `analysis.causal_narrative` (text + cited_signals[]) | H |
| B3 | **Comparative architecture review** | monthly, on month-roll | this-month sleep facts vs prior-month aggregate | new `comparison.architecture_diff` block | M |
| B4 | **Recommendation followup** | weekly, every Monday | prior-week `next_action` + this-week metric_findings on `targets_metric` | `analysis.action_followups[]` (action_id, moved_pct, verdict) | H |
| B5 | **Anomaly correlation narrative** | weekly+, when A13/A16/A17 fires AND a contemporary stress/temp/travel signal exists | flagged-day list + cross-domain context | `analysis.anomaly_correlations[]` (cluster_id, hypothesis, refs[]) | M |
| B6 | **Travel/disrupted-week narrative** | weekly, when |Δbedtime| > 90 min on ≥3 nights | bedtime series, RHR series, step volume | `analysis.disruption_narrative` (text, recovery_eta) | M |
| B7 | **Seasonal vs personal-trend disambiguation** | monthly+, when A12 trends temp upward | temp slope, ambient/weather (if added), HRV slope | `analysis.confound_assessment` (signal vs ambient) | L |
| B8 | **Sleep architecture → daytime energy hypothesis** | weekly, when REM-share trends down ≥3pp | REM-share series, stress avg, step volume | `analysis.architecture_link` (involved_metrics, hypothesis) | M |
| B9 | **Limiter-clearing narrative** | when a structural limiter clears (e.g. baseline crosses 14 days, RDI starts computing) | `confidence.ceiling_reason` history + new completeness signal | `analysis.limiter_lifted[]` (kind, since_period, impact) | L |
| B10 | **Year-in-review narrative arc** | annually | full year of weekly aggregates + records + milestones | new `narrative_arc` block (chapters[], turning_points[]) | M |
| B11 | **Goal-progress chain** | monthly | step/sleep/active-min goals over month + user-set goal at start | `analysis.goal_chain` (goal_id, baseline, mid, end, verdict) | M |
| B12 | **Holiday/weekend-mode hypothesis** | weekly, when A9 deltas exceed thresholds | weekday/weekend deltas across multiple metrics | `analysis.lifestyle_split` (weekday_profile, weekend_profile, contrast) | L |

### Notes on B1–B12

- **B4 (action followup)** is the most underrated. Today `next_action`
  is fire-and-forget; the LLM never sees whether last week's
  recommendation moved the metric. Adding `analysis.action_followups[]`
  closes the loop and gives the coach feedback signal.
- **B2 (causal narrative)** is the canonical cross-domain reasoning
  task: tie an RHR climb to stress + sleep debt + workout load in one
  paragraph with cited refs.
- **B5 anomaly correlation** is the only B-pattern that should fire
  conditionally on data-layer flags. Wasted tokens otherwise.
- **B7 confounds** is the Heisenberg / weather-confound entry point. If
  we ever import ambient temperature or location, this becomes the
  field where the LLM separates "you're warmer" from "your room is
  warmer".

---

## 4. Schema additions needed

All additive within v2 ("additive only within a major", per
`COACH_SCHEMAS.md §7`).

### 4.1 New analysis-layer block: `comparison` becomes substantive

Today (snapshot): `comparison.available=false, deltas=[]`. At week+
timeframes the same block populates. **No schema diff** — the existing
shape supports it. But baseline sources need an enum extension:

```jsonc
// docs/legacy/COACH_SCHEMAS.md §2.6 — extend baseline_source enum
"baseline_source": null
  | "lifetime"
  | "prior_week"      // already
  | "prior_month"     // already
  | "trailing_7d"     // NEW — for non-aligned rolling windows
  | "trailing_30d"    // NEW
  | "weekday_avg"     // NEW — for weekday-vs-weekend deltas
  | "weekend_avg"     // NEW
```

### 4.2 New analysis-layer field: `regularity_index` (sleep only)

```jsonc
// after metric_findings, before patterns
"regularity_index": {
  "value":      0.78,            // 0..1
  "sd_minutes": 23,              // bedtime stddev minutes
  "window_n":   7,               // nights observed
  "trend":      "stable"         // "improving"|"stable"|"degrading"
}
```

Pattern A1. Cited from `for_weekly_trend`. UI: ring on `/sleep`.

### 4.3 New analysis-layer field: `drift` (cardio + body)

```jsonc
"drift": {
  "metric_id":    "cardio.resting_hr.avg",
  "slope":        0.21,         // bpm/day or °C/day
  "unit":         "bpm/day",
  "window_days":  14,
  "r2":           0.34,
  "direction":    "rising"      // rising|stable|falling
}
```

Pattern A4 (cardio), A12 (body). One drift object per primary metric.

### 4.4 New analysis-layer field: `streaks` (activity + sleep)

```jsonc
"streaks": [
  { "id": "step_goal",    "current": 9,  "longest_30d": 14, "broke_on": null },
  { "id": "sleep_goal",   "current": 0,  "longest_30d": 6,  "broke_on": "2026-05-04" }
]
```

Pattern A7. UI: streak chip in CoachCard headers; full list on `/year`.

### 4.5 New synthesis-only fields (LLM layer)

These are model-filled, schema-validated. They go into the analysis
section between `patterns` and `limiters` (so reasoning stays first):

```jsonc
"behavioral_hypotheses": [        // PATTERN B1
  {
    "id":              "weekend_late_drift",
    "involved_metrics":["stats.bedtime_iso", "regularity_index.value"],
    "description":     "Bedtime drifts 60+ min later on Fri/Sat for 3 weeks running.",
    "supporting_refs": ["A1", "A9"],
    "horizon":         "weeks",                // hours|days|weeks|months
    "actionable":      true
  }
]

"causal_narrative": {             // PATTERN B2 (single object, may be null)
  "headline":          "RHR climbed 3 bpm during a high-stress week.",
  "cited_signals":     ["cardio.resting_hr.avg", "stress.distribution_pct.high", "stats.latency_min"],
  "narrative":         "...",                  // ≤480 chars
  "confidence_modifier": -0.05                 // applied to this prompt's confidence ceiling
}

"action_followups": [             // PATTERN B4
  {
    "prior_period":      "2026-W18",
    "prior_action_id":   "wind_down_22_30",
    "targets_metric":    "stats.latency_min",
    "before_value":      57,
    "after_value":       38,
    "moved_pct":         -33,
    "verdict":           "moved"                // moved|partial|unchanged|regressed
  }
]

"anomaly_correlations": [         // PATTERN B5
  {
    "cluster_id":     "warm_night_apnea",
    "primary_signal": "apnea events/night",
    "co_signals":     ["body.skin_temp.avg_c"],
    "hypothesis":     "Apnea events cluster on nights with skin-temp > 34.5 °C.",
    "n_supporting":   3,
    "n_contrary":     1
  }
]
```

Each obeys the existing `cite every claim` rule via `*_refs` /
`cited_signals` / `involved_metrics` arrays of facts paths.

### 4.6 New `confidence.factors` for week/month/year

Add to `confidence-weights.ts` and `COACH_PROMPTS.md §confidence
catalogue`:

| Factor | Domain | Snapshot? | Week+ |
|---|---|---|---|
| `window_completeness` | all | n/a | days_observed / window_days |
| `baseline_age_days` | all | already | promote to first-class factor |
| `pattern_robustness` | sleep, cardio, body | n/a | 1.0 if r² ≥ 0.5 on cited drifts |
| `cross_domain_links` | coach | n/a | matched_pairs / claimed_correlations |

### 4.7 New `ceiling_reason` enums

```
"insufficient_window"   // <7 days where ≥7 needed
"baseline_too_new"      // <14 days where pattern needs 30
"weekend_only_window"   // 2-day window dominated by weekends
```

---

## 5. Data layer additions needed

### 5.1 New query modules

Inside `lib/queries/`:

- **`trends.ts`** — rolling slope/stddev/streak helpers:
  - `getRollingMean(metric, days)`
  - `getRollingStddev(metric, days)`
  - `getOlsSlope(metric, days)` — returns `{slope, intercept, r2}`
  - `getStreak(predicate, days)` — generic streak counter
  - `getWeekdayWeekendSplit(metric, days)`
- **`sleep_trends.ts`** — pattern-specific:
  - `getSleepRegularityIndex(days)` (A1)
  - `getSleepDebt(days)` (A2)
  - `getBedtimeDrift(days)` (A3)
  - `getStageArchitectureSeries(days)` (A18)
- **`cardio_trends.ts`**:
  - `getRhrDriftSlope(days)` (A4)
  - `getHrvBaseline(days)` (A5)
  - `getZoneMinutesByDay(days)` (A6 over time)
  - `getPeakHourStability(days)` (A15)
- **`body_trends.ts`**:
  - `getSkinTempSlope(days)` (A12)
  - `getSpo2DesaturationCounts(days)` (A16)
- **`activity_trends.ts`**:
  - `getStepGoalStreak()` (A7)
  - `getWeekVolumeDelta()` (A8)
- **`anomaly_trends.ts`**:
  - `getApneaCluster(days)` (A13)
  - `getOverflowRate(days)` — track if firmware quirk persists
- **`derived.ts`** — pre-derive everything the prompt currently asks the
  model to compute (deep_share_pct, hrmax, true_peak_bpm, stress_high_pct).
  Today this lives inline in prompt builders; centralize so trend code
  reuses it.

All sit on top of the existing `since`/`until`-aware queries. Phase 4 of
TODO.md is the prerequisite.

### 5.2 New facts builders

Inside `runner/src/facts/`:

- **`weekFacts.ts`** — 7 days ending on latest synced day. Inputs:
  - per-day mini snapshot (steps, sleep_stats, RHR, HRV avg)
  - aggregate series for plotting
  - pre-computed deltas vs prior 4 weeks
  - workout-marker list
  - regularity index, RHR drift, HRV baseline+dips
- **`monthFacts.ts`** — calendar month, calls weekFacts × ~4 + month-only
  derivations (architecture stability, seasonal trend candidates, top-3
  best/worst nights).
- **`yearFacts.ts`** — daily series for heatmap + monthly aggregates.
  Lower fidelity by design; aim for ≤8 KB facts per year.
- **`lifetimeFacts.ts`** — singleton, recomputed every 7 days:
  - personal baselines (sleep, cardio, body, stress)
  - records (max steps, deepest sleep, longest workout, lowest RHR)
  - milestones (first week of tracking, first PR, first streak ≥7)

### 5.3 Sidecar cache

Phase 4 mentions `Gadgetbridge.db.cache`. Tables to materialize:

```sql
CREATE TABLE daily_summary (
  date TEXT PRIMARY KEY,           -- YYYY-MM-DD wake-date
  steps INTEGER,
  calories_raw INTEGER,
  distance_m REAL,
  active_min INTEGER,
  hr_avg REAL, hr_min INTEGER, hr_max INTEGER,
  rhr_avg REAL, rhr_n INTEGER,
  hrv_avg_ms REAL, hrv_n INTEGER,
  spo2_avg REAL,
  skin_temp_avg_c REAL,
  stress_avg REAL, stress_high_pct REAL,
  sleep_score INTEGER, sleep_total_min INTEGER, latency_min INTEGER,
  efficiency_pct INTEGER, deep_share_pct REAL, rem_share_pct REAL,
  apnea_count INTEGER,
  -- maintenance
  source_mtime INTEGER, last_built_iso TEXT
);

CREATE TABLE weekly_summary  ( week_key TEXT PRIMARY KEY, ... );
CREATE TABLE monthly_summary ( month_key TEXT PRIMARY KEY, ... );
```

`daily_summary` is the join key for every trend query. Build is
incremental: on mtime change, recompute the latest 7 days only (cheap
even at year-scale data).

---

## 6. UI surfaces

| Pattern | Page | Component | Treatment |
|---|---|---|---|
| A1 SRI | `/sleep` | `<RegularityRing>` (new) | RingGauge with sd-minutes label below; sparkline of last 7 SRI values |
| A2 sleep debt | `/sleep`, `/today` hero | `<SleepDebtPill>` (new) | Pill in CoachCard header showing "−2h 22m vs goal (7d)" |
| A3 bedtime drift | `/sleep` | extended `<Hypnogram>` strip | Mini-hypnogram per night for last 7 nights with drift line overlay |
| A4 RHR drift | `/heart` | `<RhrSparkline>` (new) | Sparkline of daily RHR with regression line; bpm/day chip |
| A5 HRV dips | `/heart`, `/heart/hrv` | extend `hrv-scatter.tsx` | Highlight dip days in different color; baseline as dashed line |
| A6 zone time | `/heart` | extend `hr-zones.tsx` | Stack zone bars per day for last 7 days; tap to drill |
| A7 streak | every CoachCard header | `<StreakChip>` (new) | "9-day step streak" chip with flame icon |
| A8 weekly volume | `/activity`, `/trends/week` | `<WeekVolumeDelta>` (new) | "+10% vs 4-wk avg" headline; bar chart |
| A9 weekday/weekend | `/trends/week` | `<WeekendDelta>` (new) | Two-bar comparison (weekday vs weekend) for steps/sleep/RHR |
| A10 active-min consistency | `/activity` | extended `<KpiTile>` | Show hit-rate% in subtitle |
| A11 stress diurnal | `/body` (stress section) | extend `stress-timeline.tsx` | Overlay 7-day mean curve under daily curve |
| A12 skin-temp slope | `/body` | extend `temperature-curve.tsx` | Add regression line + slope-per-day chip |
| A13 apnea cluster | `/sleep`, `/profile` anomalies | extended `<AnomalyRow>` | Dot density indicator on calendar heatmap |
| A14 battery | `/profile` | extended `battery-timeline.tsx` | Drain-rate annotation, charge-cycle markers (already partially planned) |
| A15 peak-hour | `/heart` | nothing (debug only) | Maybe sparkline of peak-hour-of-day; LOW value |
| A16 SpO2 desat | `/sleep`, `/body` | annotation on `spo2-distribution.tsx` | Highlight bins below 90 in warning color |
| A17 wake-count drift | `/sleep` | extended sleep-stats KPIs | Z-score badge on wake count |
| A18 architecture stability | `/sleep`, `/trends/week` | extend `stage-donut.tsx` | Show 7-day variance ring around donut edge |
| A19 post-workout RHR | `/heart`, `/activity` | new `<WorkoutRecoveryTile>` | Small tile after workout cards |
| A20 stress→latency | `/sleep` (Coach) | inline narrative in CoachCard | LLM-narrated, deterministic-flagged |
| B1 hypotheses | every `/[domain]` | `<HypothesisStrip>` (new, in CoachCard expanded section) | Bulleted list of LLM-written hypotheses with cited refs |
| B2 causal narrative | `/coach`, `/heart` weekly | `<CausalNarrativeBlock>` (new) | Paragraph-style; cited signals as inline chips |
| B3 architecture review | `/trends/month` | `<MonthArchitectureDiff>` (new) | Side-by-side donuts + diff bar |
| B4 action followup | `/coach` weekly summary | `<ActionFollowupCard>` (new) | "Last week's wind-down → latency dropped 33%" check/cross indicator |
| B5 anomaly correlations | `/profile` anomalies tab | extend anomaly section | Cluster badges with hypothesis tooltip |
| B6 disruption | `/today`, `/coach` | inline in CoachCard | Banner when active |
| B7 confounds | hidden behind expander | text in confidence-rationale section | Footnote-style |
| B8 architecture link | `/sleep` weekly | `<HypothesisStrip>` | Same surface as B1 |
| B9 limiter lifted | site-wide one-time toast | `<LimiterLiftedToast>` (new) | "RDI now computed for the first time — confidence raised" |
| B10 year arc | `/year` | full-page narrative scrollytelling | Big design lift, year-in-review composer (already in TODO 5) |
| B11 goal chain | `/profile/goals` (new sub-route) | `<GoalProgressChain>` (new) | Three-stop progress bar (start/mid/now) per goal |
| B12 lifestyle split | `/trends/week` | `<WeekdayWeekendNarrative>` (new) | Two persona cards (weekday self vs weekend self) |

---

## 7. Cadence + ordering

Day-count thresholds. Map to TODO.md phases.

| Day count | Activates | Pattern set | TODO mapping |
|---|---|---|---|
| 1 | A6, A7 (current=1), basic stubs | already shipped (snapshot) | Phase 6b done |
| 3 | A2 (rough), A10 (rough) | first weekly snapshot scaffolds | Phase 4 + 6c |
| 7 | A1, A11, A15, A16, A17, A18; B1 (limited), B3 (limited) | week schemas active | Phase 4, 5, 6c |
| 14 | A3, A4, A5, A12, A13, A19, A20; B2, B6, B7 | drift detection live | Phase 4, 5, 6c |
| 28 | A8, A9 (stable); B4, B11 | weekday/weekend deltas robust | Phase 5, 6c |
| 30 | full personal baselines lift `baseline_available` to 1.0; B5 robust | lifetime baseline created | Phase 5, 6c |
| 90 | seasonal trends, monthly comparisons stable | month/year prompts | Phase 6c, 6d |
| 365 | B10 (year arc), records settle | year prompt + composer | Phase 5 (year-in-review), 6c |

**Activation discipline**: each pattern has a `min_window_days` field in
its query module; the runner skips the prompt addendum when window <
min. The LLM doesn't see fields it can't reason about — prevents
fabrication.

---

## 8. Risks

- **False positives on small n**: an OLS slope from 14 noisy points has
  wide CI. Mitigation: require r² ≥ 0.30 before surfacing; otherwise
  emit `pattern_robustness` factor at low score so the model down-weights.
- **Statistical significance unclaimed**: we never compute p-values.
  Risk: confidently-stated drifts that are noise. Mitigation: surface
  r² and n to the prompt, document "directionally suggestive"
  language in shared system prompt.
- **Heisenberg**: showing a step-streak chart causes streaks. Showing a
  sleep-debt accumulator can cause anxiety-driven worse sleep.
  Mitigation: A2/A7 are opt-in via `/profile/goals`, off by default.
  Coach narrative should never call out negative streaks more than once
  per period.
- **Ambient confounders**: skin-temp + weather, RHR + caffeine, HRV +
  alcohol. With only the watch's data we cannot separate signal from
  ambient. B7 (confound assessment) is the LLM's escape hatch, but only
  works if the prompt explicitly admits ambiguity.
- **Sentinel pollution at scale**: today RDI=-1 always, RHR sparse, HRV
  ~62/day. Multiplying by 365 gives meaningful aggregates from
  individually-thin data. Trend functions must include sentinel-aware
  filters (`> 0` or `> sentinel_threshold`) at the SQL level.
- **DST + timezone bugs**: current `+2 hardcoded` will break on Oct
  rollback. Trend functions cannot rely on epoch math for day-keys —
  must use `Intl.DateTimeFormat("Europe/Berlin")` or sidecar's
  `daily_summary.date` text key. Already noted in `lib/insights.ts`.
- **PK ON CONFLICT REPLACE** (per `gadgetbridge-schema/01_activity.md`):
  re-syncing overwrites historical rows. The sidecar `daily_summary`
  must be append-only with a `last_built_iso` so a re-sync re-derives
  the affected days.
- **`facts_hash` invalidation**: every new derived field changes the
  hash. Be deliberate when adding `regularity_index` etc. to facts —
  causes a one-time re-run of every snapshot.
- **Coach-confidence ceiling propagation**: today coach confidence ≤
  inputs avg + 0.10. As week/month/year add layers, the chain compounds.
  Probably fine, but document.

---

## 9. Top-5 first patterns to build

Implementation outline. Each is one full PR's worth.

### 9.1 A7 — Step-goal streak (effort: S, value: H)

- **Query**: `lib/queries/activity_trends.ts → getStepGoalStreak()`.
  Reads `daily_summary` table (or computes inline pre-cache via
  `getDaySummary({ since, until })` × N). Returns `{current,
  longest_30d, broke_on}`.
- **Schema diff**: add `streaks[]` to activity snapshot/week schemas
  (§4.4).
- **UI**: `<StreakChip>` in CoachCard header on `/today` and
  `/activity`; full streak list on `/profile/goals` later.
- **Activation**: day 1.

### 9.2 A1 — Sleep regularity index (effort: M, value: H)

- **Query**: `lib/queries/sleep_trends.ts → getSleepRegularityIndex(7)`.
  Pulls bedtime/wakeup from sleep_stats per night, computes stddev in
  local minutes-of-day, returns `{value, sd_minutes, window_n, trend}`.
- **Schema diff**: add `regularity_index` block to sleep snapshot
  schema (§4.2). Push value into `for_weekly_trend`.
- **UI**: `<RegularityRing>` on `/sleep`; sparkline of trailing 7
  values inside it.
- **Activation**: day 7. Runner skips block when window < 7.

### 9.3 A4 — RHR drift slope (effort: M, value: H)

- **Query**: `lib/queries/cardio_trends.ts → getRhrDriftSlope(14)`. OLS
  on daily mean RHR; returns `{slope, drift_14d, r2, direction}`.
  Requires sidecar `daily_summary` (Phase 4 prerequisite).
- **Schema diff**: add `drift` block to cardio week+ schemas (§4.3).
  Add `pattern_robustness` confidence factor.
- **UI**: `<RhrSparkline>` on `/heart`; "+0.21 bpm/day · 14d" caption.
- **Activation**: day 14. Below that, emit a `limiter` with kind
  `sparse_sampling` referencing window length.

### 9.4 A8 — Weekly step volume vs 4-week mean (effort: S, value: M)

- **Query**: `lib/queries/activity_trends.ts → getWeekVolumeDelta()`.
  Sums current ISO week, compares vs trailing 4-week rolling mean of
  weekly sums. Returns `{this_week, mean_4w, pct, n_weeks}`.
- **Schema diff**: populate `comparison.deltas[]` with `metric_id:
  "activity.steps_total"`, `delta`, `pct`, `period: "trailing_4w"`.
  Extend `baseline_source` enum to include `"trailing_30d"` (close
  enough; 4 weeks ≈ 28d).
- **UI**: `<WeekVolumeDelta>` headline at top of `/trends/week`.
- **Activation**: day 28.

### 9.5 B4 — Action followup (effort: L, value: H)

- **Data prep**: orchestrator reads prior period's `verdict.next_action`
  and the action's `targets_metric`; computes before/after values from
  `daily_summary`; ships into the new prompt as `action_followup_facts`.
- **Schema diff**: add `action_followups[]` to coach week schema
  (§4.5). LLM only writes the `verdict` enum + the narrative wrap; the
  numeric `moved_pct` is runner-stamped (cite or be silent rule).
- **Prompt diff**: new addendum block in `coach.ts` system prompt:
  "Compare prior_action.before_value to after_value; classify as
  moved | partial | unchanged | regressed. Cite both numbers."
- **UI**: `<ActionFollowupCard>` on `/coach` weekly. Check / ⨯ /
  dash icon based on verdict.
- **Activation**: requires ≥2 weeks of coach output.

---

## 10. Implementation ordering recommendation

If we ship in this order, each phase yields a working app:

1. Phase 4 sidecar `daily_summary` table (TODO Phase 4).
2. A7 streak (works at day 1, validates the trend query layer).
3. A1 SRI (first deterministic pattern that needs ≥7 days).
4. A4 RHR drift (first 14-day pattern; introduces `drift` block).
5. A8 weekly volume (first proper `comparison.deltas`).
6. B4 action followup (first LLM pattern that uses comparison signal).
7. Everything else, prioritized by H/M/L in §2 / §3.

By week 4 of multi-day data the first five are live and the LLM has
something real to synthesize on. Before that, snapshot-only mode is
fine; the schema additions are all additive.
