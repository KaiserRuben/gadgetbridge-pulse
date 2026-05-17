# Coach insights — JSON schemas (snapshot pipeline)

> **Scope note (2026-05-10)** — this document describes the **snapshot
> pipeline** schemas (per-domain prompts: sleep, cardio, activity, body,
> stress, anomalies, coach). The dashboard's primary daily verdict now ships
> through the **daily v2 pipeline** described in `COACH_PLAN.md`; its
> JSON Schemas live in `runner/src/schemas/v2/` (`facts.schema.json`,
> `daily.schema.json`, `weekly.schema.json`, `bundle.schema.json`,
> `alarms.schema.json`, `alarm-state.schema.json`, `pause.schema.json`,
> `labs.schema.json`) and the TS types in `lib/types/generated.d.ts`.
> The snapshot pipeline below is still wired (`tsx src/index.ts snapshot`)
> but is not on the critical path for the daily card.

Single source of truth for every structured-output blob the snapshot runner
writes. Every schema obeys five rules:

1. **Process first, summary last.** Reasoning fields (`observations`,
   `metric_findings`, `patterns`, `limiters`, `evidence`, `comparison`) come
   BEFORE summary fields (`verdict`). The model fills the reasoning chain,
   which informs the summary it commits to last.
2. **Dual-consumer shape.** Output feeds both the dashboard UI (`verdict` +
   `confidence.value`) and the downstream abstraction LLM
   (`metric_findings`, `patterns`, `limiters`, `upward_signals`). Both must
   be load-bearing.
3. **Bounded enums** for any categorical (`vs_norm`, `direction`, `kind`,
   `effort`, `horizon`, `severity`, `ceiling_reason`).
4. **Cite every claim.** Every numeric value carries a `metric_id` /
   `facts_ref` / `metric_path` pointing at a facts blob field.
5. **Envelope is runner-stamped.** The model NEVER emits `version`,
   `domain`, `timeframe`, `period_key`, `data_window`, `generated_at`,
   `model`, `facts_hash`, `duration_ms`. The orchestrator merges them onto
   the validated body before writing.

Property order is enforced via JSON Schema `properties` insertion order +
a strict prompt directive. qwen3.6 fills properties left-to-right.

---

## 1. Top-level shape (after orchestrator stamps envelope)

```jsonc
{
  // ── envelope (runner-filled, top-level flat) ──────────────────────────
  "version":              "1",                    // bumped to "2" once orchestrator owns it
  "domain":               "sleep",                // sleep|cardio|activity|stress|body|anomalies|coach
  "timeframe":            "snapshot",             // snapshot|week|month|year|lifetime
  "period_key":           "2026-05-06",
  "data_window":          { "start_iso": "...", "end_iso": "...", "samples_seen": 524 },
  "generated_at":         "2026-05-06T07:30Z",
  "model":                "qwen3.6:latest",
  "facts_hash":           "sha256:...",
  "duration_ms":          80123,

  // ── analysis layer (model-filled, for downstream LLM consumers) ───────
  "context_summary":      "Single night, 524 stage minutes, no prior nights.",
  "observations":         [ /* OBSERVATION_ITEM × 3..8 */ ],
  "metric_findings":      [ /* METRIC_FINDING × 3..7 */ ],
  "patterns":             [ /* PATTERN × 1..5 */ ],
  "limiters":             [ /* LIMITER_TYPED × 1..5 */ ],
  "evidence":             [ /* EVIDENCE_TYPED × 2..6 */ ],
  "comparison":           { "available": false, "baseline_source": null, "deltas": [] },

  // ── verdict (UI consumer) ─────────────────────────────────────────────
  "verdict": {
    "rating":        "good",
    "score_0_100":   72,
    "headline":      "Consolidated sleep with high deep share, but 57-min onset.",
    "drivers":       [ /* DRIVER_TYPED × 3 */ ],
    "next_action":   { "title": "...", "why": "...", "effort": "low", "horizon": "tonight", "targets_metric": "stats.latency_min" }
  },

  // ── confidence (audit trail) ──────────────────────────────────────────
  "confidence": {
    "value":              0.55,        // 0..1, post-ceiling
    "calc":               0.565,       // Σ weight × score (runner authoritative)
    "math_check_passed":  true,        // runner sets after |value − calc| ≤ 0.10 OR ceiling explained
    "ceiling_reason":     "single_day_window",   // null|single_day_window|sparse_data|sentinel_heavy|new_baseline
    "factors":            [ /* {factor, weight (const), score, rationale} */ ],
    "reasoning":          "Sample density and freshness lift; single-night structural cap pulls back."
  },

  // ── upward signals (abstraction-LLM consumer) ─────────────────────────
  "upward_signals": {
    "tags":              ["sleep_latency_high", "deep_share_high", "single_apnea_event"],
    "for_coach":         [{ "tag": "recovery_lever", "metric_id": "stats.latency_min", "weight": 0.7 }],
    "for_weekly_trend":  [{ "metric_id": "stats.latency_min", "value": 57 }],
    "anomalies_flagged": [{ "id": "deep_pct_artifact", "severity": "info", "details": "facts.stats.deep_pct=93 vs derived 40" }]
  }
}
```

