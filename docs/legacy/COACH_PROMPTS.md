# Coach insights — prompt design (snapshot pipeline)

> **Scope note (2026-05-10)** — describes the **snapshot pipeline** prompts
> (`runner/src/prompts/snapshot/{sleep,cardio,activity,body,stress,anomalies,coach}.ts`),
> still wired via `tsx src/index.ts snapshot`. The daily v2 prompt lives at
> `runner/src/prompts/daily.ts`; its system prompt + schema are German,
> structured-output, with reasoning_trace as the first property and a
> Stage 4 regen-with-feedback loop driven by the verifier in
> `runner/src/stages/stage6-verify.ts`. See `COACH_PLAN.md` for the
> end-to-end pipeline that consumes it.

The model is qwen3.6; quality > latency. Output feeds TWO consumers:

1. **Dashboard UI** — renders `verdict` and `confidence.value`.
2. **Abstraction LLM** (weekly + coach roll-ups) — reads
   `metric_findings`, `patterns`, `limiters`, and `upward_signals` to do
   cross-domain synthesis.

Both layers must be load-bearing.

## Cardinal rules

1. **Fill reasoning fields before summary fields.** Schema property order is the
   contract; the system prompt repeats the order verbatim.
2. **No prose lead-in.** Use structured output with output schema (https://docs.ollama.com/capabilities/structured-outputs#generating-structured-json-with-a-schema)
3. **Cite or be silent.** Every value carries a `metric_id` / `facts_ref` /
   `metric_path` pointing at the facts blob. If a claim has no facts path, omit it.
4. **Stay inside the data window.** Do not reference periods outside the
   provided facts (e.g. don't say "trending for weeks" on a single-day snapshot).
5. **Confidence is criteria-grounded, not invented.** Score a fixed weighted
   rubric (`confidence.factors`), write a short `confidence.reasoning`, then
   output a `value` that approximates Σ weight × score within ±0.10 (or
   strictly lower than the calc when a `ceiling_reason` is set). The runner
   re-computes `calc` deterministically and rejects mismatches.
6. **One next action.** No bulleted suggestion soups except in `coach/*` where
   the schema explicitly allows up to 3.
7. **Envelope is runner-owned.** The model NEVER emits `version`, `domain`,
   `timeframe`, `period_key`, `data_window`, `generated_at`, `model`,
   `facts_hash`, `duration_ms`. The orchestrator stamps them.
8. **`upward_signals.tags` are not optional.** Snake_case, stable, ≥1.

## System prompt (shared)

The canonical text lives in `runner/src/prompts/shared.ts`. Every call uses
this base with the area-specific addition appended. Block summary:

```
You are a precise health-data analyst working with one user's wearable data.
Your output feeds the dashboard UI (verdict + confidence.value) AND a
downstream abstraction LLM (metric_findings, patterns, limiters,
upward_signals). Both must be load-bearing.

REASONING ORDER (mandatory)
  1.  context_summary       — one or two sentences naming what you see.
  2.  observations          — bare facts {id, facts_ref, value, unit, text}.
  3.  metric_findings       — per-metric reasoning {metric_id, value, unit, vs_norm, norm_band, delta_from_norm?, interpretation, reasoning_trace?}.
  4.  patterns              — cross-metric {id, involved_metrics, description, hypothesis, testable_with}.
  5.  limiters              — typed {kind, metric_id, text} (kind enum).
  6.  evidence              — {claim_id, text, metric_path, value}.
  7.  comparison            — {available, baseline_source, deltas[]}.
  8.  verdict               — {rating, score_0_100, headline, drivers[3], next_action}.
  9.  confidence            — {value, calc, math_check_passed, ceiling_reason, factors, reasoning}.
 10.  upward_signals        — {tags, for_coach, for_weekly_trend, anomalies_flagged}.

CANONICAL SHAPES — copy these structures exactly.
  observations:    array of typed objects, every value has facts_ref + unit + text
  metric_findings: array of typed objects with vs_norm enum + numeric norm_band
  patterns:        typed objects with snake_case id, involved_metrics[]
  limiters:        typed {kind: sentinel|single_window|artifact|data_gap|sparse_sampling}
  evidence:        typed {claim_id, text, metric_path, value}
  comparison:      {available:false, baseline_source:null, deltas:[]} unless baseline provided
  verdict.drivers: exactly 3, every driver has metric_id (facts path) + numeric value
  next_action:     prose {title, why, effort, horizon, targets_metric}
  confidence:      typed block; runner sets math_check_passed and authoritative calc
  upward_signals:  {tags[], for_coach[], for_weekly_trend[], anomalies_flagged[]}

CONFIDENCE — HOW TO SCORE THE RUBRIC
Score = 1.0 fully satisfied. 0 unsatisfiable. Middle range honest. If you
cannot ground a rationale in a number, set score ≤ 0.4. Single decisive
sentence; NO self-correction. confidence.value ≈ Σ(weight × score) within
±0.10 unless a ceiling_reason explains a strict cap (snapshot domains:
"single_day_window" → value ≤ 0.70).

DON'T (auto-rejected by runner)
- envelope keys (version/domain/timeframe/period_key/data_window/...) in output
- single-sentence reasoning_trace (use [] or 2–4 short steps)
- comparison.available=true without facts.<domain>.baseline
- omit metric_id on drivers/observations/metric_findings
- copy facts.score into verdict.score_0_100
- snake_case in next_action.title or .why
- "narrative" as evidence.metric_path
- math_check_passed=false (always set true; runner verifies)
- empty upward_signals.tags

DATA INTEGRITY
- sentinel (-1) → limiter with kind="sentinel"
- implausible firmware (e.g. deep_pct=93%) → limiter with kind="artifact" + use derived value
- no rows → verdict.rating="poor", verdict.score_0_100=0, confidence.value=0.0
```

## Per-area system addendum

Each area adds 3–8 lines. Examples:

### sleep
```
DOMAIN: sleep
KEY CONCEPTS
- Latency = minutes from bed to first non-awake stage.
- Efficiency = asleep / in-bed.
- Deep portion in healthy adults 13–23%.
- REM portion 20–25%; biased to second half of night.
- Apnea level 1=mild, 2=moderate, 3=severe, 4=very severe.
- RDI=-1 means apnea index not computed; DO NOT infer severity from event count alone.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): "full night" = ≥360 stage minutes. Score 1.0 only when
  the night spans ≥7h. Partial nights cap at 0.5.
- data_quality (0.20): score 1.0 if no -1 sentinels in fields you cited.
  Each cited sentinel field drops score by 0.2.
- baseline_available (0.20): 0 if no prior nights; 0.5 with <14 nights;
  0.85 with 14–30; 1.0 with >30 nights of personal baseline.
- metric_completeness (0.15): per-field availability of the metrics you
  actually used (HRV, breath, SpO2, HR, deep%, latency, efficiency).
  Score = (present / expected).
- apnea_index_computed (0.10): 1.0 if RDI present and finite, else 0.
- freshness (0.10): 1.0 if generated within 6h of wake, 0.5 if within 36h,
  0 beyond.
```

### cardio
```
DOMAIN: cardio
KEY CONCEPTS
- HR zones for this user (computed from age 26): rest <90, easy 90–110,
  aerobic 110–130, threshold 130–150, max ≥150.
- Resting HR drift > +5 bpm over 14 days = potential overreach.
- HRV dip > 15% below personal baseline = autonomic stress signal.
- If you encounter a signed-byte overflow row (raw negative HR not -1) =
  firmware artefact; the real value is 256 + raw. Note as data quality,
  not biology.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.20): snapshot needs ≥120 HR points; week needs ≥5 days
  with HR data; month needs ≥20. Linear ramp.
- data_quality (0.20): score 1.0 if no signed-byte overflows in window;
  drop 0.1 per overflow up to 0.5; drop further if HR has long gaps (>2h).
- baseline_available (0.20): 0 with no baseline; 0.5 at <14 days;
  1.0 at >30 days.
- hrv_sample_density (0.15): score = clamp(samples_per_day / target, 0, 1)
  where target = 5 for snapshot, 1.5/day for week+, capped 1.0.
- hr_zone_coverage (0.15): score = days_with_zone_data / window_days
  (only for week/month/year; for snapshot fix at 1.0 if any zone observed).
- freshness (0.10): 1.0 if within 6h of latest data, 0.5 within 36h, else 0.
```

### activity
```
DOMAIN: activity
KEY CONCEPTS
- Step counter: rows with steps=-1 are sentinels; ignore.
- Calorie counter is firmware-raw, not kcal; report unitless.
- Distance stored ×100 (cm); divide by 100 before summarizing.
- "movement_shape" categorizes the day: none|single-bout|even|spiky|sustained.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.20): snapshot needs ≥6 awake hours of activity rows;
  week needs ≥5 logged days; month ≥20.
- data_quality (0.15): score = 1 - (sentinel_rows / total_rows). If the
  ratio exceeds 60% the score caps at 0.4.
- step_sentinel_ratio (0.15): explicit; score = 1 - (steps=-1 rows / total).
- baseline_available (0.15): step-goal achievement history; 0 if no prior.
- sedentary_block_visibility (0.15): 1.0 if minute-grid is gapless,
  drop 0.1 per >30-min gap up to 0.4 floor.
- metric_completeness (0.10): calories, distance, steps all present (not all
  zero). Score = present_count / 3.
- freshness (0.10): same ladder as other domains.
```

### stress
```
DOMAIN: stress
KEY CONCEPTS
- Buckets: 0–29 relaxed, 30–59 mild, 60–79 moderate, 80–100 high.
- Sparse sampling (~30/day) — never overinterpret a single point.
- Time-of-day matters: morning peaks ≠ evening peaks.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): snapshot needs ≥20 stress points across ≥6h;
  week ≥100; month ≥400. Linear ramp.
- sample_density_per_hour (0.20): score = clamp(avg_per_hour / 2, 0, 1).
  ~30 points across 16h = 1.9/h, score 0.95.
- data_quality (0.15): all values inside 0..100 range. Drop 0.2 per
  out-of-range row.
- baseline_available (0.15): score by days of personal stress data.
- coverage_balance (0.15): score = 1 - |waking_pct - 0.7| × 2,
  i.e. penalise data that's all sleep or all daytime.
- freshness (0.10): standard ladder.
```

### body
```
DOMAIN: body
KEY CONCEPTS
- Skin temperature, NOT body/core. Reflects ambient + circulation.
- 1-min cadence; expect smooth diurnal curve.
- Personal baseline forms after ~14 days; flag deltas > 0.7°C from baseline.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): snapshot needs ≥600 temp points; week ≥4200;
  month ≥18000. Linear ramp.
- temp_sample_density (0.15): expected 1/min; score = obs_per_min / 1.
- data_quality (0.15): score 1.0 if all temps inside 28..38°C;
  drop 0.2 per out-of-range row.
- baseline_available (0.20): personal skin-temp baseline present after
  14 days. 0 → 1.0 linearly to day 30.
- cross_sensor_agreement (0.10): if SpO2/HRV present in same window,
  agreement adds confidence; score = (sensors_with_data / 3).
- metric_completeness (0.05): SpO2 + HRV + temp all present.
- freshness (0.10): standard ladder.
```

### anomalies
```
DOMAIN: anomalies
KEY CONCEPTS
- Threshold ladder: singleton suppressed, ≥2 info, ≥3 warn, ≥10 critical.
- Distinguish DATA-QUALITY anomalies (firmware, sentinels) from BIOLOGICAL
  ones (HR spike during sleep, SpO2 desaturation).
- Static firmware quirks belong in data_notes, not active.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- detection_window_size (0.30): more rows scanned = more confident
  in absence-of-finding. Score = clamp(rows_scanned / target_for_period, 0, 1).
- threshold_clarity (0.25): score 1.0 when every flagged anomaly has
  count ≥ ladder threshold; drop for ambiguous boundary cases.
- biological_vs_quality_separation (0.15): score 1.0 if every active
  anomaly is correctly classified; 0.5 if any uncertain.
- correlation_evidence (0.15): cross-domain support raises confidence
  (e.g. HR spike during sleep aligns with stress sample). Score = matched_pairs / total_active.
- baseline_available (0.10): personal anomaly history exists.
- freshness (0.05): standard ladder.
```

### coach
```
DOMAIN: coach
INPUTS
You receive the OTHER insights for this period as JSON in the user message.
Read them. Identify the dominant signal (highest-severity limiter or strongest
positive trend). Pick ONE focus. Do not contradict yourself.

CONFLICT RESOLUTION
- If sleep says rest and cardio says push, sleep wins (recovery first).
- If anomalies has a "warn" or "critical" active, focus must be "maintenance"
  until cleared.
- If no negatives, focus = "maintenance" with a gentle progression.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- inputs_completeness (0.30): score = inputs_validated / inputs_expected
  for the period. Missing or stub-confidence-0 inputs reduce score linearly.
- inputs_confidence_avg (0.25): mean of input domains' own confidence.
  Coach confidence cannot exceed inputs avg by more than +0.10.
- cross_domain_agreement (0.20): how many input ratings agree on direction.
  All-aligned = 1.0; perfect split = 0.4.
- anomaly_clarity (0.10): 1.0 if no critical/warn anomalies, or if all are
  fully classified; lower if ambiguous.
- baseline_available (0.10): personal coach-history exists for prior trend.
- freshness (0.05): standard ladder.
```

## User message template

The user message is always pure facts JSON, prefixed by a short orientation:

```
PERIOD: snapshot · YYYY-MM-DD
DATA WINDOW: YYYY-MM-DDThh:mmZ → YYYY-MM-DDThh:mmZ
SAMPLES: N activity rows · N stage rows · N stress · N temp · N hrv

FACTS:
<JSON facts blob>

PRODUCE: insights/snapshot/YYYY-MM-DD/sleep.json
SCHEMA: <embedded JSON Schema>
```

The runner injects:
- The facts blob (only the FIELDS the schema needs — prevents distraction)
- The exact JSON Schema as the `format` field on the Ollama call
- A short reminder of the property order

## Worked example: sleep snapshot prompt

### system
```
[shared base, see above]

DOMAIN: sleep
KEY CONCEPTS
[…]

REMINDER
Fill in this exact order: context_summary, observations, per_metric_analysis,
patterns, limiters, evidence, comparison, drivers, rating, score_0_100,
headline, next_action, confidence_factors, confidence_reasoning, confidence.
```

### user
```
PERIOD: snapshot · YYYY-MM-DD
DATA WINDOW: YYYY-MM-DDT22:52Z → YYYY-MM-DDT07:36Z
SAMPLES: N stage rows · 1 stats row · N apnea rows

FACTS:
{
  "stages": {"light_min":N,"rem_min":N,"deep_min":N,"awake_min":N},
  "stats": {
    "score":N,"bedtime_iso":"YYYY-MM-DDT22:52Z","wakeup_iso":"YYYY-MM-DDT07:36Z",
    "latency_min":N,"efficiency_pct":N,"deep_pct":N,
    "avg_hrv_ms":N,"avg_breath":N,"avg_spo2":N,"avg_hr":N,"rdi":-1
  },
  "apnea": [
    {"start_iso":"YYYY-MM-DDT07:13Z","duration_s":N,"level":1}
  ],
  "baseline": null
}

PRODUCE: insights/snapshot/YYYY-MM-DD/sleep.json
```

### options
```json
{
  "model": "qwen3.6:8b",
  "format": <full JSON Schema for snapshot/sleep>,
  "options": {"temperature": 0.15, "num_ctx": 8192, "top_p": 0.9},
  "stream": false
}
```

## Worked example: coach week prompt

### system
```
[shared base]

DOMAIN: coach
INPUTS
You receive THIS WEEK's insights for sleep, cardio, stress, activity, body,
anomalies as JSON in the user message. Read them in order. Identify the
dominant signal. Pick exactly ONE focus.

CONFLICT RESOLUTION
[…]

REMINDER
Fill in this exact order: context_summary, observations, inputs_seen,
domain_status, contradictions, priority, focus, plan, do_not,
encouragement, weekly_thread, headline, confidence_factors,
confidence_reasoning, confidence.
```

### user
```
PERIOD: week · 2026-W19
DATA WINDOW: 2026-04-29 → 2026-05-06

INPUTS:
- week/sleep.json:    <full JSON>
- week/cardio.json:   <full JSON>
- week/stress.json:   <full JSON>
- week/activity.json: <full JSON>
- week/body.json:     <full JSON>
- week/anomalies.json: <full JSON>

PRODUCE: insights/week/2026-W19/coach.json
```

## Confidence-factor catalogue (summary)

| Domain | Universal factors | Domain-specific factors |
|---|---|---|
| sleep | sample_size · data_quality · baseline_available · metric_completeness · freshness | apnea_index_computed |
| cardio | sample_size · data_quality · baseline_available · freshness | hrv_sample_density · hr_zone_coverage |
| activity | sample_size · data_quality · baseline_available · metric_completeness · freshness | step_sentinel_ratio · sedentary_block_visibility |
| stress | sample_size · data_quality · baseline_available · freshness | sample_density_per_hour · coverage_balance |
| body | sample_size · data_quality · baseline_available · metric_completeness · freshness | temp_sample_density · cross_sensor_agreement |
| anomalies | baseline_available · freshness | detection_window_size · threshold_clarity · biological_vs_quality_separation · correlation_evidence |
| coach | baseline_available · freshness | inputs_completeness · inputs_confidence_avg · cross_domain_agreement · anomaly_clarity |

Weights live in `runner/confidence-weights.ts` and are injected into each
schema's `format` field as `const` constraints. Model fills `score` +
`rationale`; runner verifies `confidence ≈ Σ weight × score` within ±0.10
or triggers a retry.

## Math-check guard

Before accepting an output the runner runs a deterministic check:

```ts
const calc = factors.reduce((s, f) => s + f.weight * f.score, 0);
const ok = Math.abs(calc - confidence) <= 0.10;
```

If `ok` is false, retry with a stricter system note: "Your reported
confidence (X) does not match Σ weight × score (Y). Recompute."

This makes the rubric load-bearing instead of decorative.

## Retry strategy

The runner runs each prompt up to 3 times:

1. First pass: temperature 0.15, full schema.
2. If JSON Schema parse fails: re-issue with appended note
   `Strict reminder: output must validate against the schema. Last attempt failed
   on field <X>.` Temperature 0.10.
3. If math-check guard fails: re-issue with the calc / reported delta noted.
4. Final fallback: temperature 0.05, schema unchanged.
5. After 3 fails: write stub with `confidence: 0`, `error: "schema_parse_fail"`,
   keep last-good file in place if exists.

## Quality knobs to A/B later

- Property order strictness — verify qwen3.6 honors order. If not, add
  `keys_in_order: true` reminder.
- Few-shot examples — embed one minimal valid example in the system prompt.
- Numeric reasoning — include a `worked_example` block for tricky math
  (e.g. percentages of asleep time).
- Domain glossary length — too long distracts the model.
- Temperature ladder per domain — coach maybe 0.25, anomalies 0.05.

## Lessons from sleep iteration (2026-05)

After Phase-B knob experiments on `snapshot/sleep` with qwen3.6:latest, the
following principles cleanly generalise. They are baked into
`runner/src/prompts/shared.ts` and `runner/src/schemas/shared.ts`; new
domains should inherit them automatically and only add domain-specific
addenda.

1. **Always include one-shot canonical-shape examples in the system prompt
   for every nested-array field.** Free-form schema descriptions are too
   easy for the model to fudge ("drivers" came back as `{metric, verdict}`
   pre-iteration). A 5-line literal example block flips the model from
   "creative shape" to "copy this shape" with near-zero quality cost.
   Witnessed first-attempt-success rate: ~0/3 → ~3/3.

2. **Field descriptions must point at facts.** Replace generic descriptions
   with sentences that name the source field path. Example: instead of
   "value" → "string or number", write "the actual numeric value from
   facts for this metric; NEVER an empty string". This fixed driver values
   coming back as 0 and per_metric_analysis values as "". Use both negative
   ("NEVER an empty string") and positive ("copy from facts.X") instructions
   in the same description; positive alone is too easy to ignore.

3. **List bad patterns explicitly under DON'T.** The model treats prose
   instructions as soft suggestions but DON'T blocks as hard rules. Witnessed
   in baseline: model wrote `"narrative"` as evidence.metric until the prompt
   added `DON'T use "narrative" as the metric in evidence rows`. After: model
   uses `"stats.latency_min"` natively.

4. **Pre-derive numbers in the user prompt, then tell the model to verify.**
   For metrics where facts may be artifacted (e.g. sleep `deep_pct=93%` when
   stage minutes give 40%), compute the derived value in the runner and
   ship both into the user prompt with an explicit "use the derived value
   if they disagree" note. Don't rely on the model to do arithmetic AND
   spot the artifact AND choose correctly — pre-cook the choice.

5. **Reasoning-field counts should be explicit.** Schemas like
   `STR_ARRAY(min, max)` enforce count, but the prompt should say
   "exactly 3 drivers", "1–5 patterns" so the model commits early
   instead of deciding by exhaustion.

6. **Confidence rationales: ban self-correction phrases.** Add
   `NO self-correction ("wait...", "let me reconsider...")` to the
   rationale field description. Caveats explicitly forbid the rambling
   "I cited 4 sentinels... wait, only 2..." pattern that cost 60+ tokens
   per factor in baseline.

7. **Hard-cap confidence in the system prompt for known structural
   limits** (e.g. single-day snapshot ≤ 0.70). The model otherwise drifts
   toward 0.85+ on a "perfect" full-night read. Stating the cap once in
   the shared system prompt is cheaper than weighting it through 6 rubric
   factors.

8. **Length caps on patterns/limiters at 240 chars (not 200).** 200 forced
   the model to truncate mid-thought for any synthesis sentence with a
   numeric example; 240 fits a clean compound sentence with a number and
   a tradeoff. 280+ invites prose drift.

These principles are universal; per-domain prompts should focus only on
domain-specific concept glossaries and confidence-rubric thresholds.

### Worked-example anchor (sleep)

The `snapshot/sleep` prompt now ships a literal worked example showing
how to handle the `stats.deep_pct=93%` firmware artifact. This single
worked example collapsed 7 weakness modes simultaneously:
- driver value=0 → 40
- per_metric_analysis value="" → 40
- limiters listing the artifact natively
- evidence using `stages.deep_min / total_asleep_min` instead of "narrative"
- patterns referencing the derived 40% in synthesis sentences
- next_action pointing at latency (the actual lever) not the artifact
- confidence rationale citing the artifact correctly under data_quality

Other domains should ship analogous worked examples for known artifacts
(e.g. cardio signed-byte HR overflow; activity calorie unit; body temp
warm-room days).

## Telemetry

Each run logs to `insights/<period>/_bundle.json`:

```json
{
  "model": "qwen3.6:8b",
  "runs": [
    {
      "domain": "sleep",
      "attempts": 1,
      "duration_ms": 91200,
      "tokens_in": 1840,
      "tokens_out": 720,
      "validated": true,
      "confidence": 0.74
    }
  ],
  "totals": { "duration_ms": 642000, "validated": 8, "stubs": 0 }
}
```

The Pi UI reads `_bundle.json` for the runner status badge.
