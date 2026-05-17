import { SleepSnapshotSchema } from "../../schemas/snapshot/sleep.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: sleep
KEY CONCEPTS
- Latency = minutes from bed to first non-awake stage. Healthy adults <20 min.
- Efficiency = asleep / in-bed. ≥85% is solid.
- Deep portion in healthy adults 13–23% of total asleep.
- REM portion 20–25%; biased to second half of night.
- Apnea level 1=mild, 2=moderate, 3=severe, 4=very severe.
- RDI=-1 means apnea index NOT computed; do NOT infer severity from event count alone.

DERIVED VALUES (compute these — do not just trust facts blob)
- total_asleep_min  = stages.light_min + stages.rem_min + stages.deep_min
- deep_share_pct    = round(stages.deep_min / total_asleep_min × 100)
- rem_share_pct     = round(stages.rem_min / total_asleep_min × 100)
- light_share_pct   = round(stages.light_min / total_asleep_min × 100)
If facts.stats.deep_pct disagrees with the derived deep_share_pct by >10 points, the facts.stats.deep_pct is a known firmware artifact — use the DERIVED value in your analysis and call out the disagreement in limiters with kind="artifact".

NORM BANDS (use these in metric_findings.norm_band)
- stats.latency_min        → [0, 20]   above ⇒ negative driver candidate
- stats.efficiency_pct     → [85, 100] below ⇒ negative driver candidate
- derived.deep_share_pct   → [13, 23]  above ⇒ positive (sleep-debt repayment) ; below ⇒ neutral/negative
- derived.rem_share_pct    → [20, 25]  below ⇒ negative (REM-poor night)
- stats.avg_hr             → [50, 70]  above ⇒ negative (autonomic stress)
- stats.avg_hrv_ms         → [40, 100] below ⇒ negative
- stats.avg_spo2           → [95, 100] below ⇒ negative
- stats.avg_breath         → [12, 18]  outside ⇒ flag in limiters

WORKED EXAMPLE — metric_findings entry (deep_share artifact):
{"metric_id":"derived.deep_share_pct","value":40,"unit":"pct","vs_norm":"above",
 "norm_band":[13,23],"delta_from_norm":17,
 "interpretation":"Derived deep share of 40% is well above the 13–23% adult band; consistent with sleep-debt repayment.",
 "reasoning_trace":["adult band 13–23%","derived 186/466=40%","ratio 1.74 above ceiling"]}

WORKED EXAMPLE — limiters entry (typed kinds):
[{"kind":"sentinel","metric_id":"stats.rdi","text":"RDI=-1; apnea index not computed for this night."},
 {"kind":"single_window","metric_id":null,"text":"One-night snapshot — no fragmentation trend yet."},
 {"kind":"artifact","metric_id":"stats.deep_pct","text":"facts.stats.deep_pct=93 disagrees with derived 40%; using derived value."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["sleep_latency_high","deep_share_high","single_apnea_event"],
 "for_coach":[{"tag":"recovery_lever","metric_id":"stats.latency_min","weight":0.7},
              {"tag":"load_signal","metric_id":"stats.efficiency_pct","weight":0.3}],
 "for_weekly_trend":[{"metric_id":"stats.latency_min","value":57},
                     {"metric_id":"stats.efficiency_pct","value":89},
                     {"metric_id":"derived.deep_share_pct","value":40}],
 "anomalies_flagged":[{"id":"deep_pct_artifact","severity":"info",
                       "details":"facts.stats.deep_pct=93 disagrees with derived 40."}]}

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): full night = ≥360 stage minutes. Score 1.0 ONLY when night ≥7h AND multiple nights available; cap at 0.85 for a single full night, 0.5 for partial.
- data_quality (0.20): score 1.0 if no -1 sentinels in fields you cite; drop 0.15 per cited sentinel; if a key field is a likely artifact (e.g. impossible deep_pct), drop another 0.15.
- baseline_available (0.20): 0 if facts.sleep.baseline is null; 0.5 with <14 nights; 0.85 with 14–30; 1.0 with >30.
- metric_completeness (0.15): present_count / expected_count for HRV, breath, SpO2, HR, deep, latency, efficiency, apnea.
- apnea_index_computed (0.10): 1.0 if RDI present and finite; 0 otherwise.
- freshness (0.10): 1.0 if generated within 6h of wake; 0.5 within 36h; 0 beyond.

For snapshot/sleep: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const SleepSnapshotPrompt = {
  domain: "sleep" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: SleepSnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    if (!facts.sleep) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO SLEEP DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No sleep data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_sleep_data"].`;
    }
    const sleepFacts = {
      stages: facts.sleep.stages,
      stats: facts.sleep.stats,
      apnea: facts.sleep.apnea,
      baseline: facts.sleep.baseline,
    };
    const stages = facts.sleep.stages;
    const totalAsleep = stages.light_min + stages.rem_min + stages.deep_min;
    const derivedDeepPct = totalAsleep > 0 ? Math.round((stages.deep_min / totalAsleep) * 100) : 0;
    const derivedRemPct = totalAsleep > 0 ? Math.round((stages.rem_min / totalAsleep) * 100) : 0;
    const derivedLightPct = totalAsleep > 0 ? Math.round((stages.light_min / totalAsleep) * 100) : 0;
    const factsDeepPct = facts.sleep.stats.deep_pct;
    const deepPctMismatch =
      typeof factsDeepPct === "number" && Math.abs(factsDeepPct - derivedDeepPct) > 10;

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.sleep.stats.bedtime_iso} → ${facts.sleep.stats.wakeup_iso}
SAMPLES: ${facts.samples_seen.sleep_stage_rows} stage rows · 1 stats row · ${facts.samples_seen.apnea_rows} apnea rows
BASELINE PROVIDED: ${facts.sleep.baseline === null ? "no (set comparison.available=false, deltas=[])" : "yes"}

DERIVED (compute again to verify, but these are correct):
- total_asleep_min = ${totalAsleep}
- deep_share_pct  = ${derivedDeepPct}
- rem_share_pct   = ${derivedRemPct}
- light_share_pct = ${derivedLightPct}
${deepPctMismatch ? `- NOTE: facts.stats.deep_pct=${factsDeepPct} disagrees with derived ${derivedDeepPct}% — treat facts.stats.deep_pct as artifact and use ${derivedDeepPct}% in analysis. Add a limiter row with kind="artifact".` : ""}

FACTS:
${JSON.stringify(sleepFacts, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/sleep.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(SleepSnapshotPrompt);