---

## 2. Reusable blocks (schema fragments)

### 2.1 `OBSERVATION_ITEM`

```jsonc
{
  "id":         "stage_split",                   // snake_case slug
  "facts_ref":  "stages",                        // dotted path into facts
  "value":      "L188 R92 D186 W58",             // string or number
  "unit":       "min",                           // "" allowed
  "text":       "Stage minutes: light 188, REM 92, deep 186, awake 58."
}
```

### 2.2 `METRIC_FINDING`

```jsonc
{
  "metric_id":         "stats.latency_min",
  "value":             57,
  "unit":              "min",
  "vs_norm":           "above",                  // below|within|above|sentinel|artifact
  "norm_band":         [0, 20],                  // [low, high]
  "delta_from_norm":   37,                       // signed; omit on sentinel/artifact
  "interpretation":    "57-min onset is ~3× the 20-min adult threshold; suggests late stimulation.",
  "reasoning_trace":   ["healthy <20 min", "observed 57", "ratio 2.85"]   // [] or 2..4 steps
}
```

### 2.3 `PATTERN`

```jsonc
{
  "id":                "high_latency_high_efficiency",
  "involved_metrics":  ["stats.latency_min", "stats.efficiency_pct"],
  "description":       "Long onset combined with consolidated sleep.",
  "hypothesis":        "Pre-sleep arousal, not fragmentation.",       // "" allowed
  "testable_with":     "7 nights of consistent bedtime"               // "" allowed
}
```

### 2.4 `LIMITER_TYPED`

```jsonc
{
  "kind":       "sentinel",                  // sentinel|single_window|artifact|data_gap|sparse_sampling
  "metric_id":  "stats.rdi",                 // null when window-wide
  "text":       "RDI=-1; apnea index not computed."
}
```

### 2.5 `EVIDENCE_TYPED`

```jsonc
{
  "claim_id":    "deep_rem_dominance",
  "text":        "Deep + REM dominant",
  "metric_path": "stages.deep_min + stages.rem_min",
  "value":       "186 + 92 = 278 min (61% of asleep)"
}
```

### 2.6 `COMPARISON_TYPED`

```jsonc
{
  "available":       false,                     // true ONLY when facts.<domain>.baseline non-null
  "baseline_source": null,                      // null|lifetime|prior_week|prior_month
  "deltas":          []                         // [{metric_id, delta, pct?, period}]
}
```

### 2.7 `DRIVER_TYPED`

```jsonc
{
  "metric_id":  "stats.latency_min",
  "name":       "Sleep latency",
  "value":      57,
  "unit":       "min",
  "direction":  "negative"                       // positive|neutral|negative
}
```

### 2.8 `NEXT_ACTION_TYPED`

```jsonc
{
  "title":           "Implement a 22:30 wind-down routine to reduce sleep latency.",
  "why":             "57-min onset is the strongest negative driver; fixing it unlocks more REM.",
  "effort":          "low",                      // low|medium|high
  "horizon":         "tonight",                  // now|today|tonight|tomorrow|this_week
  "targets_metric":  "stats.latency_min"         // facts path the action moves
}
```

