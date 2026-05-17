import { StressSnapshotSchema } from "../../schemas/snapshot/stress.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: stress
KEY CONCEPTS
- Stress score is an autonomic-strain index 0–100 derived from HR/HRV/motion.
- Buckets: 0–29 relaxed · 30–59 mild · 60–79 moderate · 80–100 high.
  CAUTION: these are STRESS-VALUE BUCKETS, not verdict ratings.
  verdict.rating MUST be exactly one of {poor | fair | good | excellent}. NEVER "mild", "moderate", "relaxed", or "high".
  Map: mostly relaxed (avg < 30, no high bucket) → "good" or "excellent". mostly mild (avg 30–59) → "fair" or "good". moderate-heavy → "fair". any sustained high → "poor".
- Sampling is SPARSE (~30/day for a watch worn most of the day). A single 70 reading among 30 relaxed samples is NOISE unless the same hour recurs across days.
- Time-of-day matters: a morning cortisol bump differs from a 22:00 spike (sleep onset risk). NEVER treat all peaks as equal.
- During sleep the watch reports very low values; expect waking-hour samples to be ~70% of the day's count when the band is worn well.

DERIVED VALUES (compute these — do not just trust facts blob)
- peak_local_hour          = Berlin local hour of facts.peak.ts_iso (UTC + 2 in May; UTC + 1 otherwise). 0..23.
- time_in_high_pct         = facts.distribution_pct.high (renamed to make the rubric explicit).
- time_in_moderate_pct     = facts.distribution_pct.moderate.
- sample_density_per_hour  = round(facts.samples / window_hours, 2). window_hours comes from data_window.
- waking_share_pct         = if you can estimate it (peak hour daytime + density), otherwise null. Do NOT fabricate.

NORM BANDS (use these in metric_findings.norm_band)
- avg                          → [0, 40]   above ⇒ negative driver candidate
- distribution_pct.relaxed     → [40, 100] below ⇒ negative
- distribution_pct.high        → [0, 5]    above ⇒ negative (sustained sympathetic load)
- distribution_pct.moderate    → [0, 25]   above ⇒ neutral/negative depending on context
- peak.value                   → [0, 60]   above ⇒ flag in metric_findings; one isolated peak is rarely a driver on its own
- sample_density_per_hour      → [1.5, 6]  below ⇒ sparse_sampling limiter; above ⇒ no concern

WORKED EXAMPLE — metric_findings entry (high-share concern):
{"metric_id":"distribution_pct.high","value":12,"unit":"pct","vs_norm":"above",
 "norm_band":[0,5],"delta_from_norm":7,
 "interpretation":"12% of samples sit in the 80–100 band; sustained sympathetic load rather than a single spike.",
 "reasoning_trace":["band 0–5%","observed 12%","ratio 2.4× ceiling"]}

WORKED EXAMPLE — metric_findings entry (single-peak, no driver):
{"metric_id":"peak.value","value":63,"unit":"0-100","vs_norm":"above",
 "norm_band":[0,60],"delta_from_norm":3,
 "interpretation":"One reading at 63 (moderate band) at 22:02 local; isolated within 29 samples — noise unless recurring.",
 "reasoning_trace":["one sample of 29","barely above 60","facts.distribution_pct.high=0"]}

WORKED EXAMPLE — limiters entry (typed kinds):
[{"kind":"sparse_sampling","metric_id":"samples","text":"Only 29 stress samples across the 16h window (~1.8/h); single-point readings cannot be trended."},
 {"kind":"single_window","metric_id":null,"text":"One-day snapshot — diurnal pattern across multiple days not yet visible."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["stress_avg_low","peak_evening","sparse_stress_samples"],
 "for_coach":[{"tag":"recovery_lever","metric_id":"distribution_pct.high","weight":0.4},
              {"tag":"load_signal","metric_id":"avg","weight":0.5}],
 "for_weekly_trend":[{"metric_id":"avg","value":39},
                     {"metric_id":"distribution_pct.high","value":0},
                     {"metric_id":"peak.value","value":63}],
 "anomalies_flagged":[]}

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): score 1.0 only with ≥48 samples AND multiple days. Cap at 0.7 for a single full-day window with ~30 samples; 0.4 if <20.
- sample_density_per_hour (0.20): 1.0 if ≥3/h, 0.7 if 1.5–3, 0.4 if 0.5–1.5, 0 if <0.5.
- data_quality (0.15): 1.0 if no sentinels in cited fields and peak.ts_iso is plausible (not at 03:00 with 0 daytime samples). Drop 0.2 per cited sentinel.
- baseline_available (0.15): 0 if facts.stress.baseline is null; 0.5 with <14 days; 0.85 with 14–30; 1.0 with >30.
- coverage_balance (0.15): 1.0 if waking-hour samples roughly match the band's expected ~70% of total. 0.5 if facts cover only part of the day. 0 if window starts late afternoon (no morning data).
- freshness (0.10): 1.0 if generated within 6h of window end; 0.5 within 36h; 0 beyond.

For snapshot/stress: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const StressSnapshotPrompt = {
  domain: "stress" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: StressSnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    const stress = facts.stress;
    if (!stress || stress.samples === 0) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO STRESS DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No stress data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_stress_data"].`;
    }

    const startMs = Date.parse(facts.data_window.start_iso);
    const endMs = Date.parse(facts.data_window.end_iso);
    const windowHours = Math.max(1, Math.round(((endMs - startMs) / 3600_000) * 100) / 100);
    const density = Math.round((stress.samples / windowHours) * 100) / 100;

    let peakLocalHour: number | null = null;
    if (stress.peak) {
      const d = new Date(stress.peak.ts_iso);
      const month = d.getUTCMonth(); // 0-Jan .. 11-Dec
      // Europe/Berlin: DST roughly Apr–Oct → +2; else +1. Same heuristic the facts builder uses.
      const dstActive = month >= 3 && month <= 9;
      peakLocalHour = (d.getUTCHours() + (dstActive ? 2 : 1)) % 24;
    }

    const dist = stress.distribution_pct;
    const timeInHighPct = dist.high;
    const timeInModeratePct = dist.moderate;

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.data_window.start_iso} → ${facts.data_window.end_iso} (${windowHours}h)
SAMPLES: ${stress.samples} stress rows
BASELINE PROVIDED: ${stress.baseline === null ? "no (set comparison.available=false, deltas=[])" : "yes"}

DERIVED (compute again to verify, but these are correct):
- window_hours              = ${windowHours}
- sample_density_per_hour   = ${density}
- peak_local_hour           = ${peakLocalHour === null ? "null (no peak)" : peakLocalHour}
- time_in_high_pct          = ${timeInHighPct}
- time_in_moderate_pct      = ${timeInModeratePct}

FACTS:
${JSON.stringify(stress, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/stress.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(StressSnapshotPrompt);
