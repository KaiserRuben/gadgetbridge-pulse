import { CardioSnapshotSchema } from "../../schemas/snapshot/cardio.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: cardio
KEY CONCEPTS
- HRmax (age-predicted) = 220 − age. HR zones derived as % of HRmax:
    Z1 recovery 50–60%, Z2 aerobic 60–70%, Z3 tempo 70–80%, Z4 threshold 80–90%, Z5 VO2max 90–100%.
- Resting HR (RHR): healthy adults 50–80 bpm; trained <60. RHR drift > +5 bpm vs baseline = overreach signal.
- HRV (avg ms): healthy adults ≈ 40–100 ms (population), individual baseline matters more than absolute.
  HRV dip > 15% below baseline = autonomic stress.
- Signed-byte overflow = firmware artifact. Raw HR < 0 (but ≠ -1 sentinel) means the byte wrapped past 127;
  the true bpm = 256 + raw (e.g. raw=-125 → recovered_bpm=131). These rows are real workout HR, not noise.
- HR spread (max − min) is a coarse proxy for activity intensity range across the window.

DERIVED VALUES (compute these — do not just trust facts blob)
- hrmax_age_pred         = 220 − facts.user.age_years (round to integer)
- hr_spread_bpm          = facts.cardio.hr.max − facts.cardio.hr.min
- hr_max_pct_of_hrmax    = round(facts.cardio.hr.max / hrmax_age_pred × 100)  // peak intensity reached
- hr_avg_pct_of_hrmax    = round(facts.cardio.hr.avg / hrmax_age_pred × 100)  // average intensity
- overflow_count         = facts.cardio.signed_byte_overflow_rows.length
- recovered_bpm_max      = max recovered_bpm across overflow rows (0 if none)
- rhr_proxy_bpm          = facts.sleep?.stats.avg_hr (if present and < facts.cardio.resting_hr.avg, use it as RHR proxy)
The signed-byte overflow rows are RECOVERED real HR samples that were NOT included in cardio.hr.max
(because the SQL filter excluded HEART_RATE<0). If overflow_count > 0, the true peak HR for the window
is max(facts.cardio.hr.max, recovered_bpm_max) — use that derived peak for the metric_finding on hr.max
and add a limiter row with kind="artifact" describing the firmware overflow.

NORM BANDS (use these in metric_findings.norm_band)
- cardio.hr.avg            → [60, 90]   above ⇒ negative driver candidate (sustained tachycardia at rest)
- cardio.resting_hr.avg    → [50, 80]   above ⇒ negative (autonomic stress)
- cardio.hrv.avg_ms        → [40, 100]  below ⇒ negative (autonomic stress)
- derived.hr_max_pct_of_hrmax → [50, 100] above 100% suggests artifact; in [70, 100] = workout reached
- derived.hr_spread_bpm    → [20, 120]  below 20 ⇒ flat/low-resolution day, above 120 ⇒ workout

WORKED EXAMPLE — metric_findings entry (signed-byte overflow):
{"metric_id":"cardio.signed_byte_overflow_rows","value":1,"unit":"count","vs_norm":"artifact",
 "norm_band":[0,0],"interpretation":"One firmware overflow row recovered to 131 bpm; the true window peak is 131, not the SQL-filtered 126.",
 "reasoning_trace":["raw=-125","recovered=256+(-125)=131","exceeds cardio.hr.max=126"]}

WORKED EXAMPLE — limiters entry (typed kinds):
[{"kind":"artifact","metric_id":"cardio.signed_byte_overflow_rows","text":"One signed-byte overflow row recovered (raw=-125 → 131 bpm); not included in hr.max aggregate."},
 {"kind":"single_window","metric_id":null,"text":"One-day snapshot — no RHR drift trend yet."},
 {"kind":"sparse_sampling","metric_id":"cardio.resting_hr","text":"Only 5 RHR samples in the window; daily aggregate is fragile."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["hr_overflow_recovered","hrv_within_band","rhr_within_band"],
 "for_coach":[{"tag":"load_signal","metric_id":"cardio.hr.max","weight":0.6},
              {"tag":"recovery_lever","metric_id":"cardio.hrv.avg_ms","weight":0.4}],
 "for_weekly_trend":[{"metric_id":"cardio.hr.avg","value":76.7},
                     {"metric_id":"cardio.resting_hr.avg","value":67.4},
                     {"metric_id":"cardio.hrv.avg_ms","value":61.2}],
 "anomalies_flagged":[{"id":"signed_byte_overflow","severity":"info",
                       "details":"1 firmware overflow row at 09:29Z recovered to 131 bpm."}]}

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.20): full day coverage = ≥200 HR rows. Score 1.0 ONLY when ≥800 rows AND multi-day; cap at 0.85 for a single full day, 0.5 for partial (<100 rows).
- data_quality (0.20): score 1.0 if no -1 sentinels in fields you cite; drop 0.15 per cited sentinel; if signed-byte overflow present and not handled, drop 0.15.
- baseline_available (0.20): 0 if facts.cardio.baseline is null; 0.5 with <14 days; 0.85 with 14–30; 1.0 with >30.
- hrv_sample_density (0.15): hrv.samples / 24 (rough hourly target). 0 if <5 samples; 0.5 if 5–30; 1.0 if ≥60.
- hr_zone_coverage (0.15): how many of Z1..Z5 zones the HR range visits. 0.2 per zone touched (max 1.0). Window with hr.min in Z1 and hr.max in Z4 = 4 zones × 0.2 = 0.8.
- freshness (0.10): 1.0 if generated within 6h of window end; 0.5 within 36h; 0 beyond.