### 2.9 `VERDICT`

Composite of rating, score, headline, exactly 3 drivers, and next_action (object or null).

### 2.10 `CONFIDENCE_BLOCK`

```jsonc
{
  "value":              0.55,
  "calc":               0.565,
  "math_check_passed":  true,
  "ceiling_reason":     "single_day_window",
  "factors": [
    { "factor": "sample_size",         "weight": 0.25, "score": 0.85, "rationale": "..." },
    { "factor": "data_quality",        "weight": 0.20, "score": 0.85, "rationale": "..." },
    { "factor": "baseline_available",  "weight": 0.20, "score": 0.0,  "rationale": "..." },
    { "factor": "metric_completeness", "weight": 0.15, "score": 0.6,  "rationale": "..." },
    { "factor": "apnea_index_computed","weight": 0.10, "score": 0.0,  "rationale": "..." },
    { "factor": "freshness",           "weight": 0.10, "score": 1.0,  "rationale": "..." }
  ],
  "reasoning":          "Sample density and freshness lift; single-night and missing baseline cap."
}
```

`weight` is fixed by `runner/src/confidence-weights.ts` and validated as a
constant in the schema. Model fills `score` (0..1, runner rounds to 0.05)
and `rationale` (≤220 chars, ≥20 chars, single decisive sentence). Runner
re-computes `calc` and authoritatively sets `math_check_passed`.

### 2.11 `UPWARD_SIGNALS`

```jsonc
{
  "tags": [
    "sleep_latency_high", "deep_share_high", "single_apnea_event"
  ],
  "for_coach": [
    { "tag": "recovery_lever", "metric_id": "stats.latency_min",     "weight": 0.7 },
    { "tag": "load_signal",    "metric_id": "stats.efficiency_pct", "weight": 0.3 }
  ],
  "for_weekly_trend": [
    { "metric_id": "stats.latency_min",      "value": 57 },
    { "metric_id": "stats.efficiency_pct",   "value": 89 },
    { "metric_id": "derived.deep_share_pct", "value": 40 }
  ],
  "anomalies_flagged": [
    { "id": "deep_pct_artifact", "severity": "info",
      "details": "facts.stats.deep_pct=93 disagrees with derived 40." }
  ]
}
```

`tags` are stable snake_case keys an upstream LLM matches against. Coach
weight goes 0..1; the metric a `next_action` targets gets the highest
weight.

---

## 3. Process-first ordering rule (canonical)

Every domain schema emits properties in this order:

```
1.  context_summary       ← string, 1–2 sentences naming what was measured
2.  observations          ← array of OBSERVATION_ITEM
3.  metric_findings       ← array of METRIC_FINDING
4.  patterns              ← array of PATTERN
5.  limiters              ← array of LIMITER_TYPED
6.  evidence              ← array of EVIDENCE_TYPED
7.  comparison            ← COMPARISON_TYPED
─── verdict ──────────────
8.  verdict               ← VERDICT
─── confidence ───────────
9.  confidence            ← CONFIDENCE_BLOCK
─── upward signals ───────
10. upward_signals        ← UPWARD_SIGNALS
```

Snapshot vs week vs month reuses the same ordering; `comparison` becomes
substantive at longer timeframes (real `deltas` populated).

### 3.1 Confidence rubric

LLMs are bad at producing absolute numbers without scaffolding. We force
the model to score a fixed rubric, weight the factors, then write a
short reasoning sentence, and only then commit to a number. The number
is verifiable (`confidence.value ≈ Σ weight × score`) — the runner
cross-checks and rejects if the gap exceeds 0.10 (forces retry), unless
a `ceiling_reason` is set, in which case `value < calc` is allowed and
the cap is recorded.

`confidence.factors[].weight` is fixed per domain and stored in
`runner/src/confidence-weights.ts`. Only `score` and `rationale` are
model-filled.

### 3.2 Confidence factor catalogue

Universal factors:

| Factor | Scores |
|---|---|
| `sample_size` | Are there enough rows for the timeframe? |
| `data_quality` | Sentinel ratio, dropouts, sensor gaps |
| `baseline_available` | Is a personal baseline present? |
| `metric_completeness` | Are the required metrics non-sentinel? |
| `freshness` | Time between data window end and `generated_at` |

