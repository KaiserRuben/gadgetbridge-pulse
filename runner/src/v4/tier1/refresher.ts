/**
 * Tier-1 refresher — deterministic, no-LLM block that ticks every 60s.
 *
 * Builds a Tier1 envelope from:
 *   - `buildDailyFacts(periodKey, db)` — full FactsBundleV2
 *   - latest HUAWEI_ACTIVITY_SAMPLE row → hr_now, last_db_sample_at,
 *     data_lag_min, sleeping_in_progress flag
 *   - 14× neighbor `_facts.json` from $INSIGHTS_ROOT/daily/<date>/ →
 *     kpis_14d series
 *
 * Holes deliberately left null for now (filled in subsequent passes):
 *   - kpis_today.day_score   (set by day_synthesis SlotEntry)
 *   - context.plan_session_today (training plan integration is its own surface)
 *   - context.anomalies_today (will be wired from rules-engine output once
 *     v2 anomaly detection is migrated; until then, [])
 *
 * Phase 2 surface — the refresher returns the Tier1 envelope synchronously.
 * The daemon (Phase 2 task #23) decides when to call it and dispatches the
 * resulting Tier1Diff to the Pi.
 */

import type Database from "better-sqlite3";

import { dayWindow } from "../../facts/window.ts";
import { buildDailyFacts } from "../../facts/daily.ts";
import { readFactsForDate, shiftDateKey } from "../slots/_shared.ts";
import type {
  AnomalyEvent,
  DayOfWeek,
  KpiWorkout,
  Kpis14d,
  KpisToday,
  Point,
  Tier1,
  Tier1Context,
  Tier1Detail,
  FactsNow,
} from "../types.ts";

const TZ_DEFAULT = "Europe/Berlin";

export interface BuildTier1Opts {
  period_key: string;
  db: Database.Database;
  insights_root: string;
  tz?: string;
  now?: Date;
}

export async function buildTier1(opts: BuildTier1Opts): Promise<Tier1> {
  const tz = opts.tz ?? TZ_DEFAULT;
  const now = opts.now ?? new Date();

  // 1. Deterministic facts for today.
  const facts = await buildDailyFacts(opts.period_key, opts.db);

  // 2. Live HR row.
  const factsNow = readFactsNow(opts.db, opts.period_key, tz, now);

  // 3. Today KPIs derived from facts + workouts.
  const kpisToday = extractKpisToday(facts);

  // 4. 14-day neighbors (read once) → kpis_14d sparklines + per-domain detail.
  const neighbors = readNeighbors(opts.insights_root, opts.period_key);
  const kpis14d = build14dSeries(neighbors);
  const detail = buildDetail(facts, neighbors);

  // 5. Context: day_of_week from period_key, anomalies from facts.
  const context = buildContext(opts.period_key, facts, tz);

  return {
    computed_at: now.toISOString(),
    facts_now: factsNow,
    kpis_today: kpisToday,
    kpis_14d: kpis14d,
    context,
    detail,
  };
}

// ── facts_now ──────────────────────────────────────────────────────────────

interface ActivityNowRow {
  TIMESTAMP: number;
  HEART_RATE: number | null;
}

function readFactsNow(
  db: Database.Database,
  period_key: string,
  tz: string,
  now: Date,
): FactsNow {
  const win = dayWindow(period_key, tz);
  // Latest activity sample anywhere (not bounded to today — handles late midnight
  // sync gaps).
  let lastRow: ActivityNowRow | null = null;
  try {
    lastRow =
      db
        .prepare<[], ActivityNowRow>(
          `SELECT TIMESTAMP, HEART_RATE
           FROM HUAWEI_ACTIVITY_SAMPLE
           WHERE HEART_RATE BETWEEN 30 AND 220
           ORDER BY TIMESTAMP DESC LIMIT 1`,
        )
        .get() ?? null;
  } catch {
    lastRow = null;
  }

  const lastSampleMs = lastRow ? lastRow.TIMESTAMP * 1000 : null;
  const dataLagMin = lastSampleMs ? Math.max(0, Math.round((now.getTime() - lastSampleMs) / 60_000)) : null;

  // Sleeping-in-progress heuristic: today's WAKEUP_TIME row not yet present.
  const sleepingInProgress = !hasWakeupToday(db, win.startMs as number, win.endMs as number);

  // Last workout end across all time (cheap query — bounded by index on END_TIME).
  const lastWorkoutEnd = readLastWorkoutEndIso(db, tz);

  return {
    now_ms: now.getTime(),
    last_db_sample_at: lastSampleMs ? msIso(lastSampleMs, tz) : null,
    data_lag_min: dataLagMin,
    sleeping_in_progress: sleepingInProgress,
    last_workout_end_at: lastWorkoutEnd,
    hr_now: lastRow?.HEART_RATE ?? null,
  };
}

