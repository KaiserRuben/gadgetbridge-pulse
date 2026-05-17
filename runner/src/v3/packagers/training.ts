/**
 * Training use-case packager (v3).
 *
 * Reads `pulse.db` (Pi-writer, Syncthing-replicated to the Mac runner) for
 * the active plan + recent sessions + pain flags, plus the neighbouring
 * recovery package for HRV/RHR context. Output feeds the training LLM
 * which writes prescription/post-session/weekly insights.
 *
 * Pure data — no LLM call, no writes. Always emits a complete package so
 * the runner can write `training_package.json` even on abstain days.
 */

import type Database from "better-sqlite3";
import { pulseDb } from "../../pulse-db.ts";
import { readFactsForDate } from "./shared.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrainingPlanSummary {
  version: number;
  name: string;
  status: string;
  current_phase_id: string;
  phase: {
    id: string;
    label: string;
    goal: string | null;
    character: string | null;
    constraints: string[];
    rpe_floor: number | null;
    rpe_ceiling: number | null;
  } | null;
  session_templates: Array<{
    id: string;
    label: string;
    category: string;
    exercise_count: number;
    estimated_duration_min: number | null;
  }>;
  global_constraints: string[];
  injury_protocol: Array<{
    symptom: string;
    action: string;
    location_codes: string[];
    severity: string;
  }>;
  schedule_today: string | null;
}

export interface SessionAggregate {
  id: string;
  period_key: string;
  state: string;
  session_template_id: string | null;
  deviation_reason: string | null;
  started_at: string;
  completed_at: string | null;
  subjective_energy: number | null;
  note: string | null;
  wearable_link_status: string;
  set_count: number;
  rpe_mean: number | null;
  rpe_max: number | null;
  volume_kgreps: number | null;
  pain_count: number;
  pain_locations: string[];
}

export interface PainRecurrenceItem {
  location_code: string;
  side: string;
  count_28d: number;
  most_recent_iso: string;
  latest_free_text: string | null;
}

export interface ExerciseTrendItem {
  exercise_id: string;
  display_de: string;
  movement_pattern: string;
  samples: number;
  rpe_mean: number | null;
  rpe_trend: "rising" | "flat" | "falling";
  load_kg_recent_max: number | null;
}

export interface TrainingPackage {
  meta: {
    period_key: string;
    generated_at: string;
    tz: string;
    package_version: "training_package/v1";
  };
  plan: TrainingPlanSummary | null;
  today: {
    suggested_template_id: string | null;
    in_progress_session_id: string | null;
    completed_today: SessionAggregate[];
  };
  recent_sessions: SessionAggregate[];
  exercise_trends: ExerciseTrendItem[];
  pain_recurrence: PainRecurrenceItem[];
  plan_change_history: Array<{
    version: number;
    created_by: string;
    parent_version: number | null;
    change_summary: string | null;
    created_at: string;
  }>;
  recovery_context: {
    rmssd_sleep_ms: number | null;
    rmssd_day_mean_ms: number | null;
    rhr_drift_bpm: number | null;
    stress_high_min: number | null;
    tst_min: number | null;
    workout_load_7d: number | null;
  };
  data_quality: {
    sessions_in_window: number;
    days_in_window: number;
    has_plan: boolean;
  };
}

// ── DB helpers ───────────────────────────────────────────────────────────────

const SESSION_WINDOW_DAYS = 28;

interface PlanRawRow {
  version: number;
  payload_json: string;
}

interface PlanHistoryRow {
  version: number;
  created_by: string;
  parent_version: number | null;
  change_summary: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  period_key: string;
  state: string;
  session_template_id: string | null;
  deviation_reason: string | null;
  started_at: string;
  completed_at: string | null;
  subjective_energy: number | null;
  note: string | null;
  wearable_link_status: string;
}

interface SetAggRow {
  actual_session_id: string;
  set_count: number;
  rpe_mean: number | null;
  rpe_max: number | null;
  volume_kgreps: number | null;
}

interface PainAggRow {
  actual_session_id: string;
  count: number;
  locations: string;
}

interface ExerciseTrendRow {
  exercise_id: string;
  display_de: string | null;
  movement_pattern: string | null;
  samples: number;
  rpe_mean: number | null;
  rpe_first_q: number | null;
  rpe_last_q: number | null;
  load_kg_recent_max: number | null;
}

interface PainRecurrenceRow {
  location_code: string;
  side: string;
  count_28d: number;
  most_recent_iso: string;
  latest_free_text: string | null;
}

