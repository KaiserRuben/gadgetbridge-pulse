/**
 * Morning use-case packager (v3).
 *
 * Fires from `sleep_complete`. Bundles the night's sleep + this morning's
 * recovery + active training plan + recent sessions + pain history into a
 * "spend your day like this" briefing context. The LLM call (in
 * `runner/src/v3/prompts/morning.ts`) emits:
 *   - headline + summary
 *   - training_recommendation (overrides scheduler when plan + pain + recovery disagree)
 *   - day_shape: anchored actions across the day
 *   - care_for: areas to attend to
 *   - levers: replacement for legacy daily/v2.1 coaching_cards
 *
 * All inputs are pure reads — no LLM, no writes.
 */

import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

import { pulseDb } from "../../pulse-db.ts";
import { computeLevers, type LeverSnapshot } from "../../analyzer/levers.ts";
import { readFactsForDate } from "./shared.ts";

// ── Subtype shapes ───────────────────────────────────────────────────────────

interface SleepInsightLite {
  schema_version?: string;
  abstain?: boolean;
  headline?: string | null;
  summary_short?: string | null;
  kpis?: Array<{ id: string; label_de: string; value: number; band: string }>;
}

interface RecoveryInsightLite extends SleepInsightLite {}
interface ActivityInsightLite extends SleepInsightLite {}

interface DayScoreLite {
  value?: number;
  band?: string;
}

interface FactsLite {
  sleep?: {
    metrics?: {
      tst_min?: number | null;
      sleep_efficiency_pct?: number | null;
      deep_min?: number | null;
      rem_min?: number | null;
      bedtime_iso?: string | null;
      wake_iso?: string | null;
    };
  };
  cardio?: {
    metrics?: {
      rhr_day_bpm?: number | null;
      rhr_sleep_bpm?: number | null;
      hrv_overnight_ms?: number | null;
      spo2_mean_pct?: number | null;
    };
  };
  stress?: {
    metrics?: {
      stress_mean?: number | null;
      stress_max?: number | null;
      high_stress_minutes?: number | null;
    };
  };
  activity?: {
    metrics?: {
      steps?: number | null;
      active_minutes?: number | null;
      sedentary_minutes?: number | null;
    };
  };
  workouts?: {
    items?: Array<{ id: number; type_label?: string; duration_min?: number }>;
    window?: { workout_load_7d?: number | null; acwr?: number | null };
  };
}

// ── Plan + training-state reads (mirror lib/training/* helpers, runner-side) ─

interface PlanShape {
  schema_version?: string;
  name?: string;
  current_phase_id?: string;
  phases?: Array<{
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
  }>;
  global_constraints?: string[];
  injury_protocol?: Array<{
    symptom: string;
    action: string;
    trigger_location_codes?: string[];
    severity?: string;
  }>;
}

