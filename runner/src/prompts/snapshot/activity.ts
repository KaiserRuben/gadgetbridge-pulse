import { ActivitySnapshotSchema } from "../../schemas/snapshot/activity.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: activity
KEY CONCEPTS
- Sentinel rows (STEPS=-1) are firmware idle markers. EXCLUDE from totals; cite count only in limiters/quality scoring.
- The calorie counter is firmware-raw, NOT kcal. Use it for relative shape (which hour spiked) only; do NOT translate to kcal in interpretation text.
- Distance is stored in centimetres in raw rows; facts.activity.distance_m is already converted to metres — trust it.
- Each minute is stored twice (forward + backward); facts already filters to forward rows (OTHER_TIMESTAMP > TIMESTAMP), so total_minutes ≈ wear minutes for the window.
- movement_shape categories (pick exactly one):
    none          — steps_total < 200
    single_bout   — one hour holds ≥60% of total steps (concentrated burst)
    spiky         — 2–3 active hours each ≥15% of total, rest near zero
    even          — ≥6 hours at >5% of total (distributed walking)
    sustained     — one hour holds ≥30% AND a second hour ≥20% (long session)

DERIVED VALUES (compute these — do not just trust facts blob)
- peak_hour                  = hour h where hourly_steps[h].steps is max (0–23)
- peak_hour_pct              = round(peak_steps / steps_total × 100)
- longest_sedentary_block_min= longest consecutive run of zero-step hours × 60.
                               Walk hourly_steps[].steps in order; reset on any non-zero. Express in MINUTES.
- sentinel_ratio             = round(sentinel_step_rows / total_minutes × 100, 1)  (% of window in sentinel state)
- active_hour_count          = count of hours where steps > 0
- movement_shape             = single string from the categories above

NORM BANDS (use these in metric_findings.norm_band)
- steps_total                  → [7000, 12000]  below ⇒ negative driver
- goal_pct                     → [80, 120]      below ⇒ negative driver; far above ⇒ positive
- active_minutes               → [30, 240]      below ⇒ negative; values from 1-min sample bins
- distance_m                   → [4000, 12000]  below ⇒ negative
- derived.peak_hour_pct        → [0, 50]        above ⇒ flag in patterns (single-bout shape)
- derived.longest_sedentary_block_min → [0, 240] above ⇒ negative driver candidate
- derived.sentinel_ratio       → [0, 30]        above ⇒ data-quality concern (limiter kind="sentinel")

If sentinel_ratio > 30, treat the day as poorly sampled and lower confidence.data_quality / step_sentinel_ratio scores accordingly.
If steps_total is small but calories_total has hours with values >5000 in zero-step hours, that is normal firmware behaviour (resting calories raw), NOT an artifact — do NOT flag.

WORKED EXAMPLE — single-bout day (steps_total=420, peak hour=11 with 336 steps):
metric_findings entry:
{"metric_id":"derived.peak_hour_pct","value":80,"unit":"pct","vs_norm":"above",
 "norm_band":[0,50],"delta_from_norm":30,
 "interpretation":"80% of the day's 420 steps occurred in hour 11; the day is a single-bout shape rather than distributed walking.",
 "reasoning_trace":["peak hour 11 = 336 steps","total 420 steps","336/420 = 80%"]}

WORKED EXAMPLE — patterns entry for the same day:
{"id":"single_bout_then_sedentary",
 "involved_metrics":["derived.peak_hour_pct","derived.longest_sedentary_block_min"],
 "description":"One concentrated step burst around midday followed by an 8h+ sedentary tail.",
 "hypothesis":"Single short walk; otherwise sedentary day.",
 "testable_with":"7 days of hourly_steps to see if shape repeats"}

