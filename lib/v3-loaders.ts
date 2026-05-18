import "server-only";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import type {
  SleepInsightV3,
  RecoveryInsightV3,
  ActivityInsightV3,
  SynthesisInsightV3,
  SleepPackage,
  RecoveryPackage,
  ActivityPackage,
  DailyV3Bundle,
  DayScoreResult,
} from "@/lib/types/v3";
import type {
  MorningInsightPayload,
  MorningLeverCard as MorningLeverCardType,
} from "@/runner/clusters/morning_insight/types";
import type {
  SynthesisV3Payload,
} from "@/runner/clusters/synthesis_v3/types";

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT =
  process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");

// ── single-file loaders ──────────────────────────────────────────────────────
//
// JSON-on-disk is the single source of truth. The runner writes atomically
// into $INSIGHTS_ROOT/daily/<date>/* and the dashboard reads on every request
// (every page uses `noStore()`). No DB-first layer — that caused stale reads
// when the HTTP ingest path was unreachable or unset.

export async function loadSleepInsight(date: string): Promise<SleepInsightV3 | null> {
  return readJson<SleepInsightV3>(daily(date, "sleep_insight.json"));
}

export async function loadRecoveryInsight(
  date: string,
): Promise<RecoveryInsightV3 | null> {
  return readJson<RecoveryInsightV3>(daily(date, "recovery_insight.json"));
}

export async function loadActivityInsight(
  date: string,
): Promise<ActivityInsightV3 | null> {
  return readJson<ActivityInsightV3>(daily(date, "activity_insight.json"));
}

/**
 * Training cluster insight (v3 use-case). The schema lives in
 * `runner/src/schemas/training/training-insight.schema.json`; the loader is
 * intentionally typed as `unknown` here because the generated type is
 * `TrainingInsightV1` (training/v1 cluster, not v3) and we don't want to
 * pull that import into the V3 types barrel.
 */
export async function loadTrainingInsight(date: string): Promise<unknown | null> {
  return readJson<unknown>(daily(date, "training_insight.json"));
}

export async function loadTrainingPackage(date: string): Promise<unknown | null> {
  return readJson<unknown>(daily(date, "training_package.json"));
}

/**
 * Morning briefing — fires on `sleep_complete`, bundles the night + this
 * morning + plan + pain history into "spend your day like this" guidance.
 * Replaces the day-end coaching_cards on `daily.json` for the /coach page.
 *
 * Source of truth for the shape lives in
 * `runner/src/clusters/morning_insight/types.ts` (and its mirror schema
 * at `runner/src/clusters/morning_insight/package.schema.json`). The
 * dashboard re-exports the cluster types here so the legacy reader
 * pathway + the new JobCell pathway speak the same TS shape.
 */
export type MorningInsight = MorningInsightPayload;
export type MorningLeverCard = MorningLeverCardType;

export async function loadMorningInsight(date: string): Promise<MorningInsight | null> {
  return readJson<MorningInsight>(daily(date, "morning_insight.json"));
}

export async function loadMorningPackage(date: string): Promise<unknown | null> {
  return readJson<unknown>(daily(date, "morning_package.json"));
}

/**
 * Day-level synthesis (`daily_v3.json`). Phase 3d migration:
 *
 * Source of truth for the cluster payload shape lives in
 * `runner/src/clusters/synthesis_v3/types.ts` (`SynthesisV3Payload`).
 * The dashboard's pre-existing `SynthesisInsightV3` interface in
 * `lib/types/v3.ts` is structurally compatible with the cluster
 * payload's legacy-write shape (`period_key` + `model` are stripped on
 * dual-write), so both names continue to refer to the same on-disk
 * payload. The re-export here lines up the cluster type with the
 * dashboard pathway, mirroring what Phase 3c did for `MorningInsight`.
 */
export type DailyV3InsightPayload = SynthesisV3Payload;

export async function loadDailyV3(date: string): Promise<SynthesisInsightV3 | null> {
  return readJson<SynthesisInsightV3>(daily(date, "daily_v3.json"));
}

export async function loadDayScore(date: string): Promise<DayScoreResult | null> {
  return readJson<DayScoreResult>(daily(date, "day_score.json"));
}

// ── package loaders (raw inputs to the LLM, used by drill-down charts) ──────

export async function loadSleepPackage(date: string): Promise<SleepPackage | null> {
  return readJson<SleepPackage>(daily(date, "sleep_package.json"));
}

export async function loadRecoveryPackage(
  date: string,
): Promise<RecoveryPackage | null> {
  return readJson<RecoveryPackage>(daily(date, "recovery_package.json"));
}

export async function loadActivityPackage(
  date: string,
): Promise<ActivityPackage | null> {
  return readJson<ActivityPackage>(daily(date, "activity_package.json"));
}

// ── aggregate loader (home + day pages) ──────────────────────────────────────

/** Loads all 4 insights + day_score in parallel. Returns null fields where
 * artifacts are missing (live-mode day, abstain, run failure). */
export async function loadDailyV3Bundle(date: string): Promise<DailyV3Bundle> {
  noStore();
  const [daily, sleep, recovery, activity, dayScore] = await Promise.all([
    loadDailyV3(date),
    loadSleepInsight(date),
    loadRecoveryInsight(date),
    loadActivityInsight(date),
    loadDayScore(date),
  ]);
  // Synthesis insight carries the canonical day-level completion flag.
  // Treat truthy / missing `incomplete` as "still in-flight."
  const complete = !!daily && (daily as unknown as { incomplete?: boolean }).incomplete === false;
  return {
    date,
    daily,
    sleep,
    recovery,
    activity,
    day_score: dayScore
      ? { value: dayScore.value, band: dayScore.band, reasoning: dayScore.reasoning }
      : null,
    complete,
  };
}