For snapshot/cardio: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const CardioSnapshotPrompt = {
  domain: "cardio" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: CardioSnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    const c = facts.cardio;
    if (!c || c.hr.samples === 0) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO CARDIO DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No cardio data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_cardio_data"].`;
    }

    const age = facts.user.age_years || 30;
    const hrmaxAgePred = Math.round(220 - age);
    const hrSpread = c.hr.max - c.hr.min;
    const hrMaxPct = hrmaxAgePred > 0 ? Math.round((c.hr.max / hrmaxAgePred) * 100) : 0;
    const hrAvgPct = hrmaxAgePred > 0 ? Math.round((c.hr.avg / hrmaxAgePred) * 100) : 0;
    const overflowCount = c.signed_byte_overflow_rows.length;
    const recoveredBpmMax =
      overflowCount > 0
        ? Math.max(...c.signed_byte_overflow_rows.map((r) => r.recovered_bpm))
        : 0;
    const truePeakBpm = Math.max(c.hr.max, recoveredBpmMax);
    const sleepRhrProxy = facts.sleep?.stats.avg_hr ?? null;

    // Zone band edges (bpm) from age-predicted HRmax
    const zoneEdge = (pct: number) => Math.round((pct / 100) * hrmaxAgePred);
    const zones = {
      z1: [zoneEdge(50), zoneEdge(60)],
      z2: [zoneEdge(60), zoneEdge(70)],
      z3: [zoneEdge(70), zoneEdge(80)],
      z4: [zoneEdge(80), zoneEdge(90)],
      z5: [zoneEdge(90), hrmaxAgePred],
    };
    // Crude zone touch: which zones does [hr.min, max-or-truePeak] span?
    const peakForZones = truePeakBpm;
    const minHr = c.hr.min;
    const zonesTouched: string[] = [];
    for (const [zname, [lo, hi]] of Object.entries(zones)) {
      if (peakForZones >= lo && minHr <= hi) zonesTouched.push(zname);
    }

    const cardioFacts = {
      hr: c.hr,
      resting_hr: c.resting_hr,
      hrv: c.hrv,
      signed_byte_overflow_rows: c.signed_byte_overflow_rows,
      baseline: c.baseline,
    };

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.data_window.start_iso} → ${facts.data_window.end_iso}
SAMPLES: ${c.hr.samples} HR rows · ${c.resting_hr.samples} RHR rows · ${c.hrv.samples} HRV rows · ${overflowCount} overflow rows
USER AGE: ${age} years
BASELINE PROVIDED: ${c.baseline === null ? "no (set comparison.available=false, deltas=[])" : "yes"}

DERIVED (compute again to verify, but these are correct):
- hrmax_age_pred       = 220 − ${age} = ${hrmaxAgePred} bpm
- hr_spread_bpm        = ${c.hr.max} − ${c.hr.min} = ${hrSpread} bpm
- hr_max_pct_of_hrmax  = ${c.hr.max}/${hrmaxAgePred} = ${hrMaxPct}%
- hr_avg_pct_of_hrmax  = ${c.hr.avg}/${hrmaxAgePred} = ${hrAvgPct}%
- overflow_count       = ${overflowCount}
- recovered_bpm_max    = ${recoveredBpmMax}
- true_peak_bpm        = max(hr.max=${c.hr.max}, recovered_bpm_max=${recoveredBpmMax}) = ${truePeakBpm}
- zone_edges (bpm)     = Z1[${zones.z1[0]}-${zones.z1[1]}] Z2[${zones.z2[0]}-${zones.z2[1]}] Z3[${zones.z3[0]}-${zones.z3[1]}] Z4[${zones.z4[0]}-${zones.z4[1]}] Z5[${zones.z5[0]}-${hrmaxAgePred}]
- zones_touched        = [${zonesTouched.join(", ")}] (${zonesTouched.length}/5)
${sleepRhrProxy !== null ? `- sleep_avg_hr_rhr_proxy = ${sleepRhrProxy} bpm (sleep avg HR; often lower than daytime RHR=${c.resting_hr.avg})` : ""}
${overflowCount > 0 ? `- NOTE: ${overflowCount} signed-byte overflow row(s) present; recovered_bpm_max=${recoveredBpmMax} EXCEEDS the SQL-filtered hr.max=${c.hr.max}. Treat ${truePeakBpm} as the true window peak, add a limiter with kind="artifact", and call this out in metric_findings (vs_norm="artifact" on the overflow row, but use the recovered value for hr.max interpretation).` : ""}

FACTS:
${JSON.stringify(cardioFacts, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/cardio.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(CardioSnapshotPrompt);
