import "server-only";
import { getActivityMinutes } from "./queries/activity";
import type { Anomaly } from "./types";

/**
 * Threshold for elevating a recurring oddity to a "warn" anomaly.
 * Singletons are suppressed; 2+ becomes "info"; threshold+ becomes "warn".
 */
const WARN_THRESHOLD = 3;

export type DataNote = {
  id: string;
  title: string;
  detail: string;
};

/**
 * Always-on contextual notes about how the watch / firmware encodes data.
 * Not thresholded; not "anomalies" — these are stable known quirks.
 */
export function getDataNotes(): DataNote[] {
  return [
    {
      id: "calorie-unit",
      title: "Calorie counter is firmware-raw, not kcal",
      detail:
        "Huawei firmware passes through a raw counter. Treat absolute numbers with skepticism; trends are still meaningful.",
    },
    {
      id: "distance-scale",
      title: "Distance stored in centimetres",
      detail:
        "Gadgetbridge's DAO multiplies metres by 100 before storing. Charts and totals divide back to metres.",
    },
    {
      id: "minute-double",
      title: "Each minute stored twice",
      detail:
        "Activity samples are written as a forward (real) row and a backward (sentinel −1) row. Queries filter to forward only.",
    },
  ];
}

/**
 * Auto-detected anomalies. Threshold-gated: a single oddity is suppressed,
 * a small cluster is informational, and ≥{WARN_THRESHOLD} becomes a warning.
 *
 * @param dateKey  Optional `YYYY-MM-DD`. When provided, scans only that
 *                 Europe/Berlin civil day's window. Without it, scans the
 *                 entire DB — only meaningful for historical state.
 */
export function detectAnomalies(dateKey?: string): Anomaly[] {
  const opts = dateKey ? dayBoundsSec(dateKey) : undefined;
  const rows = getActivityMinutes(opts);
  const out: Anomaly[] = [];

  // Signed-byte HR overflow: hr < 0 but not the −1 sentinel.
  const hrOverflow = rows.filter((r) => r.hr < 0 && r.hr !== -1);
  if (hrOverflow.length >= 2) {
    out.push({
      id: "hr-overflow",
      severity: hrOverflow.length >= WARN_THRESHOLD ? "warn" : "info",
      title:
        hrOverflow.length >= WARN_THRESHOLD
          ? `Heart-rate signed-byte overflow · ${hrOverflow.length} samples`
          : `Heart-rate signed-byte overflow forming · ${hrOverflow.length} samples`,
      detail:
        hrOverflow.length >= WARN_THRESHOLD
          ? "Firmware exceeded 127 bpm during workout and stored a negative byte. Pattern is recurring — worth investigating."
          : "A handful of samples wrapped to negative when bpm exceeded 127. Watching for further occurrences.",
    });
  }

  // Negative-step samples (not the −1 sentinel).
  const negSteps = rows.filter((r) => r.steps < 0 && r.steps !== -1);
  if (negSteps.length >= 2) {
    out.push({
      id: "steps-negative",
      severity: negSteps.length >= WARN_THRESHOLD ? "warn" : "info",
      title: `Negative step samples · ${negSteps.length}`,
      detail:
        negSteps.length >= WARN_THRESHOLD
          ? "Step counter wrapped negative repeatedly. Daily totals require correction."
          : "Step counter wrapped negative on a small cluster of samples.",
    });
  }

  return out;
}

/**
 * Compute UTC seconds bounds for the given local civil day (Europe/Berlin).
 * Mirrors the runner's `dayWindow()` semantics so dashboard reads line up
 * with daily insights.
 */
function dayBoundsSec(dateKey: string): { since: number; until: number } {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Construct local-midnight via UTC offset lookup.
  const midnightUtcGuess = new Date(Date.UTC(y, m - 1, d));
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(midnightUtcGuess);
  const offsetStr =
    parts.find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") ?? "+0";
  const offsetHours = Number(offsetStr) || 0;
  const since = Math.floor(midnightUtcGuess.getTime() / 1000) - offsetHours * 3600;
  const until = since + 86400;
  return { since, until };
}

/** Suppressed singletons — useful for a "watching" subsection. */
export function getSuppressedSingletons(dateKey?: string): Anomaly[] {
  const opts = dateKey ? dayBoundsSec(dateKey) : undefined;
  const rows = getActivityMinutes(opts);
  const out: Anomaly[] = [];

  const hrOverflow = rows.filter((r) => r.hr < 0 && r.hr !== -1);
  if (hrOverflow.length === 1) {
    const r = hrOverflow[0];
    const realBpm = 256 + r.hr;
    const ts = new Date(r.ts * 1000);
    out.push({
      id: "hr-overflow-single",
      severity: "info",
      title: `Single HR overflow · raw ${r.hr} → ${realBpm} bpm`,
      detail: `One sample at ${ts.toISOString().slice(11, 16)} UTC wrapped to negative — likely a ${realBpm} bpm peak in a workout. Suppressed unless it recurs.`,
    });
  }

  const negSteps = rows.filter((r) => r.steps < 0 && r.steps !== -1);
  if (negSteps.length === 1) {
    out.push({
      id: "steps-negative-single",
      severity: "info",
      title: "Single negative step sample",
      detail: "One isolated wrap. Suppressed unless it recurs.",
    });
  }

  return out;
}
