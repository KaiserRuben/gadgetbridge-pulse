import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import type {
  DailyInsightV2,
  WeeklyRecapV2,
  AlarmsV2,
  AlarmStateV1,
  PauseStateV1,
  LabsV1,
} from "@/lib/types/generated";

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");
const STATE_ROOT = process.env.STATE_ROOT ?? path.join(SYNC_ROOT, "state");

// ── enums ────────────────────────────────────────────────────────────────────

export type Rating = "poor" | "fair" | "good" | "excellent";
export type Direction = "positive" | "neutral" | "negative";
export type Effort = "low" | "medium" | "high";
export type Horizon = "now" | "today" | "tonight" | "tomorrow" | "this_week";
export type VsNorm = "below" | "within" | "above" | "sentinel" | "artifact";
export type LimiterKind =
  | "sentinel"
  | "single_window"
  | "artifact"
  | "data_gap"
  | "sparse_sampling";
export type CeilingReason =
  | null
  | "single_day_window"
  | "sparse_data"
  | "sentinel_heavy"
  | "new_baseline";
export type Severity = "info" | "warn" | "critical";

// ── analysis-layer items (for downstream LLM consumers) ─────────────────────

export type Observation = {
  id: string;
  facts_ref: string;
  value: string | number;
  unit?: string;
  text: string;
};

export type MetricFinding = {
  metric_id: string;
  value: string | number;
  unit?: string;
  vs_norm: VsNorm;
  norm_band: [number, number];
  delta_from_norm?: number;
  interpretation: string;
  reasoning_trace?: string[];
};

export type Pattern = {
  id: string;
  involved_metrics: string[];
  description: string;
  hypothesis?: string;
  testable_with?: string;
};

export type Limiter = {
  kind: LimiterKind;
  metric_id: string | null;
  text: string;
};

export type EvidenceItem = {
  claim_id: string;
  text: string;
  metric_path: string;
  value: string | number;
};

export type ComparisonDelta = {
  metric_id: string;
  delta: number;
  pct?: number;
  period: string;
};

export type Comparison = {
  available: boolean;
  baseline_source: null | "lifetime" | "prior_week" | "prior_month";
  deltas: ComparisonDelta[];
};

// ── verdict (UI consumer) ───────────────────────────────────────────────────

export type Driver = {
  metric_id: string;
  name: string;
  value: number;
  unit: string;
  direction: Direction;
};

export type NextAction = {
  title: string;
  why: string;
  effort: Effort;
  horizon: Horizon;
  targets_metric: string;
};

export type Verdict = {
  rating: Rating;
  score_0_100: number;
  headline: string;
  drivers: Driver[];
  next_action: NextAction | null;
};

// ── confidence ──────────────────────────────────────────────────────────────

export type ConfidenceFactor = {
  factor: string;
  weight: number;
  score: number;
  rationale: string;
};

export type Confidence = {
  value: number;
  calc: number;
  math_check_passed: boolean;
  ceiling_reason: CeilingReason;
  factors: ConfidenceFactor[];
  reasoning: string;
};

// ── upward signals (for abstraction LLM) ────────────────────────────────────

export type CoachSignal = {
  tag: string;
  metric_id: string;
  weight: number;
};

export type WeeklyTrendSignal = {
  metric_id: string;
  value: number;
};

export type AnomalyFlag = {
  id: string;
  severity: Severity;
  details: string;
};

export type UpwardSignals = {
  tags: string[];
  for_coach: CoachSignal[];
  for_weekly_trend: WeeklyTrendSignal[];
  anomalies_flagged: AnomalyFlag[];
};

// ── envelope (runner-stamped, top-level) ───────────────────────────────────

export type DataWindow = {
  start_iso: string;
  end_iso: string;
  samples_seen?: number;
};

// ── full insight (envelope flattened to top level) ─────────────────────────

export type CoachInsight = {
  // envelope
  version: string;
  domain: string;
  timeframe: string;
  period_key: string;
  data_window: DataWindow;
  generated_at: string;
  model: string;
  facts_hash: string;
  duration_ms: number;

  // analysis layer
  context_summary: string;
  observations: Observation[];
  metric_findings: MetricFinding[];
  patterns: Pattern[];
  limiters: Limiter[];
  evidence: EvidenceItem[];
  comparison: Comparison;

  // verdict
  verdict: Verdict;

  // confidence
  confidence: Confidence;

  // upward signals
  upward_signals: UpwardSignals;
};