function readActivePlan(db: Database.Database): { version: number; payload: object } | null {
  try {
    const row = db
      .prepare<[], PlanRawRow>(
        `SELECT version, payload_json FROM PULSE_TRAINING_PLAN WHERE is_active = 1`,
      )
      .get();
    if (!row) return null;
    return { version: row.version, payload: JSON.parse(row.payload_json) as object };
  } catch {
    return null;
  }
}

function readPlanHistory(db: Database.Database): PlanHistoryRow[] {
  try {
    return db
      .prepare<[], PlanHistoryRow>(
        `SELECT version, created_by, parent_version, change_summary, created_at
         FROM PULSE_TRAINING_PLAN
         ORDER BY version DESC
         LIMIT 10`,
      )
      .all();
  } catch {
    return [];
  }
}

function readRecentSessions(db: Database.Database, periodKey: string): SessionRow[] {
  try {
    return db
      .prepare<[string], SessionRow>(
        `SELECT id, period_key, state, session_template_id, deviation_reason,
                started_at, completed_at, subjective_energy, note, wearable_link_status
         FROM PULSE_ACTUAL_SESSION
         WHERE period_key <= ?
           AND date(period_key) >= date(?, '-${SESSION_WINDOW_DAYS} day')
         ORDER BY started_at DESC
         LIMIT 50`,
      )
      .all(periodKey);
  } catch {
    return [];
  }
}

function readSetAggregates(db: Database.Database, sessionIds: string[]): Map<string, SetAggRow> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => "?").join(",");
  try {
    const rows = db
      .prepare<string[], SetAggRow>(
        `SELECT actual_session_id,
                COUNT(*) AS set_count,
                AVG(rpe) AS rpe_mean,
                MAX(rpe) AS rpe_max,
                SUM(COALESCE(weight_kg,0) * COALESCE(reps,0)) AS volume_kgreps
         FROM PULSE_SET_LOG
         WHERE actual_session_id IN (${placeholders})
         GROUP BY actual_session_id`,
      )
      .all(...sessionIds);
    return new Map(rows.map((r) => [r.actual_session_id, r]));
  } catch {
    return new Map();
  }
}

function readPainAggregates(db: Database.Database, sessionIds: string[]): Map<string, PainAggRow> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => "?").join(",");
  try {
    const rows = db
      .prepare<string[], PainAggRow>(
        `SELECT actual_session_id,
                COUNT(*) AS count,
                group_concat(DISTINCT location_code) AS locations
         FROM PULSE_PAIN_FLAG
         WHERE actual_session_id IN (${placeholders})
         GROUP BY actual_session_id`,
      )
      .all(...sessionIds);
    return new Map(rows.map((r) => [r.actual_session_id, r]));
  } catch {
    return new Map();
  }
}

function readExerciseTrends(db: Database.Database, periodKey: string): ExerciseTrendItem[] {
  try {
    const rows = db
      .prepare<[string, string, string, string], ExerciseTrendRow>(
        `SELECT s.exercise_id,
                e.display_de,
                e.movement_pattern,
                COUNT(*) AS samples,
                AVG(s.rpe) AS rpe_mean,
                AVG(CASE WHEN s.logged_at < ? THEN s.rpe END) AS rpe_first_q,
                AVG(CASE WHEN s.logged_at >= ? THEN s.rpe END) AS rpe_last_q,
                MAX(s.weight_kg) AS load_kg_recent_max
         FROM PULSE_SET_LOG s
         LEFT JOIN PULSE_EXERCISE e ON e.id = s.exercise_id
         WHERE date(s.logged_at) >= date(?, '-${SESSION_WINDOW_DAYS} day')
           AND date(s.logged_at) <= date(?)
         GROUP BY s.exercise_id
         HAVING COUNT(*) >= 3
         ORDER BY samples DESC
         LIMIT 15`,
      )
      .all(
        // First-quartile cutoff: midpoint of the window. Splitting at mid lets
        // us call "rising" if late RPE > early RPE without needing per-set
        // bucketing.
        new Date(
          new Date(`${periodKey}T00:00:00Z`).getTime() -
            (SESSION_WINDOW_DAYS / 2) * 86_400_000,
        ).toISOString(),
        new Date(
          new Date(`${periodKey}T00:00:00Z`).getTime() -
            (SESSION_WINDOW_DAYS / 2) * 86_400_000,
        ).toISOString(),
        periodKey,
        periodKey,
      );
    return rows.map<ExerciseTrendItem>((r) => {
      let trend: ExerciseTrendItem["rpe_trend"] = "flat";
      if (r.rpe_first_q != null && r.rpe_last_q != null) {
        if (r.rpe_last_q - r.rpe_first_q > 0.5) trend = "rising";
        else if (r.rpe_last_q - r.rpe_first_q < -0.5) trend = "falling";
      }
      return {
        exercise_id: r.exercise_id,
        display_de: r.display_de ?? r.exercise_id,
        movement_pattern: r.movement_pattern ?? "unknown",
        samples: r.samples,
        rpe_mean: r.rpe_mean != null ? +r.rpe_mean.toFixed(2) : null,
        rpe_trend: trend,
        load_kg_recent_max: r.load_kg_recent_max,
      };
    });
  } catch {
    return [];
  }
}

