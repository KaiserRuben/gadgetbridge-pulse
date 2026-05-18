/**
 * weekly_recap — Stage 0 (extract). Deterministic, no LLM.
 *
 * Loads 7 days of `_facts.json` + `daily.json` for the target ISO week,
 * computes streaks / personal-best / personal-worst / recurring-driver
 * aggregates, and returns a partial `WeeklyRecapPayload`. The prose stage
 * (`prose.ts`) calls the legacy weekly LLM to fill `trajectory_headline`,
 * `pattern_callouts`, `personal_best.note`, `personal_worst.action_or_note`,
 * `micro_experiment`, and `reasoning_trace`.
 *
 * Cell-key convention: the cluster cell uses `weekKey` itself
 * (`YYYY-W##`, e.g. `2026-W20`) for both `period_key` and `key` in
 * `PULSE_INSIGHT`. The worker derives the extract input from the cell key
 * (see `parseWeeklyInputFromKey`).
 *
 * Auto-process: OFF by default per the JobCell migration spec — even
 * though the legacy `stageW-weekly` ran automatically every Sunday. The
 * legacy caller is left in place during the dual-write window, so a
 * silent-Sunday is not possible. Flip `settings:auto_process` (global) or
 * `settings:auto_process:weekly_recap` (per-cluster) to restore the
 * automatic recompute path.
 *
 * Abstain rules (matched against legacy stage):
 *   - <4 days with any `_facts.json` content → abstain "insufficient_data".
 * The prose stage skips the LLM when `abstain === true` and returns the
 * deterministic abstain payload as-is, just like the legacy stage's
 * `abstainPayload(weekKey, "insufficient_data")` shortcut.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";

import { config } from "../../config.ts";
import { datesInWeek } from "../../period.ts";
import type { ClusterContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import type {
  WeeklyExtractInput,
  WeeklyPersonalBest,
  WeeklyPersonalWorst,
  WeeklyRecapPayload,
  WeeklyStreak,
} from "./types.ts";

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

/**
 * Round-trip helper used by the worker — a cell key alone is enough to
 * reconstruct the extract input because `weekly_recap.key === weekKey`.
 */
export function parseWeeklyInputFromKey(key: string): WeeklyExtractInput | null {
  if (!WEEK_KEY_RE.test(key)) return null;
  return { week_key: key };
}

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