/**
 * Read an insight JSON. Returns null if absent or unparseable so the UI can
 * render an empty state instead of throwing.
 */
export async function loadInsight(
  timeframe: string,
  periodKey: string,
  domain: string,
): Promise<CoachInsight | null> {
  noStore();
  const p = path.join(INSIGHTS_ROOT, timeframe, periodKey, `${domain}.json`);
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as CoachInsight;
  } catch {
    return null;
  }
}

export function insightAgeHours(insight: CoachInsight): number {
  const t = new Date(insight.generated_at).getTime();
  return (Date.now() - t) / 3_600_000;
}

/**
 * Scan insights/snapshot/ for date folders and return them with quick metadata
 * (which domains have insights, the coach verdict if present). Sorted newest-first.
 */
export type AvailableDay = {
  date: string;
  domains: string[];
  has: { sleep: boolean; cardio: boolean; activity: boolean; body: boolean; stress: boolean; anomalies: boolean; coach: boolean };
  coach?: {
    rating: CoachInsight["verdict"]["rating"];
    score: number;
    headline: string;
    confidence: number;
  };
};

export async function getAvailableDays(): Promise<AvailableDay[]> {
  noStore();
  const { readdir } = await import("node:fs/promises");
  const snapshotRoot = path.join(INSIGHTS_ROOT, "snapshot");
  let folders: string[] = [];
  try {
    folders = await readdir(snapshotRoot);
  } catch {
    return [];
  }
  const days: AvailableDay[] = [];
  for (const f of folders) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) continue;
    const dir = path.join(snapshotRoot, f);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const domains = files
      .filter((n) => n.endsWith(".json") && !n.startsWith("_"))
      .map((n) => n.replace(/\.json$/, ""))
      .filter((d) => !d.includes("."));

    const coach = await loadInsight("snapshot", f, "coach");
    days.push({
      date: f,
      domains,
      has: {
        sleep: domains.includes("sleep"),
        cardio: domains.includes("cardio"),
        activity: domains.includes("activity"),
        body: domains.includes("body"),
        stress: domains.includes("stress"),
        anomalies: domains.includes("anomalies"),
        coach: domains.includes("coach"),
      },
      coach: coach
        ? {
            rating: coach.verdict.rating,
            score: coach.verdict.score_0_100,
            headline: coach.verdict.headline,
            confidence: coach.confidence.value,
          }
        : undefined,
    });
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Per-day trend matrix row. v2 `/week/[domain]` builds these from daily
 * insights to feed the trend-line chart.
 */
export type TrendRow = {
  date: string;
  ratings: Partial<
    Record<
      "sleep" | "cardio" | "activity" | "body" | "stress" | "anomalies" | "coach",
      CoachInsight["verdict"]["rating"]
    >
  >;
  scores: Partial<
    Record<"sleep" | "cardio" | "activity" | "body" | "stress" | "anomalies" | "coach", number>
  >;
  confidences: Partial<
    Record<"sleep" | "cardio" | "activity" | "body" | "stress" | "anomalies" | "coach", number>
  >;
};

// ─── v2 loaders ────────────────────────────────────────────────────────────
// These coexist with the v1 helpers above. Files live under INSIGHTS_ROOT
// (`daily/<YYYY-MM-DD>/daily.json`, `weekly/<YYYY-Www>/weekly.json`,
// `alarms/<YYYY-MM>/alarms.json`) and STATE_ROOT (`alarm_state.json`,
// `pause.json`, `labs.json`). All loaders return `null` on miss so the UI
// renders an empty state instead of throwing.

export async function loadDaily(periodKey: string): Promise<DailyInsightV2 | null> {
  noStore();
  const p = path.join(INSIGHTS_ROOT, "daily", periodKey, "daily.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as DailyInsightV2;
  } catch {
    return null;
  }
}

/**
 * UI gating state for a daily insight.
 *
 *  - `ready`     daily.json present + `_complete` sentinel written. Full LLM
 *                output, safe to render headline/drivers/coaching cards.
 *  - `live`      _facts.json present but no daily.json (or no `_complete`).
 *                In-progress day; runner still gathering data, finalize cron
 *                will run after midnight.
 *  - `absent`    No facts at all for that date. Cold-start or skipped day.
 */