Domain-specific (see `COACH_PROMPTS.md §per-area addendum`):

- sleep: `apnea_index_computed`
- cardio: `hrv_sample_density`, `hr_zone_coverage`
- activity: `step_sentinel_ratio`, `sedentary_block_visibility`
- stress: `sample_density_per_hour`, `coverage_balance`
- body: `temp_sample_density`, `cross_sensor_agreement`
- anomalies: `detection_window_size`, `threshold_clarity`,
  `biological_vs_quality_separation`, `correlation_evidence`
- coach: `inputs_completeness`, `inputs_confidence_avg`,
  `cross_domain_agreement`, `anomaly_clarity`

### 3.3 Ceiling reasons

| Reason | When to set |
|---|---|
| `single_day_window` | snapshot domain — caps confidence at ~0.70 |
| `sparse_data` | sample_size factor scored <0.5 |
| `sentinel_heavy` | >40% of cited fields are sentinels |
| `new_baseline` | baseline exists but <14 days |

When set, `confidence.value` MAY be lower than `confidence.calc` and the
math-check still passes.

---

## 4. Schema matrix — what exists at each timeframe

| Area | snapshot | week | month | year | lifetime |
|---|---|---|---|---|---|
| dashboard | ✓ | ✓ | ✓ | ✓ | — |
| sleep | ✓ | ✓ | ✓ | ✓ | — |
| activity | ✓ | ✓ | ✓ | ✓ | — |
| cardio | ✓ | ✓ | ✓ | ✓ | — |
| stress | ✓ | ✓ | ✓ | ✓ | — |
| body | ✓ | ✓ | ✓ | ✓ | — |
| anomalies | ✓ snapshot | ✓ rolling | ✓ persistent | ✓ history | — |
| coach | ✓ tomorrow | ✓ this week | ✓ month review | ✓ year review | — |
| baseline | — | — | — | — | ✓ |
| records | — | — | — | — | ✓ |
| milestones | — | — | — | — | ✓ |
| drift | — | ✓ | ✓ | ✓ | — |

---

## 5. Worked example

### 5.1 `snapshot/sleep.json`

