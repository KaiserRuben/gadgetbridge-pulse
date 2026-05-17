import { AnomaliesSnapshotSchema } from "../../schemas/snapshot/anomalies.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: anomalies
KEY CONCEPTS
- Auto-detected oddities are graded by a THRESHOLD LADDER:
    count = 0 → no anomaly emitted
    count = 1 → SUPPRESSED singleton; surfaced as a "watching" item, NOT an active anomaly
    count ≥ 2 → severity "info" (active anomaly)
    count ≥ 3 → severity "warn" (active anomaly)
    count ≥ 10 → severity "critical" (active anomaly)
- Separate BIOLOGICAL anomalies (true physiological events worth flagging) from DATA-QUALITY anomalies (firmware encoding quirks, signed-byte overflow, sentinel rows).
  - HR signed-byte overflow (raw < 0, raw != -1, recovered = 256 + raw) is DATA-QUALITY, not biological. The recovered bpm itself may still be a real workout peak.
  - Negative-step samples (steps < 0, steps != -1) are DATA-QUALITY (counter wrap), not biological.
- STATIC firmware quirks (calorie unit, distance scale, minute-double encoding) live in facts.anomalies.data_notes — these are CONTEXT, never active anomalies. They MUST NOT be promoted to severity ≥ info.
- RDI=-1, min_hr=-1, max_hr=-1 etc. are DATA GAPS (sentinel rows). They are NOT anomalies for this domain — they belong to the source domain's limiters. Do not double-count them here.

DERIVED VALUES (compute these — do not just trust facts blob)
- total_active_count   = number of categories whose count ≥ 2 (i.e. promoted past the singleton suppression).
  Categories considered: hr_overflow_rows, negative_step_rows.
- total_watching_count = number of categories whose count == 1 (suppressed singletons surfaced as "watching").
- data_notes_count     = facts.anomalies.data_notes.length (always-on context; never counts as active).
- For each category, derive severity from its count using the ladder above:
    1 → "watching" (NOT an active severity; goes into upward_signals.anomalies_flagged with severity "info" only if you want to surface the singleton; otherwise omit)
    2 → "info"
    3..9 → "warn"
    ≥10 → "critical"

NORM BANDS (use these in metric_findings.norm_band)
- anomalies.hr_overflow_rows    → [0, 1]   above ⇒ active anomaly (data-quality)
- anomalies.negative_step_rows  → [0, 1]   above ⇒ active anomaly (data-quality)
- derived.total_active_count    → [0, 0]   above ⇒ negative driver (something promoted past suppression)
- derived.total_watching_count  → [0, 2]   above ⇒ neutral (singletons recurring is the signal to watch)
- derived.data_notes_count      → [0, 5]   within ⇒ neutral (always-on context)

WORKED EXAMPLE — singleton case (1 HR-overflow row, 0 negative-step rows):
- total_active_count = 0 (nothing promoted past the suppression threshold)
- total_watching_count = 1 (the lone HR overflow is a watching singleton)
- verdict.rating = "good"; verdict.score_0_100 in [80, 95]
- metric_findings entry for hr_overflow_rows uses vs_norm="above", norm_band=[0,1], delta_from_norm=0 (1 is the inclusive upper edge — call out that ladder treats 1 as suppressed-watching, not active)
- upward_signals.anomalies_flagged includes {"id":"hr_overflow_singleton","severity":"info","details":"1 HR signed-byte overflow at <ts>; recovered <bpm>; suppressed as singleton."}

WORKED EXAMPLE — promoted case (3 HR-overflow rows):
- total_active_count = 1
- severity for hr_overflow = "warn"
- verdict.rating = "fair" or "poor"; score_0_100 lower
- next_action: investigate firmware-overflow pattern (data-quality, not coaching)

WORKED EXAMPLE — drivers (singleton case):
"drivers": [
  {"metric_id":"derived.total_active_count","name":"Active anomalies","value":0,"unit":"count","direction":"positive"},
  {"metric_id":"derived.total_watching_count","name":"Watching singletons","value":1,"unit":"count","direction":"neutral"},
  {"metric_id":"derived.data_notes_count","name":"Static data notes","value":3,"unit":"count","direction":"neutral"}
]