function readPainRecurrence(db: Database.Database, periodKey: string): PainRecurrenceItem[] {
  try {
    const rows = db
      .prepare<[string, string], PainRecurrenceRow>(
        `SELECT location_code,
                side,
                COUNT(*) AS count_28d,
                MAX(raised_at) AS most_recent_iso,
                (
                  SELECT free_text FROM PULSE_PAIN_FLAG p2
                  WHERE p2.location_code = p.location_code
                    AND p2.side = p.side
                  ORDER BY raised_at DESC LIMIT 1
                ) AS latest_free_text
         FROM PULSE_PAIN_FLAG p
         WHERE date(raised_at) >= date(?, '-28 day')
           AND date(raised_at) <= date(?)
         GROUP BY location_code, side
         HAVING count_28d >= 1
         ORDER BY count_28d DESC`,
      )
      .all(periodKey, periodKey);
    return rows;
  } catch {
    return [];
  }
}

// ── Plan flattening ──────────────────────────────────────────────────────────

interface PhaseShape {
  id: string;
  label: string;
  goal?: string | null;
  character?: string | null;
  constraints?: string[];
  intensity_guidance?: { rpe_floor?: number | null; rpe_ceiling?: number | null } | null;
  schedule_hint?: { weekly_pattern?: string[] } | null;
  session_templates?: Array<{
    id: string;
    label: string;
    category?: string;
    estimated_duration_min?: number | null;
    exercises?: unknown[];
  }>;
}

interface PlanShape {
  schema_version?: string;
  name?: string;
  status?: string;
  current_phase_id?: string;
  phases?: PhaseShape[];
  global_constraints?: string[];
  injury_protocol?: Array<{
    symptom: string;
    action: string;
    trigger_location_codes?: string[];
    severity?: string;
  }>;
}

function mondayBasedDow(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone });
  const wk = fmt.format(d);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wk] ?? 0;
}

function summarisePlan(
  plan: PlanShape,
  version: number,
  periodKey: string,
  tz: string,
): TrainingPlanSummary {
  const phases = plan.phases ?? [];
  const phase = phases.find((p) => p.id === plan.current_phase_id) ?? null;
  const dow = mondayBasedDow(new Date(`${periodKey}T12:00:00Z`), tz);
  const todaySlot = phase?.schedule_hint?.weekly_pattern?.[dow] ?? null;
  const templates =
    phase?.session_templates?.map((t) => ({
      id: t.id,
      label: t.label,
      category: t.category ?? "strength",
      estimated_duration_min: t.estimated_duration_min ?? null,
      exercise_count: (t.exercises ?? []).length,
    })) ?? [];
  return {
    version,
    name: plan.name ?? "?",
    status: plan.status ?? "?",
    current_phase_id: plan.current_phase_id ?? "",
    phase: phase
      ? {
          id: phase.id,
          label: phase.label,
          goal: phase.goal ?? null,
          character: phase.character ?? null,
          constraints: phase.constraints ?? [],
          rpe_floor: phase.intensity_guidance?.rpe_floor ?? null,
          rpe_ceiling: phase.intensity_guidance?.rpe_ceiling ?? null,
        }
      : null,
    session_templates: templates,
    global_constraints: plan.global_constraints ?? [],
    injury_protocol: (plan.injury_protocol ?? []).map((r) => ({
      symptom: r.symptom,
      action: r.action,
      location_codes: r.trigger_location_codes ?? [],
      severity: r.severity ?? "warn",
    })),
    schedule_today: todaySlot,
  };
}

