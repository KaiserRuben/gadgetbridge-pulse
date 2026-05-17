import "server-only";

import { getWorkouts, type WorkoutSummary } from "../queries/workouts";
import type { WearableCandidate } from "./wearable-stitch";

/**
 * Pull wearable workout candidates from Gadgetbridge.db around a session
 * window. Returns up to `limit` candidates whose start falls within ±2h of
 * the session — wide enough to catch detector lag, narrow enough to avoid
 * scanning the entire day.
 *
 * The wake-date period key derivation lives in period.ts on the runner
 * side; the Next.js side computes a simpler "calendar day in Europe/Berlin"
 * key here, which is enough for the same-period-key guard since both inputs
 * are converted the same way.
 */

const NEIGHBOURHOOD_SEC = 2 * 60 * 60;

function calendarPeriodKey(unixSec: number, timezone = "Europe/Berlin"): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(unixSec * 1000));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function toCandidate(w: WorkoutSummary): WearableCandidate {
  return {
    id: w.id,
    startTs: w.startTs,
    endTs: w.endTs,
    periodKey: calendarPeriodKey(w.startTs),
    typeLabel: w.typeLabel,
  };
}

export function loadCandidatesAround(
  sessionStartIso: string,
  sessionCompletedIso: string | null,
): WearableCandidate[] {
  const sStart = Math.floor(new Date(sessionStartIso).getTime() / 1000);
  const sEnd = sessionCompletedIso
    ? Math.floor(new Date(sessionCompletedIso).getTime() / 1000)
    : sStart + 90 * 60;
  const since = sStart - NEIGHBOURHOOD_SEC;
  const until = sEnd + NEIGHBOURHOOD_SEC;
  const workouts = getWorkouts({ sinceSec: since, untilSec: until, limit: 50 });
  return workouts.map(toCandidate);
}