function hasWakeupToday(
  db: Database.Database,
  startMs: number,
  endMs: number,
): boolean {
  try {
    const row = db
      .prepare<[number, number], { c: number }>(
        `SELECT COUNT(*) AS c
         FROM HUAWEI_SLEEP_STATS_SAMPLE
         WHERE WAKEUP_TIME >= ? AND WAKEUP_TIME < ? AND WAKEUP_TIME > 0`,
      )
      .get(startMs, endMs);
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

function readLastWorkoutEndIso(db: Database.Database, tz: string): string | null {
  try {
    const row = db
      .prepare<[], { END_TIME: number }>(
        `SELECT END_TIME FROM BASE_ACTIVITY_SUMMARY ORDER BY END_TIME DESC LIMIT 1`,
      )
      .get();
    return row && row.END_TIME ? msIso(row.END_TIME, tz) : null;
  } catch {
    return null;
  }
}

// ── kpis_today ─────────────────────────────────────────────────────────────

interface MetricBag {
  metrics?: Record<string, number | null>;
}

function extractKpisToday(facts: Awaited<ReturnType<typeof buildDailyFacts>>): KpisToday {
  const sleep = (facts.sleep as MetricBag | null)?.metrics ?? {};
  const cardio = (facts.cardio as MetricBag | null)?.metrics ?? {};
  const activity = (facts.activity as MetricBag | null)?.metrics ?? {};
  const stress = (facts.stress as MetricBag | null)?.metrics ?? {};
  const workouts = extractWorkouts(facts);

  return {
    tst_min: numOrNull(sleep.tst_min),
    sleep_eff_pct: numOrNull(sleep.sleep_efficiency_pct),
    rmssd_ms: numOrNull(sleep.rmssd_ms),
    rhr_sleep_bpm: numOrNull(sleep.rhr_sleep_bpm),
    rhr_day_bpm: numOrNull(cardio.rhr_day_bpm),
    steps: numOrNull(activity.steps),
    active_kcal: numOrNull(activity.active_kcal),
    stress_mean: numOrNull(stress.stress_mean),
    // day_score lives on the day_synthesis SlotEntry (LLM-derived).
    day_score: { value: null, band: null, reasoning: null },
    workouts,
  };
}

function extractWorkouts(facts: Awaited<ReturnType<typeof buildDailyFacts>>): KpiWorkout[] {
  const list = (facts as unknown as { workouts?: { entries?: Array<Record<string, unknown>> } }).workouts?.entries;
  if (!Array.isArray(list)) return [];
  return list.map((w) => ({
    ts_start_iso: stringOr(w.ts_start_iso, ""),
    ts_end_iso: stringOr(w.ts_end_iso, ""),
    kind: numOr(w.kind, 0),
    duration_min: numOr(w.duration_min, 0),
    distance_m: numOrNull(w.distance_m as number | null | undefined),
    active_kcal: numOrNull(w.active_kcal as number | null | undefined),
    workout_load: numOrNull(w.workout_load as number | null | undefined),
    name: typeof w.name === "string" ? w.name : null,
  }));
}

// ── kpis_14d + detail ──────────────────────────────────────────────────────

type FactsLike = ReturnType<typeof readFactsForDate>;
interface Neighbor {
  date: string;
  facts: FactsLike;
}

/** Read the 14 trailing days' facts once; reused for both the sparkline
 * series and the per-domain detail series. */
function readNeighbors(insightsRoot: string, periodKey: string): Neighbor[] {
  const out: Neighbor[] = [];
  for (let back = 13; back >= 0; back--) {
    const date = shiftDateKey(periodKey, back);
    out.push({ date, facts: readFactsForDate(insightsRoot, date) });
  }
  return out;
}

function metricsOf(facts: unknown, domain: string): Record<string, number | null> {
  const d = (facts as Record<string, unknown> | null | undefined)?.[domain];
  const m = d && typeof d === "object" ? (d as MetricBag).metrics : undefined;
  return (m ?? {}) as Record<string, number | null>;
}

function build14dSeries(neighbors: Neighbor[]): Kpis14d {
  const sleepQuality: Point[] = [];
  const autonomic: Point[] = [];
  const volumeLoad: Point[] = [];
  const dayScore: Point[] = [];

  for (const { date, facts } of neighbors) {
    if (!facts) {
      sleepQuality.push({ date, value: null });
      autonomic.push({ date, value: null });
      volumeLoad.push({ date, value: null });
      dayScore.push({ date, value: null });
      continue;
    }
    const s = metricsOf(facts, "sleep");
    const w = (facts as unknown as { workouts?: { metrics?: { volume_load?: number | null } } }).workouts?.metrics;
    // Sleep quality proxy: efficiency_pct.
    sleepQuality.push({ date, value: numOrNull(s.sleep_efficiency_pct) });
    // Autonomic balance proxy: rmssd_ms.
    autonomic.push({ date, value: numOrNull(s.rmssd_ms) });
    volumeLoad.push({ date, value: numOrNull(w?.volume_load) });
    // day_score not in facts yet — populated from per-day day_synthesis later.
    dayScore.push({ date, value: null });
  }

  return {
    sleep_quality_series: sleepQuality,
    autonomic_balance_series: autonomic,
    volume_load_series: volumeLoad,
    day_score_series: dayScore,
  };
}

/**
 * Per-domain metric allowlist surfaced to the drill pages. Keys match
 * `facts.<domain>.metrics`. Adding a metric here exposes it (today value +
 * 14-day series) without any schema change — the schema's detail block uses
 * `additionalProperties`.
 */
const DOMAIN_METRICS: Record<string, readonly string[]> = {
  sleep: [
    "tst_min", "sleep_efficiency_pct", "rmssd_ms", "rhr_sleep_bpm",
    "rem_min", "deep_min", "light_min", "awake_min", "sleep_latency_min",
    "sleep_score", "hr_min_sleep", "hr_max_sleep", "hr_avg_sleep",
    "spo2_min_pct", "breath_rate_mean", "wake_count", "rdi",
    "apnea_max_level", "apnea_events_count", "bedtime_min", "wakeup_min",
  ],
  cardio: ["rhr_day_bpm", "hr_mean_bpm", "hr_max_bpm", "spo2_mean_pct"],
  activity: [
    "steps", "calories_kcal", "distance_m", "active_minutes",
    "sedentary_minutes",
  ],
  stress: ["stress_mean", "stress_max", "high_stress_minutes"],
  body: ["weight_kg", "body_fat_pct", "bmi", "skin_temp_median", "skin_temp_delta_c"],
};

/** Same-day values + 14-day series for every allowlisted domain metric. */
function buildDetail(
  todayFacts: Awaited<ReturnType<typeof buildDailyFacts>>,
  neighbors: Neighbor[],
): Tier1Detail {
  const today: Record<string, number | null> = {};
  const series_14d: Record<string, Point[]> = {};

  for (const [domain, keys] of Object.entries(DOMAIN_METRICS)) {
    const todayMetrics = metricsOf(todayFacts, domain);
    for (const k of keys) {
      const id = `${domain}.${k}`;
      today[id] = numOrNull(todayMetrics[k]);
      series_14d[id] = neighbors.map(({ date, facts }) => ({
        date,
        value: facts ? numOrNull(metricsOf(facts, domain)[k]) : null,
      }));
    }
  }

  return { today, series_14d };
}

// ── context ────────────────────────────────────────────────────────────────

function buildContext(
  periodKey: string,
  facts: Awaited<ReturnType<typeof buildDailyFacts>>,
  _tz: string,
): Tier1Context {
  const dow = computeDayOfWeek(periodKey);
  // anomalies_today: the facts pipeline exposes `anomalies` events for v2;
  // for v4 we still surface them so the dashboard can show pills. Future
  // work: route the same observations into AnomalyExplain.
  const events = extractAnomalies(facts);
  return {
    day_of_week: dow,
    is_weekend: dow === "sat" || dow === "sun",
    plan_session_today: null,        // TODO: wire training plan
    pain_flags_active: [],           // TODO: wire pain-flag state machine
    anomalies_today: events,
  };
}

function extractAnomalies(facts: Awaited<ReturnType<typeof buildDailyFacts>>): AnomalyEvent[] {
  const events = (facts as unknown as { anomalies?: { events?: Array<Record<string, unknown>> } })
    .anomalies?.events;
  if (!Array.isArray(events)) return [];
  return events.map((e) => ({
    code: stringOr(e.code, "unknown"),
    severity: (e.severity === "critical" || e.severity === "warn" || e.severity === "info")
      ? e.severity
      : "info",
    headline_de: stringOr(e.headline_de, ""),
    message_de: stringOr(e.message_de, ""),
    metric: stringOr(e.metric, ""),
    value: numOrNull(e.value as number | null | undefined),
  }));
}

function computeDayOfWeek(periodKey: string): DayOfWeek {
  const [y, m, d] = periodKey.split("-").map(Number);
  // Treat the period key as a calendar date (timezone-independent for weekday).
  const utc = new Date(Date.UTC(y, m - 1, d));
  const idx = utc.getUTCDay(); // 0=Sun..6=Sat
  const map: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[idx];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function msIso(ms: number, tz: string): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const yyyy = get("year");
  const mo = get("month");
  const dd = get("day");
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const mi = get("minute");
  const ss = get("second");
  const local = `${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}`;
  const utcMs = Date.UTC(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const offsetMin = Math.round((utcMs - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${oh}:${om}`;
}