function combineSession(
  row: SessionRow,
  setAgg: SetAggRow | undefined,
  painAgg: PainAggRow | undefined,
): SessionAggregate {
  return {
    id: row.id,
    period_key: row.period_key,
    state: row.state,
    session_template_id: row.session_template_id,
    deviation_reason: row.deviation_reason,
    started_at: row.started_at,
    completed_at: row.completed_at,
    subjective_energy: row.subjective_energy,
    note: row.note,
    wearable_link_status: row.wearable_link_status,
    set_count: setAgg?.set_count ?? 0,
    rpe_mean: setAgg?.rpe_mean != null ? +setAgg.rpe_mean.toFixed(2) : null,
    rpe_max: setAgg?.rpe_max ?? null,
    volume_kgreps: setAgg?.volume_kgreps ?? null,
    pain_count: painAgg?.count ?? 0,
    pain_locations: painAgg?.locations ? painAgg.locations.split(",") : [],
  };
}

interface FactsLike {
  workouts?: { window?: { workout_load_7d?: number | null } };
  recovery?: {
    hrv?: { rmssd_sleep_ms?: number | null; rmssd_day_mean_ms?: number | null };
    rhr?: { rhr_drift_bpm?: number | null };
    stress?: { high_stress_min?: number | null };
  };
  sleep?: { tst_min?: number | null };
}

function recoveryContextFromFacts(facts: FactsLike | null): TrainingPackage["recovery_context"] {
  return {
    rmssd_sleep_ms: facts?.recovery?.hrv?.rmssd_sleep_ms ?? null,
    rmssd_day_mean_ms: facts?.recovery?.hrv?.rmssd_day_mean_ms ?? null,
    rhr_drift_bpm: facts?.recovery?.rhr?.rhr_drift_bpm ?? null,
    stress_high_min: facts?.recovery?.stress?.high_stress_min ?? null,
    tst_min: facts?.sleep?.tst_min ?? null,
    workout_load_7d: facts?.workouts?.window?.workout_load_7d ?? null,
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────

export interface BuildTrainingPackageArgs {
  periodKey: string;
  db: unknown; // Gadgetbridge handle (kept for parity with other packagers)
  insightsRoot: string;
  tz: string;
}

export function buildTrainingPackage(args: BuildTrainingPackageArgs): TrainingPackage {
  const tz = args.tz ?? "Europe/Berlin";
  const pdb = pulseDb();
  const planRaw = pdb ? readActivePlan(pdb) : null;
  const planSummary = planRaw
    ? summarisePlan(planRaw.payload as PlanShape, planRaw.version, args.periodKey, tz)
    : null;
  const history = pdb ? readPlanHistory(pdb) : [];
  const sessions = pdb ? readRecentSessions(pdb, args.periodKey) : [];
  const setAggs = pdb ? readSetAggregates(pdb, sessions.map((s) => s.id)) : new Map();
  const painAggs = pdb ? readPainAggregates(pdb, sessions.map((s) => s.id)) : new Map();
  const aggregated: SessionAggregate[] = sessions.map((s) =>
    combineSession(s, setAggs.get(s.id), painAggs.get(s.id)),
  );
  const exerciseTrends = pdb ? readExerciseTrends(pdb, args.periodKey) : [];
  const painRecurrence = pdb ? readPainRecurrence(pdb, args.periodKey) : [];
  const facts = readFactsForDate(args.insightsRoot, args.periodKey) as FactsLike | null;

  const completedToday = aggregated.filter(
    (s) => s.period_key === args.periodKey && s.state === "completed",
  );
  const inProgressToday = aggregated.find(
    (s) => s.period_key === args.periodKey && s.state === "in_progress",
  );

  const uniqueDays = new Set(sessions.map((s) => s.period_key));

  return {
    meta: {
      period_key: args.periodKey,
      generated_at: new Date().toISOString(),
      tz,
      package_version: "training_package/v1",
    },
    plan: planSummary,
    today: {
      suggested_template_id: planSummary?.schedule_today ?? null,
      in_progress_session_id: inProgressToday?.id ?? null,
      completed_today: completedToday,
    },
    recent_sessions: aggregated,
    exercise_trends: exerciseTrends,
    pain_recurrence: painRecurrence,
    plan_change_history: history,
    recovery_context: recoveryContextFromFacts(facts),
    data_quality: {
      sessions_in_window: sessions.length,
      days_in_window: uniqueDays.size,
      has_plan: planSummary != null,
    },
  };
}