```json
{
  "version": "1",
  "domain": "sleep",
  "timeframe": "snapshot",
  "period_key": "2026-05-06",
  "data_window": {
    "start_iso": "2026-05-05T22:52Z",
    "end_iso": "2026-05-06T07:36Z",
    "samples_seen": 524
  },
  "generated_at": "2026-05-06T07:35:00Z",
  "model": "qwen3.6:latest",
  "facts_hash": "sha256:…",
  "duration_ms": 91240,

  "context_summary": "Single night, 524 stage rows + one stats row. No prior nights to compare.",

  "observations": [
    { "id": "bedtime_window", "facts_ref": "stats.bedtime_iso", "value": "2026-05-05T22:52Z", "unit": "", "text": "Bed time 22:52Z, woke 07:36Z (8h 44m in bed)." },
    { "id": "stage_split",    "facts_ref": "stages",            "value": "L188 R92 D186 W58", "unit": "min", "text": "Stages: light 188, REM 92, deep 186, awake 58." },
    { "id": "score_block",    "facts_ref": "stats.score",       "value": 83, "unit": "0-100", "text": "Device-reported score 83, latency 57m, efficiency 89%." },
    { "id": "apnea_block",    "facts_ref": "apnea",             "value": "2 events", "unit": "count", "text": "Apnea events: 2 at level 1 (mild), durations 40s + 2s." },
    { "id": "vitals_block",   "facts_ref": "stats",             "value": "HRV70 br13 SpO2 98 HR60", "unit": "", "text": "Avg HRV 70ms, breath 13/min, SpO2 98%, HR 60bpm." }
  ],

  "metric_findings": [
    {
      "metric_id": "derived.deep_share_pct", "value": 40, "unit": "pct",
      "vs_norm": "above", "norm_band": [13, 23], "delta_from_norm": 17,
      "interpretation": "Derived deep share of 40% sits well above the 13–23% adult band; consistent with sleep-debt repayment.",
      "reasoning_trace": ["adult band 13–23%", "derived 186/466=40%", "ratio 1.74 above ceiling"]
    },
    {
      "metric_id": "stats.latency_min", "value": 57, "unit": "min",
      "vs_norm": "above", "norm_band": [0, 20], "delta_from_norm": 37,
      "interpretation": "57-min onset is ~3× the 20-min adult threshold; likely cause is late stimulation.",
      "reasoning_trace": ["healthy <20 min", "observed 57", "ratio 2.85"]
    },
    {
      "metric_id": "stats.efficiency_pct", "value": 89, "unit": "pct",
      "vs_norm": "within", "norm_band": [85, 100], "delta_from_norm": 0,
      "interpretation": "89% efficiency clears the 85% bar; once asleep the night was consolidated.",
      "reasoning_trace": []
    },
    {
      "metric_id": "stats.rdi", "value": -1, "unit": "events/h",
      "vs_norm": "sentinel", "norm_band": [0, 0],
      "interpretation": "RDI=-1 means apnea index was not computed; severity cannot be inferred from event count alone.",
      "reasoning_trace": []
    }
  ],

  "patterns": [
    {
      "id": "long_latency_consolidated_sleep",
      "involved_metrics": ["stats.latency_min", "stats.efficiency_pct"],
      "description": "Long onset offset by efficient consolidated sleep — once asleep, the body slept well.",
      "hypothesis": "Pre-sleep arousal, not fragmentation.",
      "testable_with": "7 nights of consistent bedtime"
    },
    {
      "id": "deep_dominance",
      "involved_metrics": ["derived.deep_share_pct", "derived.rem_share_pct"],
      "description": "Deep dominant over REM is unusual; suggests prior sleep debt being repaid.",
      "hypothesis": "Carry-over from previous short nights.",
      "testable_with": ""
    }
  ],

  "limiters": [
    { "kind": "sentinel",      "metric_id": "stats.rdi",      "text": "RDI=-1; apnea index not computed for this night." },
    { "kind": "single_window", "metric_id": null,             "text": "One-night snapshot — no fragmentation trend yet." },
    { "kind": "artifact",      "metric_id": "stats.deep_pct", "text": "facts.stats.deep_pct=93 disagrees with derived 40%; using derived value." }
  ],

  "evidence": [
    { "claim_id": "deep_rem_dominance", "text": "Deep + REM dominant",     "metric_path": "stages.deep_min + stages.rem_min", "value": "186 + 92 = 278 min (61% of asleep)" },
    { "claim_id": "latency_elevated",   "text": "Latency elevated",        "metric_path": "stats.latency_min",                "value": 57 },
    { "claim_id": "mild_apnea_cluster", "text": "Mild apnea cluster",      "metric_path": "apnea",                            "value": "2 events, both level 1, near-REM timing" }
  ],

  "comparison": {
    "available": false,
    "baseline_source": null,
    "deltas": []
  },

  "verdict": {
    "rating": "good",
    "score_0_100": 72,
    "headline": "8h 44m in bed with deep + REM dominant — but 57 min to fall asleep cost a chunk of REM.",
    "drivers": [
      { "metric_id": "derived.deep_share_pct", "name": "Deep sleep share",  "value": 40, "unit": "pct", "direction": "positive" },
      { "metric_id": "stats.latency_min",      "name": "Sleep latency",     "value": 57, "unit": "min", "direction": "negative" },
      { "metric_id": "stats.efficiency_pct",   "name": "Sleep efficiency",  "value": 89, "unit": "pct", "direction": "positive" }
    ],
    "next_action": {
      "title": "Lock a 22:30 wind-down routine for one week.",
      "why": "57-min onset is the strongest negative driver; fixing it unlocks more REM.",
      "effort": "low",
      "horizon": "tonight",
      "targets_metric": "stats.latency_min"
    }
  },

  "confidence": {
    "value": 0.55,
    "calc": 0.575,
    "math_check_passed": true,
    "ceiling_reason": "single_day_window",
    "factors": [
      { "factor": "sample_size",         "weight": 0.25, "score": 0.85, "rationale": "524 stage minutes covers the 8h44m night; one-night ceiling caps at 0.85." },
      { "factor": "data_quality",        "weight": 0.20, "score": 0.85, "rationale": "Stage rows clean; one artifact (deep_pct) flagged and routed to derived." },
      { "factor": "baseline_available",  "weight": 0.20, "score": 0.0,  "rationale": "First tracked night; baseline is null." },
      { "factor": "metric_completeness", "weight": 0.15, "score": 0.6,  "rationale": "RDI -1 and stats min/max HR sentinel; HRV/breath/SpO2 present." },
      { "factor": "apnea_index_computed","weight": 0.10, "score": 0.0,  "rationale": "RDI=-1 — index not computed." },
      { "factor": "freshness",           "weight": 0.10, "score": 1.0,  "rationale": "Generated within the wake hour." }
    ],
    "reasoning": "Sample density and freshness sit near ceiling; missing baseline and uncomputed apnea index are the structural caps; single-night cap pulls value down from calc."
  },

  "upward_signals": {
    "tags": ["sleep_latency_high", "deep_share_high", "single_apnea_event", "deep_pct_artifact"],
    "for_coach": [
      { "tag": "recovery_lever", "metric_id": "stats.latency_min",      "weight": 0.7 },
      { "tag": "load_signal",    "metric_id": "stats.efficiency_pct",   "weight": 0.3 }
    ],
    "for_weekly_trend": [
      { "metric_id": "stats.latency_min",      "value": 57 },
      { "metric_id": "stats.efficiency_pct",   "value": 89 },
      { "metric_id": "derived.deep_share_pct", "value": 40 }
    ],
    "anomalies_flagged": [
      { "id": "deep_pct_artifact", "severity": "info", "details": "facts.stats.deep_pct=93 disagrees with derived 40%." }
    ]
  }
}
```