interface ActivePlanRow {
  version: number;
  payload: PlanShape;
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

interface PainRecurrenceRow {
  location_code: string;
  side: string;
  count_28d: number;
  most_recent_iso: string;
  latest_free_text: string | null;
}

interface ProposalHistoryRow {
  id: number;
  generated_at: string;
  status: string;
  summary_de: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  scope: string;
}

interface PlanHistoryRow {
  version: number;
  created_at: string;
  created_by: string;
  parent_version: number | null;
  change_summary: string | null;
}

function readActivePlan(db: Database.Database): ActivePlanRow | null {
  try {
    const row = db
      .prepare<
        [],
        {
          version: number;
          payload_json: string;
          change_summary: string | null;
          created_at: string;
        }
      >(
        `SELECT version, payload_json, change_summary, created_at
         FROM PULSE_TRAINING_PLAN
         WHERE is_active = 1`,
      )
      .get();
    if (!row) return null;
    return {
      version: row.version,
      payload: JSON.parse(row.payload_json) as PlanShape,
      change_summary: row.change_summary,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

function readRecentSessions(db: Database.Database, periodKey: string): SessionRow[] {
  try {
    return db
      .prepare<[string, string], SessionRow>(
        `SELECT id, period_key, state, session_template_id, deviation_reason,
                started_at, completed_at, subjective_energy, note, wearable_link_status
         FROM PULSE_ACTUAL_SESSION
         WHERE date(period_key) >= date(?, '-14 day')
           AND date(period_key) <= date(?)
         ORDER BY started_at DESC
         LIMIT 20`,
      )
      .all(periodKey, periodKey);
  } catch {
    return [];
  }
}

function readSetAggregates(db: Database.Database, ids: string[]): Map<string, SetAggRow> {
  if (ids.length === 0) return new Map();
  const ph = ids.map(() => "?").join(",");
  try {
    const rows = db
      .prepare<string[], SetAggRow>(
        `SELECT actual_session_id,
                COUNT(*) AS set_count,
                AVG(rpe) AS rpe_mean,
                MAX(rpe) AS rpe_max,
                SUM(COALESCE(weight_kg,0) * COALESCE(reps,0)) AS volume_kgreps
         FROM PULSE_SET_LOG
         WHERE actual_session_id IN (${ph})
         GROUP BY actual_session_id`,
      )
      .all(...ids);
    return new Map(rows.map((r) => [r.actual_session_id, r]));
  } catch {
    return new Map();
  }
}

function readPainAggregates(db: Database.Database, ids: string[]): Map<string, PainAggRow> {
  if (ids.length === 0) return new Map();
  const ph = ids.map(() => "?").join(",");
  try {
    const rows = db
      .prepare<string[], PainAggRow>(
        `SELECT actual_session_id,
                COUNT(*) AS count,
                group_concat(DISTINCT location_code) AS locations
         FROM PULSE_PAIN_FLAG
         WHERE actual_session_id IN (${ph})
         GROUP BY actual_session_id`,
      )
      .all(...ids);
    return new Map(rows.map((r) => [r.actual_session_id, r]));
  } catch {
    return new Map();
  }
}

function readPainRecurrence(db: Database.Database, periodKey: string): PainRecurrenceRow[] {
  try {
    return db
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
         ORDER BY count_28d DESC`,
      )
      .all(periodKey, periodKey);
  } catch {
    return [];
  }
}

function readProposalHistory(db: Database.Database): ProposalHistoryRow[] {
  try {
    return db
      .prepare<[], ProposalHistoryRow>(
        `SELECT id, generated_at, status, summary_de, resolution_note, resolved_at, scope
         FROM PULSE_ADJUSTMENT_PROPOSAL
         WHERE resolved_at IS NOT NULL
           AND date(resolved_at) >= date('now', '-90 day')
         ORDER BY resolved_at DESC
         LIMIT 10`,
      )
      .all();
  } catch {
    return [];
  }
}

function readPlanHistory(db: Database.Database): PlanHistoryRow[] {
  try {
    return db
      .prepare<[], PlanHistoryRow>(
        `SELECT version, created_at, created_by, parent_version, change_summary
         FROM PULSE_TRAINING_PLAN
         ORDER BY version DESC
         LIMIT 5`,
      )
      .all();
  } catch {
    return [];
  }
}

// ── Schedule helper (mirror of lib/training/scheduler.ts) ───────────────────

function mondayBasedDow(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone });
  const wk = fmt.format(d);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wk] ?? 0;
}

function scheduledSlotForToday(plan: PlanShape, periodKey: string, tz: string): string | null {
  const phase = plan.phases?.find((p) => p.id === plan.current_phase_id);
  if (!phase) return null;
  const dow = mondayBasedDow(new Date(`${periodKey}T12:00:00Z`), tz);
  return phase.schedule_hint?.weekly_pattern?.[dow] ?? null;
}

// ── Surprise-insight read ────────────────────────────────────────────────────

function readSurpriseInsightsFromYesterday(
  insightsRoot: string,
  periodKey: string,
): Array<{ metric: string; band: string; z_score: number; tldr_de: string }> {
  const yesterday = shiftDateByDays(periodKey, -1);
  const dailyPath = path.join(insightsRoot, "daily", yesterday, "daily.json");
  try {
    const txt = readFileSync(dailyPath, "utf8");
    const parsed = JSON.parse(txt) as {
      surprise_insights?: Array<{
        metric?: string;
        band?: string;
        z_score?: number;
        tldr_de?: string;
      }>;
    };
    return (parsed.surprise_insights ?? []).slice(0, 3).map((s) => ({
      metric: s.metric ?? "?",
      band: s.band ?? "?",
      z_score: s.z_score ?? 0,
      tldr_de: s.tldr_de ?? "",
    }));
  } catch {
    return [];
  }
}

function shiftDateByDays(periodKey: string, days: number): string {
  const [y, m, d] = periodKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ── Subsidiary insight reads ────────────────────────────────────────────────

function loadInsightJson<T>(insightsRoot: string, periodKey: string, file: string): T | null {
  try {
    const p = path.join(insightsRoot, "daily", periodKey, file);
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── Output type ──────────────────────────────────────────────────────────────

export interface MorningPlanSummary {
  version: number;
  name: string;
  current_phase_id: string | null;
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
    estimated_duration_min: number | null;
    exercise_count: number;
  }>;
  schedule_today: string | null;
  global_constraints: string[];
  injury_protocol: Array<{
    symptom: string;
    action: string;
    location_codes: string[];
    severity: string;
  }>;
  recent_change_summary: string | null;
}

export interface MorningSessionAggregate {
  id: string;
  period_key: string;
  state: string;
  session_template_id: string | null;
  deviation_reason: string | null;
  started_at: string;
  completed_at: string | null;
  subjective_energy: number | null;
  set_count: number;
  rpe_mean: number | null;
  rpe_max: number | null;
  volume_kgreps: number | null;
  pain_count: number;
  pain_locations: string[];
}

export interface MorningPackage {
  meta: {
    period_key: string;
    generated_at: string;
    tz: string;
    package_version: "morning_package/v1";
  };
  verdict_band: "above_usual" | "steady" | "below_usual" | null;
  last_night: {
    tst_min: number | null;
    sleep_efficiency_pct: number | null;
    deep_min: number | null;
    rem_min: number | null;
    rmssd_sleep_ms: number | null;
    wake_iso: string | null;
  };
  this_morning: {
    rmssd_day_mean_ms: number | null;
    rhr_day_bpm: number | null;
    rhr_sleep_bpm: number | null;
    rhr_drift_bpm: number | null;
    spo2_mean_pct: number | null;
    stress_mean: number | null;
    high_stress_minutes: number | null;
  };
  yesterday: {
    steps: number | null;
    active_minutes: number | null;
    sedentary_minutes: number | null;
  };
  day_score: DayScoreLite | null;
  cluster_insights: {
    sleep: SleepInsightLite | null;
    recovery: RecoveryInsightLite | null;
    activity: ActivityInsightLite | null;
  };
  training: {
    plan: MorningPlanSummary | null;
    plan_change_history: PlanHistoryRow[];
    recent_sessions: MorningSessionAggregate[];
    pain_recurrence: PainRecurrenceRow[];
    proposal_history: ProposalHistoryRow[];
  };
  surprise_insights: Array<{
    metric: string;
    band: string;
    z_score: number;
    tldr_de: string;
  }>;
  levers: LeverSnapshot[];
  data_quality: {
    has_last_night_sleep: boolean;
    has_recovery_today: boolean;
    has_plan: boolean;
    sessions_in_window: number;
    levers_with_n_ge_7: number;
  };
}

// ── Verdict-band heuristic (deterministic, before LLM) ──────────────────────

function deriveVerdictBand(args: {
  rmssd_today: number | null;
  rhr_drift: number | null;
  high_stress_min: number | null;
  tst_min: number | null;
}): MorningPackage["verdict_band"] {
  // Mirrors how synthesis derives a verdict from recovery package primitives:
  // any one strong negative signal → below_usual; all-clear → steady; with at
  // least one strongly positive → above_usual. Threshold values match the
  // recovery prompt (`runner/src/v3/prompts/recovery.ts`).
  const signals: number[] = [];
  if (args.rmssd_today != null && args.rmssd_today >= 70) signals.push(1);
  if (args.rmssd_today != null && args.rmssd_today < 40) signals.push(-1);
  if (args.rhr_drift != null && args.rhr_drift > 5) signals.push(-1);
  if (args.rhr_drift != null && args.rhr_drift < 2) signals.push(1);
  if (args.high_stress_min != null && args.high_stress_min > 60) signals.push(-1);
  if (args.tst_min != null && args.tst_min < 360) signals.push(-1);
  if (args.tst_min != null && args.tst_min >= 480) signals.push(1);
  if (signals.length === 0) return null;
  const sum = signals.reduce((a, b) => a + b, 0);
  if (sum <= -1) return "below_usual";
  if (sum >= 1) return "above_usual";
  return "steady";
}

// ── Entry ────────────────────────────────────────────────────────────────────

export interface BuildMorningPackageArgs {
  periodKey: string;
  db: unknown; // unused — kept for parity with other v3 packagers
  insightsRoot: string;
  tz: string;
}

export async function buildMorningPackage(
  args: BuildMorningPackageArgs,
): Promise<MorningPackage> {
  const tz = args.tz ?? "Europe/Berlin";
  const pdb = pulseDb();

  // Wearable-derived facts written by stage 0 of the live pipeline.
  const facts = readFactsForDate(args.insightsRoot, args.periodKey) as FactsLite | null;
  const yesterdayFacts =
    (readFactsForDate(args.insightsRoot, shiftDateByDays(args.periodKey, -1)) as FactsLite | null) ?? null;

  // Domain insights from the prior runs of sibling v3 clusters (sleep +
  // recovery already done before morning fires; activity from yesterday).
  const sleepInsight = loadInsightJson<SleepInsightLite>(args.insightsRoot, args.periodKey, "sleep_insight.json");
  const recoveryInsight = loadInsightJson<RecoveryInsightLite>(
    args.insightsRoot,
    args.periodKey,
    "recovery_insight.json",
  );
  const activityInsight =
    loadInsightJson<ActivityInsightLite>(
      args.insightsRoot,
      shiftDateByDays(args.periodKey, -1),
      "activity_insight.json",
    );
  const dayScore = loadInsightJson<DayScoreLite>(args.insightsRoot, args.periodKey, "day_score.json");

  // Lever math (14-day window).
  const levers = await computeLevers(args.periodKey, args.insightsRoot);

  // Training-state reads from pulse.db.
  const planRow = pdb ? readActivePlan(pdb) : null;
  const plan: MorningPlanSummary | null = planRow
    ? buildPlanSummary(planRow, args.periodKey, tz)
    : null;
  const planHistory = pdb ? readPlanHistory(pdb) : [];
  const sessions = pdb ? readRecentSessions(pdb, args.periodKey) : [];
  const setAggs = pdb ? readSetAggregates(pdb, sessions.map((s) => s.id)) : new Map();
  const painAggs = pdb ? readPainAggregates(pdb, sessions.map((s) => s.id)) : new Map();
  const painRecurrence = pdb ? readPainRecurrence(pdb, args.periodKey) : [];
  const proposalHistory = pdb ? readProposalHistory(pdb) : [];

  const aggregatedSessions: MorningSessionAggregate[] = sessions.map((s) => combine(s, setAggs.get(s.id), painAggs.get(s.id)));

  // Surprise insights are a Stage 5b product, written into yesterday's
  // daily.json. Pull the top 3 so the morning prompt can cite them.
  const surprise = readSurpriseInsightsFromYesterday(args.insightsRoot, args.periodKey);

  const verdictBand = deriveVerdictBand({
    rmssd_today: facts?.cardio?.metrics?.hrv_overnight_ms ?? null,
    rhr_drift: deriveRhrDrift(facts),
    high_stress_min: facts?.stress?.metrics?.high_stress_minutes ?? null,
    tst_min: facts?.sleep?.metrics?.tst_min ?? null,
  });

  return {
    meta: {
      period_key: args.periodKey,
      generated_at: new Date().toISOString(),
      tz,
      package_version: "morning_package/v1",
    },
    verdict_band: verdictBand,
    last_night: {
      tst_min: facts?.sleep?.metrics?.tst_min ?? null,
      sleep_efficiency_pct: facts?.sleep?.metrics?.sleep_efficiency_pct ?? null,
      deep_min: facts?.sleep?.metrics?.deep_min ?? null,
      rem_min: facts?.sleep?.metrics?.rem_min ?? null,
      rmssd_sleep_ms: facts?.cardio?.metrics?.hrv_overnight_ms ?? null,
      wake_iso: facts?.sleep?.metrics?.wake_iso ?? null,
    },
    this_morning: {
      rmssd_day_mean_ms: facts?.cardio?.metrics?.hrv_overnight_ms ?? null,
      rhr_day_bpm: facts?.cardio?.metrics?.rhr_day_bpm ?? null,
      rhr_sleep_bpm: facts?.cardio?.metrics?.rhr_sleep_bpm ?? null,
      rhr_drift_bpm: deriveRhrDrift(facts),
      spo2_mean_pct: facts?.cardio?.metrics?.spo2_mean_pct ?? null,
      stress_mean: facts?.stress?.metrics?.stress_mean ?? null,
      high_stress_minutes: facts?.stress?.metrics?.high_stress_minutes ?? null,
    },
    yesterday: {
      steps: yesterdayFacts?.activity?.metrics?.steps ?? null,
      active_minutes: yesterdayFacts?.activity?.metrics?.active_minutes ?? null,
      sedentary_minutes: yesterdayFacts?.activity?.metrics?.sedentary_minutes ?? null,
    },
    day_score: dayScore,
    cluster_insights: {
      sleep: sleepInsight,
      recovery: recoveryInsight,
      activity: activityInsight,
    },
    training: {
      plan,
      plan_change_history: planHistory,
      recent_sessions: aggregatedSessions,
      pain_recurrence: painRecurrence,
      proposal_history: proposalHistory,
    },
    surprise_insights: surprise,
    levers,
    data_quality: {
      has_last_night_sleep: facts?.sleep?.metrics?.tst_min != null,
      has_recovery_today: facts?.cardio?.metrics?.rhr_day_bpm != null,
      has_plan: plan != null,
      sessions_in_window: sessions.length,
      levers_with_n_ge_7: levers.filter((l) => l.n_days_used >= 7).length,
    },
  };
}

function deriveRhrDrift(facts: FactsLite | null): number | null {
  const day = facts?.cardio?.metrics?.rhr_day_bpm ?? null;
  const sleep = facts?.cardio?.metrics?.rhr_sleep_bpm ?? null;
  if (day == null || sleep == null) return null;
  return +(day - sleep).toFixed(1);
}

function buildPlanSummary(
  row: ActivePlanRow,
  periodKey: string,
  tz: string,
): MorningPlanSummary {
  const phases = row.payload.phases ?? [];
  const phase = phases.find((p) => p.id === row.payload.current_phase_id) ?? null;
  const todaySlot = phase ? scheduledSlotForToday(row.payload, periodKey, tz) : null;
  const templates =
    phase?.session_templates?.map((t) => ({
      id: t.id,
      label: t.label,
      category: t.category ?? "strength",
      estimated_duration_min: t.estimated_duration_min ?? null,
      exercise_count: (t.exercises ?? []).length,
    })) ?? [];
  return {
    version: row.version,
    name: row.payload.name ?? "?",
    current_phase_id: row.payload.current_phase_id ?? null,
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
    schedule_today: todaySlot,
    global_constraints: row.payload.global_constraints ?? [],
    injury_protocol: (row.payload.injury_protocol ?? []).map((r) => ({
      symptom: r.symptom,
      action: r.action,
      location_codes: r.trigger_location_codes ?? [],
      severity: r.severity ?? "warn",
    })),
    recent_change_summary: row.change_summary,
  };
}

function combine(
  row: SessionRow,
  setAgg: SetAggRow | undefined,
  painAgg: PainAggRow | undefined,
): MorningSessionAggregate {
  return {
    id: row.id,
    period_key: row.period_key,
    state: row.state,
    session_template_id: row.session_template_id,
    deviation_reason: row.deviation_reason,
    started_at: row.started_at,
    completed_at: row.completed_at,
    subjective_energy: row.subjective_energy,
    set_count: setAgg?.set_count ?? 0,
    rpe_mean: setAgg?.rpe_mean != null ? +setAgg.rpe_mean.toFixed(2) : null,
    rpe_max: setAgg?.rpe_max ?? null,
    volume_kgreps: setAgg?.volume_kgreps ?? null,
    pain_count: painAgg?.count ?? 0,
    pain_locations: painAgg?.locations ? painAgg.locations.split(",") : [],
  };
}
