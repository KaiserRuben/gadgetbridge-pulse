import "server-only";
import {
  classifyWorkout,
  type HrZoneKey,
  type WorkoutHRStats,
  type WorkoutSummary,
} from "./workouts";

/**
 * Workout-stitching: groups consecutive workouts of the same *device-reported*
 * (raw) type whose gap is ≤ STITCH_GAP_MAX_SEC. Captures the auto-pause /
 * lap-restart pattern where a single hike becomes 3 separate WORKOUT_IDs.
 *
 * Grouping uses rawType because per-member reclassification can differ when
 * one segment is flat (e.g. valley tail of a hike): a hike + walking tail
 * would otherwise split. The stitched aggregate is reclassified on combined
 * distance/duration/elevation so the session label reflects the whole effort,
 * while members keep their own effective-type badges for sectioning.
 */

export const STITCH_GAP_MAX_SEC = 20 * 60;

export type StitchedSession = {
  id: string;                  // synthesized: "stitch_<firstId>_<lastId>" or "single_<id>"
  isStitched: boolean;
  members: WorkoutSummary[];   // chronological (oldest → newest)
  primaryId: number;           // longest member → drill-down target
  type: number;
  typeLabel: string;
  typeIcon: string;
  reclassifiedAny: boolean;
  startTs: number;             // first member's start
  endTs: number;               // last member's end
  durationSec: number;         // sum of member durations (ignores gaps)
  spanSec: number;             // endTs - startTs (includes gaps)
  distanceM: number;
  steps: number;
  calories: number;
  hrMin: number | null;
  hrMax: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  altitudeMin: number | null;
  altitudeMax: number | null;
  workoutLoadSum: number | null;
  trainingPointsSum: number | null;
  gpxPaths: string[];          // chronological; used by stitched-track loader
  /**
   * Aggregated HR stats across stitched members, or null when no per-workout
   * HR data was supplied (default for `stitchWorkouts`; populated by
   * `stitchWorkoutsWithHR`). avg/drift are duration-weighted; zone_secs are
   * summed; max/min are extremes across members.
   */
  hrStats: WorkoutHRStats | null;
};

function pickLongest(ms: WorkoutSummary[]): number {
  let best = ms[0];
  for (const m of ms) if (m.durationSec > best.durationSec) best = m;
  return best.id;
}