WORKED EXAMPLE — limiters entry (typed kinds):
[{"kind":"sentinel","metric_id":"sentinel_step_rows","text":"10 minute rows are STEPS=-1 firmware sentinels; excluded from totals."},
 {"kind":"single_window","metric_id":null,"text":"One-day snapshot — no weekly activity trend yet."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["steps_low","goal_missed","single_bout_shape"],
 "for_coach":[{"tag":"load_signal","metric_id":"steps_total","weight":0.7},
              {"tag":"recovery_lever","metric_id":"derived.longest_sedentary_block_min","weight":0.3}],
 "for_weekly_trend":[{"metric_id":"steps_total","value":420},
                     {"metric_id":"goal_pct","value":4.2},
                     {"metric_id":"derived.peak_hour_pct","value":80}],
 "anomalies_flagged":[]}

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.20): full day = ≥1200 forward minutes covering ≥20 distinct hours. Score 1.0 ONLY when ≥1200 minutes AND multiple days available; cap at 0.85 for a single full day, 0.5 for partial (<800 minutes).
- data_quality (0.15): score 1.0 if no firmware oddities; subtract 0.15 per non-trivial concern cited in limiters (artifact or sparse_sampling rows).
- step_sentinel_ratio (0.15): 1.0 if sentinel_ratio ≤ 5%; 0.7 if ≤ 15%; 0.4 if ≤ 30%; 0.0 if > 30%.
- baseline_available (0.15): 0 if facts.activity.baseline is null; 0.5 with <14 days; 0.85 with 14–30; 1.0 with >30.
- sedentary_block_visibility (0.15): 1.0 when hourly_steps covers all 24 hours with non-null entries (current pipeline always does → score 1.0 unless whole hours are missing).
- metric_completeness (0.10): present_count / expected_count among (steps_total, calories_total, distance_m, active_minutes, hourly_steps, goal_pct).
- freshness (0.10): 1.0 if generated within 6h of window end; 0.5 within 36h; 0 beyond.

For snapshot/activity: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const ActivitySnapshotPrompt = {
  domain: "activity" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: ActivitySnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    if (!facts.activity || facts.activity.total_minutes === 0) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO ACTIVITY DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No activity data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_activity_data"].`;
    }
    const a = facts.activity;
    const activityFacts = {
      steps_total: a.steps_total,
      calories_total: a.calories_total,
      distance_m: a.distance_m,
      active_minutes: a.active_minutes,
      sentinel_step_rows: a.sentinel_step_rows,
      total_minutes: a.total_minutes,
      hourly_steps: a.hourly_steps,
      step_goal: a.step_goal,
      goal_pct: a.goal_pct,
      baseline: a.baseline,
    };

    // ── derived values (model is told to recompute, but these are correct) ──
    const hourly = a.hourly_steps;
    let peakHour = 0;
    let peakSteps = 0;
    for (const row of hourly) {
      if (row.steps > peakSteps) {
        peakSteps = row.steps;
        peakHour = row.hour;
      }
    }
    const peakHourPct = a.steps_total > 0 ? Math.round((peakSteps / a.steps_total) * 100) : 0;

    let longestZeroRun = 0;
    let curRun = 0;
    const ordered = [...hourly].sort((x, y) => x.hour - y.hour);
    for (const row of ordered) {
      if (row.steps === 0) {
        curRun++;
        if (curRun > longestZeroRun) longestZeroRun = curRun;
      } else {
        curRun = 0;
      }
    }
    const longestSedentaryBlockMin = longestZeroRun * 60;

    const sentinelRatio =
      a.total_minutes > 0
        ? Math.round((a.sentinel_step_rows / a.total_minutes) * 100 * 10) / 10
        : 0;
    const activeHourCount = hourly.filter((r) => r.steps > 0).length;

    // movement_shape pre-classification (model may override but here is the deterministic call)
    let movementShape = "none";
    if (a.steps_total >= 200) {
      const fracs = hourly.map((r) =>
        a.steps_total > 0 ? r.steps / a.steps_total : 0,
      );
      const top = [...fracs].sort((x, y) => y - x);
      const top1 = top[0] ?? 0;
      const top2 = top[1] ?? 0;
      const overFive = fracs.filter((f) => f > 0.05).length;
      if (top1 >= 0.6) movementShape = "single_bout";
      else if (top1 >= 0.3 && top2 >= 0.2) movementShape = "sustained";
      else if (overFive >= 6) movementShape = "even";
      else movementShape = "spiky";
    }

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.data_window.start_iso} → ${facts.data_window.end_iso}
SAMPLES: ${facts.samples_seen.activity_rows} activity rows · ${a.total_minutes} forward minutes · ${a.sentinel_step_rows} sentinel rows
BASELINE PROVIDED: ${a.baseline === null ? "no (set comparison.available=false, deltas=[])" : "yes"}

DERIVED (compute again to verify, but these are correct):
- peak_hour                       = ${peakHour}
- peak_steps                      = ${peakSteps}
- peak_hour_pct                   = ${peakHourPct}
- longest_sedentary_block_min     = ${longestSedentaryBlockMin}
- sentinel_ratio                  = ${sentinelRatio}
- active_hour_count               = ${activeHourCount}
- movement_shape                  = ${movementShape}

FACTS:
${JSON.stringify(activityFacts, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/activity.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(ActivitySnapshotPrompt);
