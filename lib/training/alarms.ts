import "server-only";

import { countRecurrence } from "./pain";
import type { TrainingPainFlagV1 } from "../types/generated";

/**
 * Training alarm computation. Pure Pi-side queries over PULSE_PAIN_FLAG +
 * recent session aggregates — the runner's existing v2 rules engine is
 * not extended here to keep scope tight; this module surfaces warnings
 * directly to the /training page until the alarm-bus wiring lands.
 *
 * Severity ladder matches CLAUDE.md's anomaly rule (singleton suppressed):
 *   ≥2 in window → info
 *   ≥3            → warn
 *   ≥10           → critical
 */

const PAIN_WINDOW_DAYS = 28;
const BACK_TRIGGER_THRESHOLD_4W = 3;

export interface TrainingAlarm {
  id: string;
  kind:
    | "training_pain_recurrence"
    | "training_overload"
    | "training_phase_stall";
  severity: "info" | "warn" | "critical";
  message_de: string;
  /** Optional structured context for downstream consumers. */
  context: Record<string, unknown>;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function bandForCount(count: number): TrainingAlarm["severity"] | null {
  if (count >= 10) return "critical";
  if (count >= 3) return "warn";
  if (count >= 2) return "info";
  return null;
}

const LOCATION_LABEL_DE: Record<TrainingPainFlagV1["location_code"], string> = {
  back: "Rücken",
  shoulder: "Schulter",
  elbow: "Ellenbogen",
  wrist: "Handgelenk",
  thumb: "Daumen",
  hip: "Hüfte",
  knee: "Knie",
  ankle: "Sprunggelenk",
  foot: "Fuß",
  neck: "Nacken",
  head: "Kopf",
  chest: "Brust",
  abdominal: "Bauch",
  other: "Sonstige",
};

const SIDE_LABEL_DE: Record<TrainingPainFlagV1["side"], string> = {
  left: "links",
  right: "rechts",
  bilateral: "beidseits",
  n_a: "",
};

/**
 * Returns one alarm per (location_code, side) pair that crosses the
 * info/warn/critical thresholds in the last 28 days. Caller renders them
 * in priority order (critical > warn > info).
 */
export function computePainRecurrenceAlarms(): TrainingAlarm[] {
  const since = isoDaysAgo(PAIN_WINDOW_DAYS);
  const codes: TrainingPainFlagV1["location_code"][] = [
    "back",
    "shoulder",
    "elbow",
    "wrist",
    "thumb",
    "hip",
    "knee",
    "ankle",
    "foot",
    "neck",
    "head",
    "chest",
    "abdominal",
    "other",
  ];
  const sides: TrainingPainFlagV1["side"][] = ["left", "right", "bilateral", "n_a"];
  const out: TrainingAlarm[] = [];
  for (const code of codes) {
    for (const side of sides) {
      const count = countRecurrence({
        location_code: code,
        side,
        since_iso: since,
      });
      const severity = bandForCount(count);
      if (!severity) continue;

      // Plan-document special rule: ≥3 back triggers in 4 weeks escalates
      // to critical regardless of the generic ladder (per injury_protocol).
      const isBackTrigger = code === "back";
      const effective: TrainingAlarm["severity"] =
        isBackTrigger && count >= BACK_TRIGGER_THRESHOLD_4W ? "critical" : severity;

      const sideLabel = side === "n_a" ? "" : ` ${SIDE_LABEL_DE[side]}`;
      out.push({
        id: `pain_${code}_${side}`,
        kind: "training_pain_recurrence",
        severity: effective,
        message_de:
          `${LOCATION_LABEL_DE[code]}${sideLabel}: ${count} Flag${count === 1 ? "" : "s"} in 28 Tagen` +
          (isBackTrigger && effective === "critical"
            ? " — Sportphysio-Termin gemäß Plan."
            : ""),
        context: {
          location_code: code,
          side,
          count_28d: count,
        },
      });
    }
  }
  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: TrainingAlarm["severity"]): number {
  return s === "critical" ? 3 : s === "warn" ? 2 : 1;
}
