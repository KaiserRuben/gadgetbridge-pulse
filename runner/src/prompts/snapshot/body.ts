import { BodySnapshotSchema } from "../../schemas/snapshot/body.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";

const ADDENDUM = `DOMAIN: body
KEY CONCEPTS
- Skin temperature is NOT core body temperature. The watch measures wrist skin only; expect 30–36 °C indoors with strong ambient/perfusion confounding. Never claim "fever" or "core temp" from this sensor.
- Skin-temp cadence is roughly 1 sample/min during wear. A "personal baseline" forms only after ≥14 nights; before that, treat absolute values cautiously and lean on intra-window range.
- Flag a delta > 0.7 °C from the personal baseline as notable (when baseline is available); without a baseline, flag intra-window range > 1.5 °C as candidate signal.
- SpO₂ on wrist optical sensors is noisy. Healthy resting band is 95–100%. A single sample <94% is rarely meaningful; sustained <94% (multiple samples / dips) is a concern.
- HRV (RMSSD) on this device runs 20–80 ms for adults; <20 ms with adequate samples is low autonomic recovery. Sample count <5 is too sparse to interpret.
- Healthy resting breath rate 12–20/min. Source here is sleep-derived (avg_breath); flag if outside band, otherwise treat as confirmation.
- "body" excludes core temperature, blood pressure, blood glucose — those are not on this device.

DERIVED VALUES (compute these — do not just trust facts blob)
- temp_range_c            = round(skin_temp.max_c - skin_temp.min_c, 2)
- spo2_dip_count           = number of facts.spo2 samples implied <96 (use spo2.min_pct as a proxy: if min_pct < 96, dips_present=true; otherwise 0). NOTE: the snapshot facts blob aggregates spo2 — when min_pct ≥ 96, set spo2_dip_count = 0; when min_pct < 96, set spo2_dip_count >= 1 and call out that exact-count requires raw rows.
- cross_sensor_present     = count of {skin_temp, spo2, hrv, breath_rate} fields that have a non-null, non-zero, non-sentinel reading. 4 = full coverage, 1 = single channel only.
- hrv_density_per_hr       = round(hrv.samples / 24, 2)  (snapshot is one day)

NORM BANDS (use these in metric_findings.norm_band)
- skin_temp.avg_c          → [30, 36]   outside ⇒ flag in limiters as likely sensor/ambient artifact, NOT clinical
- derived.temp_range_c     → [0, 1.5]   above ⇒ candidate driver (sleep/wake transition or sensor lift-off)
- spo2.avg_pct             → [95, 100]  below ⇒ negative driver candidate
- spo2.min_pct             → [94, 100]  below ⇒ negative driver candidate (cite dip)
- hrv.avg_ms               → [20, 80]   below ⇒ negative; above is generally positive but cite samples
- breath_rate_per_min      → [12, 20]   outside ⇒ flag in limiters

WORKED EXAMPLE — metric_findings entry (skin temp, no baseline):
{"metric_id":"skin_temp.avg_c","value":33.4,"unit":"°C","vs_norm":"within",
 "norm_band":[30,36],"delta_from_norm":0,
 "interpretation":"Average wrist skin temp 33.4 °C sits inside the 30–36 °C indoor wear band; without a 14-night baseline the absolute value is uninformative.",
 "reasoning_trace":["wrist skin band 30–36 °C indoors","observed 33.4","baseline=null → use range, not absolute"]}

WORKED EXAMPLE — limiters entry (typed kinds for body):
[{"kind":"single_window","metric_id":null,"text":"One-day snapshot — no personal skin-temp baseline yet (need ≥14 nights)."},
 {"kind":"sparse_sampling","metric_id":"hrv.samples","text":"HRV samples=3 in 24h; below the threshold for autonomic interpretation."},
 {"kind":"sentinel","metric_id":"breath_rate_per_min","text":"breath_rate_per_min=null; sleep stats absent so source is unavailable."}]

WORKED EXAMPLE — upward_signals entry:
{"tags":["spo2_within_band","hrv_low_density","skin_temp_baseline_pending"],
 "for_coach":[{"tag":"recovery_lever","metric_id":"hrv.avg_ms","weight":0.5},
              {"tag":"risk_flag","metric_id":"spo2.min_pct","weight":0.3}],
 "for_weekly_trend":[{"metric_id":"skin_temp.avg_c","value":33.4},
                     {"metric_id":"spo2.avg_pct","value":97},
                     {"metric_id":"hrv.avg_ms","value":42}],
 "anomalies_flagged":[{"id":"spo2_dip_present","severity":"info",
                       "details":"spo2.min_pct=92 indicates at least one dip below the 94% concern line."}]}

COOL ROOM EXAMPLE (do not over-read absolute skin temp):
A cool ambient bedroom suppresses wrist skin temp range; low intra-window variance does NOT mean a cold body, only that conduction to ambient was steady. Treat low temp_range_c with no other signals as neutral, not negative.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- sample_size (0.25): 1.0 only when skin_temp.samples ≥ 200 AND spo2.samples ≥ 50 AND hrv.samples ≥ 10. Score 0.85 for one full day with skin_temp.samples ≥ 100, drop to 0.5 if any single channel <30 samples, 0 if all channels <5.
- temp_sample_density (0.15): 1.0 if skin_temp.samples ≥ 200 (≥1 sample / 7 min over 24h). 0.6 at 50–199, 0.3 at 10–49, 0 below 10.
- data_quality (0.15): 1.0 when no -1 sentinels/nulls in fields you cite; drop 0.2 per cited sentinel/null channel; cap at 0.3 if breath_rate is null AND hrv is sparse together.
- baseline_available (0.20): 0 if facts.body.baseline is null (snapshot default); 0.5 with <14 days; 0.85 with 14–30; 1.0 with >30.
- cross_sensor_agreement (0.10): 1.0 when ≥3 of {skin_temp, spo2, hrv, breath} report inside their bands consistently; 0.5 when channels disagree (e.g. low HRV but normal SpO₂); 0 when only one channel has data.
- metric_completeness (0.05): present_count / 4 across {skin_temp, spo2, hrv, breath_rate_per_min}.
- freshness (0.10): 1.0 if generated within 6h of the data window end; 0.5 within 36h; 0 beyond.

For snapshot/body: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

export const BodySnapshotPrompt = {
  domain: "body" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: BodySnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    const body = facts.body;
    const skin = body.skin_temp;
    const spo2 = body.spo2;
    const hrv = body.hrv;
    const breath = body.breath_rate_per_min;

    const tempPresent = skin.samples > 0;
    const spo2Present = spo2.samples > 0;
    const hrvPresent = hrv.samples > 0;
    const breathPresent = breath !== null && breath !== 0 && breath !== -1;

    const crossSensorPresent =
      Number(tempPresent) + Number(spo2Present) + Number(hrvPresent) + Number(breathPresent);

    if (crossSensorPresent === 0) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO BODY DATA IN WINDOW.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No body-sensor data in window.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_body_data"].`;
    }

    const tempRange = tempPresent ? Math.round((skin.max_c - skin.min_c) * 100) / 100 : 0;
    const spo2DipPresent = spo2Present && spo2.min_pct < 96;
    const hrvDensityPerHr = hrvPresent ? Math.round((hrv.samples / 24) * 100) / 100 : 0;

    return `PERIOD: snapshot · ${facts.period_key}
DATA WINDOW: ${facts.data_window.start_iso} → ${facts.data_window.end_iso}
SAMPLES: ${facts.samples_seen.temp_rows} skin-temp rows · ${spo2.samples} spo2 rows · ${facts.samples_seen.hrv_rows} hrv rows · breath_rate ${breathPresent ? "from sleep stats" : "absent"}
BASELINE PROVIDED: ${body.baseline === null ? "no (set comparison.available=false, deltas=[])" : "yes"}

DERIVED (compute again to verify, but these are correct):
- temp_range_c        = ${tempRange}
- spo2_dip_present    = ${spo2DipPresent ? "true (min_pct < 96)" : "false (min_pct ≥ 96)"}
- cross_sensor_present = ${crossSensorPresent} of 4 channels active (skin_temp=${tempPresent}, spo2=${spo2Present}, hrv=${hrvPresent}, breath=${breathPresent})
- hrv_density_per_hr  = ${hrvDensityPerHr}

NOTE: skin temp on this watch is wrist-skin only; do NOT call it core temperature or fever. With baseline=null, lean on temp_range_c rather than absolute averages.

FACTS:
${JSON.stringify(body, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/body.json (envelope is added by the runner; emit only the schema fields).`;
  },
};

register(BodySnapshotPrompt);