---

## 6. Anomalies & coach — special schemas

The coach reads OTHER insights as input. Its schema replaces `metric_findings`
with `domain_status` (the rating snapshot from each input) and adds
`contradictions` + `priority`. The shared blocks (`limiters`, `confidence`,
`upward_signals`) are unchanged.

`anomalies/<period>.json` keeps the canonical block ordering, but
`metric_findings` becomes per-flagged-metric and `verdict` is replaced by
`active`/`watching`/`overall_severity`. Detail to be specced when the
anomalies prompt is added.

---

## 7. Schema versioning

Schema body is `v2`. The orchestrator currently stamps top-level
`version: "1"` for backward compatibility with the bundle reader; bump to
`"2"` when the orchestrator is allowed to follow the schema change.

Within a major, additive fields only. UI tolerates missing additive fields.

---

## 8. Lessons from sleep iteration (cumulative)

Tightened during Phase-B then again at the v2 cutover. Apply universally.

1. **Every field description names its source.** "value" → "the actual
   numeric value from facts for this metric. NEVER an empty string."
2. **Enums get explicit "NEVER X" lists.** `direction` → `NEVER "high",
   "low", "good", "bad"`. `metric_path` → `NEVER "narrative"`.
3. **Length caps for synthesis sentences are 220–240 chars, not 200.**
4. **Confidence rationales explicitly ban self-correction prose.**
5. **`score_0_100` is the model's verdict; never copy `facts.score`.**
6. **One-shot canonical-shape examples in the system prompt for every
   nested-array field.** Free-form schema descriptions are too fudge-able.
7. **Pre-derive numbers in the user prompt, then tell the model to verify.**
8. **Hard-cap confidence in the system prompt for known structural
   limits** (single-day snapshot ≤ 0.70 via `ceiling_reason`).
9. **Tag every value with a `metric_id` / `facts_ref` / `metric_path`.**
   The abstraction LLM keys off these; without them the upward layer is
   blind.
10. **`reasoning_trace` is empty array OR 2–4 short steps.** A
    one-element trace is just a sentence and belongs in `interpretation`.

## 9. Test fixtures

- `runner/fixtures/facts.snapshot.example.json` — input
- `runner/fixtures/expected.snapshot.sleep.json` — schema-valid example output

`tsx src/index.ts snapshot --dry-run` validates without calling Ollama.
