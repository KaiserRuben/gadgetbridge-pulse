/**
 * Post-workout packager.
 *
 * Unlike the daily slots, this one is *event-scoped* — the event handler
 * passes the specific WorkoutRef when the package is built. Multiple
 * post_workout SlotEntries can coexist per day, keyed by `event_id`
 * (the workout's `ts_start_iso`).
 *
 * Input shape:
 *   tier1_snapshot               — full tier1
 *   prior                        — empty (no deps)
 *   domain.workout               — the workout being reflected on
 *   domain.recent_workouts_14d   — last ~14 days summary for vs_recent prose
 */

import type Database from "better-sqlite3";

import { shortHash, type SlotBuildContext, type SlotPackage } from "../_shared.ts";
import type { KpiWorkout } from "../../types.ts";

export interface PostWorkoutEventRef {
  event_id: string;           // workout's ts_start_iso
  ts_start_iso: string;
  ts_end_iso: string;
  kind: number;
}

export interface PostWorkoutDomain {
  workout: PostWorkoutWorkout;
  recent_workouts_14d: RecentWorkoutSummary[];
}

export interface PostWorkoutWorkout extends KpiWorkout {
  /** Optional rich summary (aerobic_training_effect, recovery_time, etc.). */
  aerobic_training_effect: number | null;
  anaerobic_training_effect: number | null;
  recovery_time_h: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
}

export interface RecentWorkoutSummary {
  ts_start_iso: string;
  kind: number;
  duration_min: number;
  workout_load: number | null;
  active_kcal: number | null;
}

export type PostWorkoutPackage = SlotPackage<PostWorkoutDomain>;

export interface BuildPostWorkoutOpts {
  ctx: SlotBuildContext;
  event: PostWorkoutEventRef;
}

export async function buildPostWorkoutPackage(
  opts: BuildPostWorkoutOpts,
): Promise<PostWorkoutPackage> {
  const { ctx, event } = opts;
  const workout = readWorkout(ctx.db, event);
  const recent = readRecentWorkouts(ctx.db, event.ts_start_iso);

  return {
    meta: {
      period_key: ctx.period_key,
      generated_at: ctx.now.toISOString(),
      tz: ctx.tz,
      package_version: "post-workout-package/v1",
    },
    tier1_snapshot: ctx.tier1,
    prior: {},
    domain: {
      workout,
      recent_workouts_14d: recent,
    },
  };
}

export function postWorkoutFactsHash(pkg: PostWorkoutPackage): string {
  return shortHash({
    period_key: pkg.meta.period_key,
    workout_start: pkg.domain.workout.ts_start_iso,
    workout_load: pkg.domain.workout.workout_load,
    kind: pkg.domain.workout.kind,
  });
}

// ── DB reads ─────────────────────────────────────────────────────────────

interface SummaryRow {
  START_TIME: number;
  END_TIME: number;
  ACTIVITY_KIND: number;
  NAME: string | null;
  SUMMARY_DATA: string | null;
}

function readWorkout(db: Database.Database, event: PostWorkoutEventRef): PostWorkoutWorkout {
  const startMs = Date.parse(event.ts_start_iso);
  const row = db
    .prepare<[number], SummaryRow>(
      `SELECT START_TIME, END_TIME, ACTIVITY_KIND, NAME, SUMMARY_DATA
       FROM BASE_ACTIVITY_SUMMARY
       WHERE START_TIME = ?
       LIMIT 1`,
    )
    .get(startMs);
  if (!row) {
    return {
      ts_start_iso: event.ts_start_iso,
      ts_end_iso: event.ts_end_iso,
      kind: event.kind,
      duration_min: 0,
      distance_m: null,
      active_kcal: null,
      workout_load: null,
      name: null,
      aerobic_training_effect: null,
      anaerobic_training_effect: null,
      recovery_time_h: null,
      avg_hr_bpm: null,
      max_hr_bpm: null,
    };
  }
  const sd = parseSummary(row.SUMMARY_DATA);
  const dur = Math.max(0, Math.round((row.END_TIME - row.START_TIME) / 60_000));
  return {
    ts_start_iso: event.ts_start_iso,
    ts_end_iso: event.ts_end_iso,
    kind: row.ACTIVITY_KIND,
    duration_min: dur,
    distance_m: nf(sd, "distanceMeters"),
    active_kcal: nf(sd, "active_calories"),
    workout_load: nf(sd, "currentWorkoutLoad"),
    name: row.NAME,
    aerobic_training_effect: nf(sd, "aerobicTrainingEffect"),
    anaerobic_training_effect: nf(sd, "anaerobicTrainingEffect"),
    recovery_time_h: nf(sd, "recoveryTime"),
    avg_hr_bpm: nf(sd, "averageHR"),
    max_hr_bpm: nf(sd, "maxHR"),
  };
}

function readRecentWorkouts(db: Database.Database, eventStartIso: string): RecentWorkoutSummary[] {
  const startMs = Date.parse(eventStartIso);
  const fromMs = startMs - 14 * 86_400_000;
  let rows: SummaryRow[] = [];
  try {
    rows = db
      .prepare<[number, number], SummaryRow>(
        `SELECT START_TIME, END_TIME, ACTIVITY_KIND, NAME, SUMMARY_DATA
         FROM BASE_ACTIVITY_SUMMARY
         WHERE START_TIME >= ? AND START_TIME < ?
         ORDER BY START_TIME DESC
         LIMIT 25`,
      )
      .all(fromMs, startMs);
  } catch {
    return [];
  }
  return rows.map((r) => {
    const sd = parseSummary(r.SUMMARY_DATA);
    const dur = Math.max(0, Math.round((r.END_TIME - r.START_TIME) / 60_000));
    return {
      ts_start_iso: new Date(r.START_TIME).toISOString(),
      kind: r.ACTIVITY_KIND,
      duration_min: dur,
      workout_load: nf(sd, "currentWorkoutLoad"),
      active_kcal: nf(sd, "active_calories"),
    };
  });
}

function parseSummary(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nf(sd: Record<string, unknown> | null, key: string): number | null {
  if (!sd) return null;
  const node = sd[key];
  if (node && typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    const v = (node as { value: unknown }).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}
