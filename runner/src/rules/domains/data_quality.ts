/**
 * Data-quality + step-change detector domain.
 *
 * Two responsibilities:
 *
 *  1. Surface info-tier observations when input data is sparse, anomalous,
 *     or otherwise untrustworthy. These observations carry tier=null and
 *     do not gate alarms — they exist so the prose stage can name the
 *     uncertainty out loud rather than papering over it.
 *
 *  2. Detect step-changes (DST transition, firmware update, large bedtime
 *     shift) and emit an info observation. The actual *suspension* of
 *     other rules happens via `pause.step_change_detected_on` which is
 *     written by Stage 0 — this rule simply *names* the event.
 *
 * Step-change triggers:
 *   - DST transition in the last 5 days (recent_dst_transition_iso)
 *   - Firmware change recorded by Stage 0 (last_firmware_change_iso)
 *   - Bedtime shift > 60 min in 1 day (compare last two entries of
 *     `bedtime_min_7d`)
 */

import type { Observation, RuleEngineInput } from "../types.ts";
import { compact } from "../stats.ts";
import { buildObservation, factor } from "../build.ts";
import { daysSince, localDateFromIso } from "../suppression.ts";

function dqWindow(input: RuleEngineInput) {
  return {
    start_iso: input.facts.data_window.start_iso,
    end_iso: input.facts.data_window.end_iso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic data quality
// ─────────────────────────────────────────────────────────────────────────────

export function runDataQuality(input: RuleEngineInput): Observation[] {
  const out: Observation[] = [];
  const win = dqWindow(input);
  const facts = input.facts;

  // HR overflow rows
  if (facts.anomalies.hr_overflow_rows > 0) {
    out.push(
      buildObservation({
        id: "data_quality_hr_overflow",
        domain: "data_quality",
        severity: "info",
        tier: null,
        metric_id: "anomalies.hr_overflow_rows",
        evidence: ["anomalies.hr_overflow_rows"],
        window: win,
        text_for_llm: `${facts.anomalies.hr_overflow_rows} heart-rate samples exceeded the sensor's reporting range (overflow). Numbers may be conservative.`,
        direction: "flat",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, 0.5, ""),
          factor("signal_quality", 0.4, 0.3, "Sensor overflow"),
          factor("persistence_gate", 0.3, 1.0, "Direct count"),
        ],
      }),
    );
  }

  // Sparse domain signals (signal_quality.ok === false)
  for (const [domain, sq] of [
    ["sleep", facts.sleep?.signal_quality],
    ["cardio", facts.cardio.signal_quality],
    ["stress", facts.stress.signal_quality],
    ["activity", facts.activity.signal_quality],
    ["body", facts.body.signal_quality],
  ] as const) {
    if (!sq) continue;
    if (sq.ok) continue;
    const issues = sq.issues.length > 0 ? sq.issues.join("; ") : "unspecified";
    out.push(
      buildObservation({
        id: `data_quality_${domain}_degraded`,
        domain: "data_quality",
        severity: "info",
        tier: null,
        metric_id: `${domain}.signal_quality`,
        evidence: [`${domain}.signal_quality`],
        window: win,
        text_for_llm: `${domain} signal quality flagged: ${issues}. Pattern observations from this domain are de-rated.`,
        direction: "flat",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, 0.5, ""),
          factor("signal_quality", 0.4, 0.3, "Degraded"),
          factor("persistence_gate", 0.3, 1.0, "Direct flag"),
        ],
      }),
    );
  }

  // Wear-time too low: 5-min window-presence coverage. Threshold unchanged at
  // <80% of 86400. The denominator was the bug; now fixed by the profile query.
  const wear = facts.device.wear_seconds_24h;
  if (typeof wear === "number" && wear > 0 && wear < 24 * 3600 * 0.8) {
    const wearPct = (wear / (24 * 3600)) * 100;

    // Pull specific gap windows from data_notes for actionable LLM framing.
    const gapNote = facts.anomalies.data_notes.find((n) => n.startsWith("wear_gaps:"));
    const gapDetail = gapNote
      ? ` Significant gaps (≥30 min): ${gapNote.slice("wear_gaps:".length).replace(/,/g, ", ")}.`
      : "";

    out.push(
      buildObservation({
        id: "data_quality_wear_low",
        domain: "data_quality",
        severity: "info",
        tier: null,
        metric_id: "device.wear_seconds_24h",
        evidence: ["device.wear_seconds_24h"],
        window: win,
        text_for_llm: `Device wear coverage ${wearPct.toFixed(0)}% of the day (<80%). Sleep and stress numbers may underrepresent.${gapDetail}`,
        direction: "flat",
        confidence_factors: [
          factor("baseline_window_coverage", 0.3, 0.5, ""),
          factor("signal_quality", 0.4, wearPct / 100, `${wearPct.toFixed(0)}% wear`),
          factor("persistence_gate", 0.3, 1.0, "Direct"),
        ],
      }),
    );
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step-change detector
// ─────────────────────────────────────────────────────────────────────────────

export function runStepChangeDetector(input: RuleEngineInput): Observation[] {
  const out: Observation[] = [];
  const win = dqWindow(input);
  const today = localDateFromIso(input.currentLocalTime);

  // 1. DST transition recently?
  const dst = input.history.recent_dst_transition_iso ?? null;
  if (dst) {
    const age = daysSince(dst, today);
    if (age >= 0 && age <= 5) {
      out.push(
        buildObservation({
          id: "step_change_dst",
          domain: "data_quality",
          severity: "info",
          tier: null,
          metric_id: "system.step_change",
          evidence: ["system.step_change"],
          window: win,
          text_for_llm: `DST transition on ${dst} (${age}d ago). Pattern alarms suspended for 5 days (S2) / 3 days (S3).`,
          direction: "flat",
          confidence_factors: [
            factor("baseline_window_coverage", 0.3, 1.0, "Calendar-based"),
            factor("signal_quality", 0.3, 1.0, ""),
            factor("persistence_gate", 0.4, 1.0, "Direct event"),
          ],
        }),
      );
    }
  }

  // 2. Firmware change?
  const fw = input.history.last_firmware_change_iso ?? null;
  if (fw) {
    const age = daysSince(fw, today);
    if (age >= 0 && age <= 5) {
      out.push(
        buildObservation({
          id: "step_change_firmware",
          domain: "data_quality",
          severity: "info",
          tier: null,
          metric_id: "system.step_change",
          evidence: ["system.step_change"],
          window: win,
          text_for_llm: `Device firmware changed on ${fw} (${age}d ago). Sensor calibration may have shifted; pattern alarms suspended.`,
          direction: "flat",
          confidence_factors: [
            factor("baseline_window_coverage", 0.3, 1.0, ""),
            factor("signal_quality", 0.3, 1.0, ""),
            factor("persistence_gate", 0.4, 1.0, "Direct event"),
          ],
        }),
      );
    }
  }

  // 3. Large 1-day bedtime shift (>60 min) — travel or schedule jump.
  const bt = compact(input.history.bedtime_min_7d ?? []);
  if (bt.length >= 2) {
    const a = bt[bt.length - 2];
    const b = bt[bt.length - 1];
    const shift = Math.abs(b - a);
    if (shift > 60) {
      out.push(
        buildObservation({
          id: "step_change_bedtime_shift",
          domain: "data_quality",
          severity: "info",
          tier: null,
          metric_id: "sleep.bedtime_min",
          evidence: ["sleep.bedtime_min"],
          window: win,
          text_for_llm: `Bedtime shifted by ${Math.round(shift)} min day-over-day (possible travel or schedule change).`,
          direction: "flat",
          confidence_factors: [
            factor("baseline_window_coverage", 0.3, 0.7, ""),
            factor("signal_quality", 0.3, 0.8, ""),
            factor("persistence_gate", 0.4, 1.0, "Direct delta"),
          ],
        }),
      );
    }
  }

  return out;
}

export function runDataQualityDomain(input: RuleEngineInput): Observation[] {
  return [...runDataQuality(input), ...runStepChangeDetector(input)];
}