// ── status (used by the run-progress UI before insights land) ────────────────

export interface DailyV3Status {
  date: string;
  has_sleep_package: boolean;
  has_recovery_package: boolean;
  has_activity_package: boolean;
  has_day_score: boolean;
  has_sleep_insight: boolean;
  has_recovery_insight: boolean;
  has_activity_insight: boolean;
  has_synthesis: boolean;
  complete: boolean;
  /** mtime of the latest artifact, ms since epoch. Null if nothing exists. */
  latest_artifact_mtime_ms: number | null;
}

export async function loadDailyV3Status(date: string): Promise<DailyV3Status> {
  noStore();
  const files = [
    "sleep_package.json",
    "recovery_package.json",
    "activity_package.json",
    "day_score.json",
    "sleep_insight.json",
    "recovery_insight.json",
    "activity_insight.json",
    "daily_v3.json",
  ];
  const [stats, synth] = await Promise.all([
    Promise.all(
      files.map(async (f) => {
        const p = daily_path(date, f);
        try {
          const s = await stat(p);
          return { f, exists: true, mtime: s.mtimeMs };
        } catch {
          return { f, exists: false, mtime: 0 };
        }
      }),
    ),
    loadDailyV3(date),
  ]);
  const present = stats.filter((s) => s.exists);
  const latestMtime =
    present.length > 0 ? Math.max(...present.map((s) => s.mtime)) : null;
  const has = (name: string) => stats.find((s) => s.f === name)?.exists ?? false;
  const complete = !!synth && (synth as unknown as { incomplete?: boolean }).incomplete === false;
  return {
    date,
    has_sleep_package: has("sleep_package.json"),
    has_recovery_package: has("recovery_package.json"),
    has_activity_package: has("activity_package.json"),
    has_day_score: has("day_score.json"),
    has_sleep_insight: has("sleep_insight.json"),
    has_recovery_insight: has("recovery_insight.json"),
    has_activity_insight: has("activity_insight.json"),
    has_synthesis: has("daily_v3.json"),
    complete,
    latest_artifact_mtime_ms: latestMtime,
  };
}

// ── "latest available" helpers ──────────────────────────────────────────────
//
// During the day, today's folder typically only has `sleep_package.json` (the
// morning-wake trigger ran) — activity / recovery / synthesis don't appear
// until day-end. The home page should still show the most recent value for
// every tile, even if those values come from different dates. These helpers
// walk back day-by-day from `latest` and return the first folder that has
// the requested artifact, along with that date.

/** Return all `YYYY-MM-DD` folders under daily/, newest first. */
async function listDailyDates(): Promise<string[]> {
  try {
    const all = await readdir(path.join(INSIGHTS_ROOT, "daily"));
    return all
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export type Dated<T> = { date: string; data: T };

/**
 * Walk back from the newest folder until the loader returns a non-null value.
 * `maxLookbackDays` caps how far we go (default 14 → ~2 weeks).
 */
async function findLatest<T>(
  load: (date: string) => Promise<T | null>,
  maxLookbackDays = 14,
): Promise<Dated<T> | null> {
  const dates = await listDailyDates();
  for (const d of dates.slice(0, maxLookbackDays)) {
    const data = await load(d);
    if (data != null) return { date: d, data };
  }
  return null;
}

export function findLatestSleepPackage(): Promise<Dated<SleepPackage> | null> {
  return findLatest(loadSleepPackage);
}
export function findLatestRecoveryPackage(): Promise<Dated<RecoveryPackage> | null> {
  return findLatest(loadRecoveryPackage);
}
export function findLatestActivityPackage(): Promise<Dated<ActivityPackage> | null> {
  return findLatest(loadActivityPackage);
}
export function findLatestSleepInsight(): Promise<Dated<SleepInsightV3> | null> {
  return findLatest(loadSleepInsight);
}
export function findLatestRecoveryInsight(): Promise<Dated<RecoveryInsightV3> | null> {
  return findLatest(loadRecoveryInsight);
}
export function findLatestActivityInsight(): Promise<Dated<ActivityInsightV3> | null> {
  return findLatest(loadActivityInsight);
}
export function findLatestSynthesis(): Promise<Dated<SynthesisInsightV3> | null> {
  return findLatest(loadDailyV3);
}
export function findLatestDayScore(): Promise<Dated<DayScoreResult> | null> {
  return findLatest(loadDayScore);
}

/** Newest folder whose synthesis insight (`daily_v3.json`) is flagged
 *  `incomplete: false`. Used as the canonical "completed" date for the hero.
 *  Returns null if nothing has finalised. */
export async function getLatestCompleteDate(): Promise<string | null> {
  noStore();
  const dates = await listDailyDates();
  for (const d of dates) {
    const synth = await loadDailyV3(d);
    if (synth && (synth as unknown as { incomplete?: boolean }).incomplete === false) return d;
  }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function daily(date: string, file: string): string {
  return daily_path(date, file);
}

function daily_path(date: string, file: string): string {
  return path.join(INSIGHTS_ROOT, "daily", date, file);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  noStore();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (Object.keys(parsed).length === 0) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export const V3_INSIGHTS_ROOT = INSIGHTS_ROOT;