function maybeMin(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}
function maybeMax(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}
function maybeSum(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function aggregateHrStats(
  members: WorkoutSummary[],
  hrByWorkoutId: Map<number, WorkoutHRStats>,
): WorkoutHRStats | null {
  const present: Array<{ stats: WorkoutHRStats; weight: number }> = [];
  for (const m of members) {
    const s = hrByWorkoutId.get(m.id);
    if (s) present.push({ stats: s, weight: m.durationSec });
  }
  if (present.length === 0) return null;
  const zones: Record<HrZoneKey, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let weightedAvgNum = 0;
  let weightSum = 0;
  let weightedDriftNum = 0;
  let driftWeight = 0;
  let samples = 0;
  let max: number | null = null;
  let min: number | null = null;
  for (const { stats, weight } of present) {
    for (const k of ["z1", "z2", "z3", "z4", "z5"] as HrZoneKey[]) {
      zones[k] += stats.zone_secs[k];
    }
    if (stats.avg != null && weight > 0) {
      weightedAvgNum += stats.avg * weight;
      weightSum += weight;
    }
    if (stats.drift_bpm_per_min != null && weight > 0) {
      weightedDriftNum += stats.drift_bpm_per_min * weight;
      driftWeight += weight;
    }
    samples += stats.samples;
    if (stats.max != null) max = max == null ? stats.max : Math.max(max, stats.max);
    if (stats.min != null) min = min == null ? stats.min : Math.min(min, stats.min);
  }
  const avg = weightSum > 0 ? +(weightedAvgNum / weightSum).toFixed(1) : null;
  const drift = driftWeight > 0 ? +(weightedDriftNum / driftWeight).toFixed(2) : null;
  return { avg, max, min, samples, zone_secs: zones, drift_bpm_per_min: drift };
}

function aggregate(
  members: WorkoutSummary[],
  hrByWorkoutId?: Map<number, WorkoutHRStats>,
): StitchedSession {
  const sorted = [...members].sort((x, y) => x.startTs - y.startTs);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const isStitched = sorted.length > 1;
  const primaryId = pickLongest(sorted);
  const id = isStitched
    ? `stitch_${first.id}_${last.id}`
    : `single_${first.id}`;
  const rawType = first.rawType;

  let hrMin: number | null = null;
  let hrMax: number | null = null;
  let altMin: number | null = null;
  let altMax: number | null = null;
  let elevGain: number | null = null;
  let elevLoss: number | null = null;
  let load: number | null = null;
  let tp: number | null = null;
  let distance = 0;
  let duration = 0;
  let steps = 0;
  let calories = 0;
  const gpxPaths: string[] = [];
  let reclassifiedAny = false;

  for (const m of sorted) {
    distance += m.distanceM;
    duration += m.durationSec;
    steps += m.steps;
    calories += m.calories;
    hrMin = maybeMin(hrMin, m.hrMin);
    hrMax = maybeMax(hrMax, m.hrMax);
    altMin = maybeMin(altMin, m.altitudeMin);
    altMax = maybeMax(altMax, m.altitudeMax);
    elevGain = maybeSum(elevGain, m.elevationGain);
    elevLoss = maybeSum(elevLoss, m.elevationLoss);
    load = maybeSum(load, m.workoutLoad);
    tp = maybeSum(tp, m.trainingPoints);
    if (m.gpxPath) gpxPaths.push(m.gpxPath);
    if (m.reclassified) reclassifiedAny = true;
  }

  // Reclassify on the aggregate so a hike with a flat tail still labels as hike.
  const aggCls = classifyWorkout({
    type: rawType,
    distanceM: distance,
    durationSec: duration,
    elevationGain: elevGain,
  });

  return {
    id,
    isStitched,
    members: sorted,
    primaryId,
    type: aggCls.type,
    typeLabel: aggCls.label,
    typeIcon: aggCls.icon,
    reclassifiedAny: reclassifiedAny || aggCls.reclassified,
    startTs: first.startTs,
    endTs: last.endTs,
    durationSec: duration,
    spanSec: last.endTs - first.startTs,
    distanceM: distance,
    steps,
    calories,
    hrMin,
    hrMax,
    elevationGain: elevGain,
    elevationLoss: elevLoss,
    altitudeMin: altMin,
    altitudeMax: altMax,
    workoutLoadSum: load,
    trainingPointsSum: tp,
    gpxPaths,
    hrStats: hrByWorkoutId ? aggregateHrStats(sorted, hrByWorkoutId) : null,
  };
}

/**
 * Group workouts into stitched sessions. Input does not need to be sorted.
 * Output is sorted newest → oldest by start timestamp.
 */
export function stitchWorkouts(
  workouts: WorkoutSummary[],
  opts?: { maxGapSec?: number },
): StitchedSession[] {
  if (workouts.length === 0) return [];
  const maxGap = opts?.maxGapSec ?? STITCH_GAP_MAX_SEC;
  const sortedAsc = [...workouts].sort((a, b) => a.startTs - b.startTs);

  const groups: WorkoutSummary[][] = [];
  let current: WorkoutSummary[] = [sortedAsc[0]];
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = current[current.length - 1];
    const next = sortedAsc[i];
    const gap = next.startTs - prev.endTs;
    if (next.rawType === prev.rawType && gap >= 0 && gap <= maxGap) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);

  const sessions = groups.map((g) => aggregate(g));
  // Newest first for list UIs.
  return sessions.sort((a, b) => b.startTs - a.startTs);
}

/**
 * Same grouping as `stitchWorkouts` but additionally aggregates HR stats
 * across stitched members using a caller-supplied per-workout map. Use this
 * when the consumer (detail page, heart-domain links) already has HR stats
 * loaded and wants them combined for the stitched session.
 */
export function stitchWorkoutsWithHR(
  workouts: WorkoutSummary[],
  hrStatsByWorkoutId: Map<number, WorkoutHRStats>,
  opts?: { maxGapSec?: number },
): StitchedSession[] {
  if (workouts.length === 0) return [];
  const maxGap = opts?.maxGapSec ?? STITCH_GAP_MAX_SEC;
  const sortedAsc = [...workouts].sort((a, b) => a.startTs - b.startTs);

  const groups: WorkoutSummary[][] = [];
  let current: WorkoutSummary[] = [sortedAsc[0]];
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = current[current.length - 1];
    const next = sortedAsc[i];
    const gap = next.startTs - prev.endTs;
    if (next.rawType === prev.rawType && gap >= 0 && gap <= maxGap) {
      current.push(next);
    } else {
      groups.push(current);
      current = [next];
    }
  }
  groups.push(current);

  const sessions = groups.map((g) => aggregate(g, hrStatsByWorkoutId));
  return sessions.sort((a, b) => b.startTs - a.startTs);
}