export type DailyStatus = "ready" | "live" | "absent";

export async function loadDailyStatus(periodKey: string): Promise<DailyStatus> {
  noStore();
  const dir = path.join(INSIGHTS_ROOT, "daily", periodKey);
  const dailyPath = path.join(dir, "daily.json");
  const sentinelPath = path.join(dir, "_complete");
  const factsPath = path.join(dir, "_facts.json");
  // `readFile` is the lightest existence check we already use elsewhere; an
  // ENOENT throw is the negative branch.
  const present = async (p: string): Promise<boolean> => {
    try {
      await readFile(p);
      return true;
    } catch {
      return false;
    }
  };
  const [hasDaily, hasSentinel, hasFacts] = await Promise.all([
    present(dailyPath),
    present(sentinelPath),
    present(factsPath),
  ]);
  if (hasDaily && hasSentinel) return "ready";
  if (hasFacts) return "live";
  return "absent";
}

export async function loadWeekly(weekKey: string): Promise<WeeklyRecapV2 | null> {
  noStore();
  const p = path.join(INSIGHTS_ROOT, "weekly", weekKey, "weekly.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as WeeklyRecapV2;
  } catch {
    return null;
  }
}

export async function loadAlarms(monthKey: string): Promise<AlarmsV2 | null> {
  noStore();
  const p = path.join(INSIGHTS_ROOT, "alarms", monthKey, "alarms.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as AlarmsV2;
  } catch {
    return null;
  }
}

export async function loadAlarmState(): Promise<AlarmStateV1 | null> {
  noStore();
  const p = path.join(STATE_ROOT, "alarm_state.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as AlarmStateV1;
  } catch {
    return null;
  }
}

export async function loadPauseState(): Promise<PauseStateV1 | null> {
  noStore();
  const p = path.join(STATE_ROOT, "pause.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as PauseStateV1;
  } catch {
    return null;
  }
}

export async function loadLabs(): Promise<LabsV1 | null> {
  noStore();
  const p = path.join(STATE_ROOT, "labs.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as LabsV1;
  } catch {
    return null;
  }
}

/** Newest YYYY-MM-DD folder under `insights/daily/`, or null if none. */
export async function getLatestDailyDate(): Promise<string | null> {
  noStore();
  const dir = path.join(INSIGHTS_ROOT, "daily");
  try {
    const folders = await readdir(dir);
    return (
      folders
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        .sort()
        .pop() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * ISO week key for today in Europe/Berlin, formatted as `YYYY-Www` (zero-padded
 * week, e.g. `2026-W19`). Mirrors the runner's period_key convention.
 */
export function getCurrentWeekKey(): string {
  // Render today in Europe/Berlin to derive the local Y/M/D, then compute
  // ISO week from that civil date so DST/timezone shifts don't move us across
  // a week boundary.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map((s) => Number.parseInt(s, 10));
  // ISO week algorithm: take Thursday of the current ISO week as anchor.
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7; // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const isoYear = dt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(
    ((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

/** Current month key `YYYY-MM` in Europe/Berlin. Used for alarms file lookup. */
export function getCurrentMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  // en-CA gives YYYY-MM (no day) when day part isn't requested; safe slice anyway.
  return parts.slice(0, 7);
}

/**
 * Count active (un-dismissed, un-snoozed, un-muted) alarms for the current
 * month — used by the bottom-nav badge.
 */
export async function countActiveAlarms(): Promise<number> {
  noStore();
  const monthKey = getCurrentMonthKey();
  const [alarms, state] = await Promise.all([loadAlarms(monthKey), loadAlarmState()]);
  if (!alarms) return 0;
  const now = Date.now();
  const muted = new Set(state?.muted_topics ?? []);
  let count = 0;
  for (const ev of alarms.events) {
    if (ev.dismissed) continue;
    if (muted.has(ev.alarm_id)) continue;
    const snoozeIso = state?.snooze_until?.[ev.alarm_id];
    if (snoozeIso) {
      const t = Date.parse(snoozeIso);
      if (Number.isFinite(t) && t > now) continue;
    }
    count += 1;
  }
  return count;
}