function longestRun(arr: number[]): number {
  let best = 0;
  let cur = 0;
  for (const v of arr) {
    if (v) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

interface RecordPick {
  best: WeeklyPersonalBest | null;
  worst: WeeklyPersonalWorst | null;
}

/**
 * Score a metric across the week and return the extreme date+value pair
 * in each direction. `read` extracts the value from a facts row; null
 * values are skipped. When all values are equal we still emit a `best`
 * but leave `worst` null so the dashboard doesn't show a phantom
 * "schwerster Tag" identical to the best.
 */
function pickExtremes(
  dates: string[],
  facts: Array<FactsBundleV2 | null>,
  metricId: string,
  read: (f: FactsBundleV2) => number | null,
  direction: "max" | "min",
): RecordPick {
  let bestVal: number | null = null;
  let bestDate: string | null = null;
  let worstVal: number | null = null;
  let worstDate: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const f = facts[i];
    if (!f) continue;
    const v = read(f);
    if (v == null) continue;
    if (bestVal == null) {
      bestVal = v;
      bestDate = dates[i];
      worstVal = v;
      worstDate = dates[i];
      continue;
    }
    if (direction === "max") {
      if (v > bestVal) {
        bestVal = v;
        bestDate = dates[i];
      }
      if (v < (worstVal as number)) {
        worstVal = v;
        worstDate = dates[i];
      }
    } else {
      if (v < bestVal) {
        bestVal = v;
        bestDate = dates[i];
      }
      if (v > (worstVal as number)) {
        worstVal = v;
        worstDate = dates[i];
      }
    }
  }
  const best: WeeklyPersonalBest | null =
    bestVal != null && bestDate
      ? { metric_id: metricId, value: +bestVal.toFixed(2), date: bestDate, note: null }
      : null;
  const worst: WeeklyPersonalWorst | null =
    worstVal != null && worstDate && worstDate !== bestDate
      ? {
          metric_id: metricId,
          value: +worstVal.toFixed(2),
          date: worstDate,
          // Filled by prose; the schema requires non-empty so we seed a
          // placeholder rather than an empty string. The repair pass in
          // the legacy stage uses the same default.
          action_or_note: "fortlaufend beobachten",
        }
      : null;
  return { best, worst };
}

/**
 * Build the partial extract package. Deterministic + cheap — no LLM.
 *
 * The legacy `stageW-weekly` computes the same aggregates inline before
 * the LLM call; we duplicate the math here so the cluster's `extract` is
 * standalone (and so the test suite can validate it without spinning up
 * the entire stage path).
 */
export async function extract(
  ctx: ClusterContext,
  input: WeeklyExtractInput,
): Promise<PulseDataPackage<WeeklyRecapPayload>> {
  if (!input || !WEEK_KEY_RE.test(input.week_key)) {
    throw new Error(
      `weekly_recap.extract: invalid week_key '${input?.week_key ?? "(missing)"}'`,
    );
  }
  const weekKey = input.week_key;
  const dates = datesInWeek(weekKey);
  void ctx; // ctx.periodKey is the weekKey here; everything we need is in `input`.

  const [facts, dailies] = await Promise.all([
    Promise.all(
      dates.map((d) =>
        readJsonOrNull<FactsBundleV2>(path.join(config.insightsRoot, "daily", d, "_facts.json")),
      ),
    ),
    Promise.all(
      dates.map((d) =>
        readJsonOrNull<DailyInsightV2>(path.join(config.insightsRoot, "daily", d, "daily.json")),
      ),
    ),
  ]);

  const presentCount = facts.filter((f) => f != null).length;
  const provenance: ProvenanceTag[] = [];

  // ── Abstain shortcut ──────────────────────────────────────────────────
  // Same threshold as the legacy stage. The prose stage detects abstain
  // and returns the payload untouched (no LLM call, no per-field LLM
  // provenance), so we tag the deterministic fields here.
  if (presentCount < 4) {
    const abstain: WeeklyRecapPayload = {
      week_key: weekKey,
      schema_version: "weekly/v2",
      language: "de",
      reasoning_trace: "",
      abstain: true,
      abstain_reason: "insufficient_data",
      trajectory_headline: {
        recovery: "Datenlücke",
        activity: "Datenlücke",
        stress: "Datenlücke",
      },
      chart_refs: [],
      pattern_callouts: [],
      streaks: [],
      personal_best: null,
      personal_worst: null,
      micro_experiment: null,
      confidence: {
        value: 0,
        calc: "abstain",
        factors: ["insufficient_data"],
      },
    };
    provenance.push({
      field_path: "abstain",
      source: "rule_computed",
    });
    return {
      cluster: "weekly_recap",
      key: weekKey,
      scope: "weekly",
      generated_at: new Date().toISOString(),
      payload: abstain,
      provenance,
      deps: [],
      package_version: 1,
    };
  }

  // ── Streaks ──────────────────────────────────────────────────────────
  const streaks: WeeklyStreak[] = [];
  const stepStreak = longestRun(
    facts.map((f) => {
      const v = f?.activity?.metrics?.steps;
      return v != null && v >= 8000 ? 1 : 0;
    }),
  );
  if (stepStreak >= 3) {
    streaks.push({
      id: "step_goal_streak",
      label: `${stepStreak} Tage in Folge ≥8000 Schritte`,
      length_days: stepStreak,
      metric_id: "activity.metrics.steps",
    });
  }
  const sleepEffStreak = longestRun(
    facts.map((f) => {
      const v = f?.sleep?.metrics?.sleep_efficiency_pct;
      return v != null && v >= 85 ? 1 : 0;
    }),
  );
  if (sleepEffStreak >= 3) {
    streaks.push({
      id: "sleep_eff_streak",
      label: `${sleepEffStreak} Tage Schlafeffizienz ≥85%`,
      length_days: sleepEffStreak,
      metric_id: "sleep.metrics.sleep_efficiency_pct",
    });
  }
  for (const s of streaks) {
    provenance.push({
      field_path: `streaks[${streaks.indexOf(s)}]`,
      source: "rule_computed",
    });
  }

  // ── Personal best / worst ────────────────────────────────────────────
  // Headline metric: steps (max). Worst headline: rhr (high = worse).
  // Symmetry with the legacy stage: the LLM only ever surfaced one of
  // these per recap, so we pick the strongest signal here too.
  const stepsPick = pickExtremes(
    dates,
    facts,
    "activity.metrics.steps",
    (f) => f.activity?.metrics?.steps ?? null,
    "max",
  );
  const rhrPick = pickExtremes(
    dates,
    facts,
    "cardio.metrics.rhr_day_bpm",
    (f) => f.cardio?.metrics?.rhr_day_bpm ?? null,
    "min",
  );
  const personal_best = stepsPick.best;
  const personal_worst = rhrPick.worst ?? stepsPick.worst;
  if (personal_best) {
    provenance.push({ field_path: "personal_best.value", source: "rule_computed" });
  }
  if (personal_worst) {
    provenance.push({ field_path: "personal_worst.value", source: "rule_computed" });
  }

  // ── Confidence (deterministic base) ──────────────────────────────────
  // Legacy stage uses an LLM-emitted confidence object. We seed with the
  // data-density signal here so the abstain/non-abstain branches both
  // produce a valid schema; prose() may overwrite it with the LLM's own
  // confidence calculation.
  const baseConfidence =
    presentCount === 7
      ? 0.85
      : presentCount >= 6
        ? 0.7
        : presentCount >= 5
          ? 0.55
          : 0.4;

  const payload: WeeklyRecapPayload = {
    week_key: weekKey,
    schema_version: "weekly/v2",
    language: "de",
    reasoning_trace: "",
    abstain: false,
    abstain_reason: null,
    trajectory_headline: {
      recovery: "",
      activity: "",
      stress: "",
    },
    chart_refs: [],
    pattern_callouts: [],
    streaks,
    personal_best,
    personal_worst,
    micro_experiment: null,
    confidence: {
      value: baseConfidence,
      calc: `data_density=${presentCount}/7 → base ${baseConfidence.toFixed(2)}`,
      factors: [`${presentCount}/7 Tage mit Daten`],
    },
  };

  // Tag the deterministic fields produced here. The prose stage will
  // append `llm_derived` provenance for the trajectory_headline /
  // pattern_callouts / micro_experiment / notes it fills in.
  provenance.push(
    { field_path: "week_key", source: "rule_computed" },
    { field_path: "confidence.value", source: "rule_computed" },
  );

  // Stash dailies count via provenance only (we don't enlarge the
  // payload). dailies are referenced by prose via a side-channel reload
  // similar to the anomaly cluster's facts_window loader.
  void dailies;

  return {
    cluster: "weekly_recap",
    key: weekKey,
    scope: "weekly",
    generated_at: new Date().toISOString(),
    payload,
    provenance,
    deps: [],
    package_version: 1,
  };
}

/**
 * Side-channel: prose() needs the same 7-day facts + dailies window the
 * extract loaded so the LLM gets the full picture. Re-running the file
 * reads is cheap (page-cached) and keeps the payload schema slim.
 */
export async function loadWeeklyWindow(
  weekKey: string,
): Promise<{
  dates: string[];
  facts: Array<FactsBundleV2 | null>;
  dailies: Array<DailyInsightV2 | null>;
}> {
  const dates = datesInWeek(weekKey);
  const [facts, dailies] = await Promise.all([
    Promise.all(
      dates.map((d) =>
        readJsonOrNull<FactsBundleV2>(path.join(config.insightsRoot, "daily", d, "_facts.json")),
      ),
    ),
    Promise.all(
      dates.map((d) =>
        readJsonOrNull<DailyInsightV2>(path.join(config.insightsRoot, "daily", d, "daily.json")),
      ),
    ),
  ]);
  return { dates, facts, dailies };
}