WORKED EXAMPLE — limiters entry (typed kinds):
[{"kind":"single_window","metric_id":null,"text":"One-day snapshot — singletons cannot be distinguished from start of a recurring pattern."},
 {"kind":"sparse_sampling","metric_id":"anomalies.hr_overflow_rows","text":"Only one overflow this window; need a second to clear the ≥2 info threshold."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["no_active_anomalies","hr_overflow_watching"],
 "for_coach":[{"tag":"risk_flag","metric_id":"derived.total_active_count","weight":0.6},
              {"tag":"data_quality","metric_id":"anomalies.hr_overflow_rows","weight":0.4}],
 "for_weekly_trend":[{"metric_id":"anomalies.hr_overflow_rows","value":1},
                     {"metric_id":"anomalies.negative_step_rows","value":0},
                     {"metric_id":"derived.total_active_count","value":0}],
 "anomalies_flagged":[{"id":"hr_overflow_singleton","severity":"info",
                       "details":"1 HR signed-byte overflow at 09:29Z; recovered 131 bpm; suppressed as singleton."}]}

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- detection_window_size (0.30): 1.0 only if ≥7 days in window AND ≥1000 samples; cap at 0.5 for a single day; 0.2 if <100 samples.
- threshold_clarity (0.25): 1.0 if every active count is clearly above (≥2× the threshold) or clearly below the active threshold; 0.5 if borderline (count == threshold); 0.7 in the clean singleton-suppressed case (the ladder is unambiguous).
- biological_vs_quality_separation (0.15): 1.0 if every active anomaly is correctly tagged as biological vs data-quality with reasoning; 0.5 if mixed; 0 if conflated.
- correlation_evidence (0.15): 1.0 if anomalies cross-reference timestamps with the source domain (e.g. HR overflow falls in a workout window); 0.5 with timestamps but no domain match; 0 with neither.
- baseline_available (0.10): 0 if facts.anomalies has no historical baseline; 0.5 with <14 days; 1.0 with >30 days.
- freshness (0.05): 1.0 if generated within 6h of the latest sample; 0.5 within 36h; 0 beyond.

For snapshot/anomalies: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const AnomaliesSnapshotPrompt = {
  domain: "anomalies" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: AnomaliesSnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    const a = facts.anomalies;
    if (!a) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO ANOMALY DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No anomaly data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_anomaly_data"].`;
    }

    // ── threshold-ladder derivations (deterministic; LLM must mirror these) ──
    const categories = [
      { key: "anomalies.hr_overflow_rows", count: a.hr_overflow_rows },
      { key: "anomalies.negative_step_rows", count: a.negative_step_rows },
    ];
    const ladder = (n: number): "none" | "watching" | "info" | "warn" | "critical" => {
      if (n <= 0) return "none";
      if (n === 1) return "watching";
      if (n < 3) return "info";
      if (n < 10) return "warn";
      return "critical";
    };
    const totalActiveCount = categories.filter((c) => c.count >= 2).length;
    const totalWatchingCount = categories.filter((c) => c.count === 1).length;
    const dataNotesCount = a.data_notes.length;
    const perCategorySeverity = categories
      .map((c) => `  - ${c.key} = ${c.count} → ${ladder(c.count)}`)
      .join("\n");

    const overflowSamples =
      a.hr_overflow_samples.length > 0
        ? a.hr_overflow_samples
            .map((s) => `    · ${s.ts_iso} raw=${s.raw} recovered=${s.recovered_bpm} bpm`)
            .join("\n")
        : "    (none)";

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.data_window.start_iso} → ${facts.data_window.end_iso}
SAMPLES: ${facts.samples_seen.activity_rows} activity rows · ${facts.samples_seen.hrv_rows} hrv rows · ${facts.samples_seen.sleep_stage_rows} sleep stage rows
BASELINE PROVIDED: no (set comparison.available=false, deltas=[])

THRESHOLD LADDER PER CATEGORY (mirror these in metric_findings):
${perCategorySeverity}

DERIVED (compute again to verify, but these are correct):
- total_active_count   = ${totalActiveCount}
- total_watching_count = ${totalWatchingCount}
- data_notes_count     = ${dataNotesCount}

HR OVERFLOW SAMPLES:
${overflowSamples}

FACTS:
${JSON.stringify({ anomalies: a }, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/anomalies.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(AnomaliesSnapshotPrompt);
