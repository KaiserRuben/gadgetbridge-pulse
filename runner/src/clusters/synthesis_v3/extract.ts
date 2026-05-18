/**
 * synthesis_v3 — Stage 0 (extract). Deterministic, no LLM.
 *
 * Loads the three prerequisite cluster insights (sleep, recovery,
 * activity) + the deterministic `day_score.json` + facts for the day,
 * builds the synthesis package via the existing `buildSynthesisPackage`
 * helper, and decides whether the day has enough signal for the LLM
 * synthesis or whether we abstain.
 *
 * Abstain rules:
 *   - no `_facts.json` → "no_facts" (the day folder is empty).
 *   - no `sleep_insight.json` AND no `recovery_insight.json` →
 *                          "no_recovery" / "no_sleep" depending on which
 *                          one is missing first. (The legacy synthesis
 *                          prompt itself shortcuts to abstain when ≥2
 *                          use-cases are missing — same threshold here.)
 *   - missing all three prerequisite insights → "no_signal".
 * Anything else flows through to prose where the LLM fills the synthesis.
 *
 * Cell-key convention: `synthesis_v3.key === period_key` (wake-date,
 * YYYY-MM-DD). Round-trips via `parseSynthesisInputFromKey`.
 *
 * Auto-process: OFF by default. The legacy `runV3` caller fires on every
 * `day_end` event, so a silent-synthesis isn't possible during the
 * dual-write window. Flip `settings:auto_process:synthesis_v3` to ON for
 * the cluster to auto-recompute when the day closes.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { config } from "../../config.ts";
import { computeDayScore } from "../../v3/day-score.ts";
import { pickBaselines, readFactsForDate } from "../../v3/packagers/shared.ts";
import type { DayScoreResult } from "../../v3/day-score.ts";
import {
  buildSynthesisPackage,
  type SynthesisPackage,
  type UseCaseInsight,
} from "../../v3/synthesis.ts";
import type { ClusterContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import type {
  SynthesisExtractInput,
  SynthesisV3Payload,
} from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-trip helper used by the worker — a cell key alone is enough to
 * reconstruct the extract input because `synthesis_v3.key === period_key`.
 */
export function parseSynthesisInputFromKey(
  key: string,
): SynthesisExtractInput | null {
  if (!DATE_RE.test(key)) return null;
  return { period_key: key };
}

function readJsonOrNull<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

interface SynthesisInputsOnDisk {
  sleep: unknown | null;
  recovery: unknown | null;
  activity: unknown | null;
  dayScore: DayScoreResult | null;
  factsPresent: boolean;
}

function loadSynthesisInputsFromDisk(
  insightsRoot: string,
  periodKey: string,
): SynthesisInputsOnDisk {
  const dir = path.join(insightsRoot, "daily", periodKey);
  const factsPath = path.join(dir, "_facts.json");
  const sleep = readJsonOrNull<unknown>(path.join(dir, "sleep_insight.json"));
  const recovery = readJsonOrNull<unknown>(path.join(dir, "recovery_insight.json"));
  const activity = readJsonOrNull<unknown>(path.join(dir, "activity_insight.json"));
  const dayScore = readJsonOrNull<DayScoreResult>(path.join(dir, "day_score.json"));
  return {
    sleep,
    recovery,
    activity,
    dayScore,
    factsPresent: existsSync(factsPath),
  };
}

/**
 * Side-channel for prose(): re-load the synthesis package the same way
 * extract did. Cheap (file-cached) + always fresh — the live-watch
 * pipeline may have rewritten `_facts.json` or a sibling cluster insight
 * in the gap between extract and prose, and we want the LLM to see the
 * latest.
 */
export function loadSynthesisPackage(
  periodKey: string,
): SynthesisPackage | null {
  const inputs = loadSynthesisInputsFromDisk(config.insightsRoot, periodKey);
  if (!inputs.factsPresent) return null;
  const dayScore = inputs.dayScore ?? computeDayScoreFromFacts(periodKey);
  if (!dayScore) return null;
  return buildSynthesisPackage({
    periodKey,
    tz: config.timezone,
    dayOfWeek: dayOfWeekKey(periodKey, config.timezone),
    isWeekend: isWeekend(periodKey, config.timezone),
    sleep: {
      domain: "sleep",
      insight: inputs.sleep,
      ok: !!inputs.sleep && !isAbstain(inputs.sleep),
    },
    recovery: {
      domain: "recovery",
      insight: inputs.recovery,
      ok: !!inputs.recovery && !isAbstain(inputs.recovery),
    },
    activity: {
      domain: "activity",
      insight: inputs.activity,
      ok: !!inputs.activity && !isAbstain(inputs.activity),
    },
    dayScore,
  });
}

function computeDayScoreFromFacts(periodKey: string): DayScoreResult | null {
  const facts = readFactsForDate(config.insightsRoot, periodKey);
  if (!facts) return null;
  const sleep = (facts.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const cardio = (facts.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const activity = (facts.activity as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const stress = (facts.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};

  const baselines = {
    ...pickBaselines(facts, "sleep", ["sleep_efficiency_pct", "tst_min", "rmssd_ms", "rhr_sleep_bpm"]),
    ...pickBaselines(facts, "cardio", ["rhr_day_bpm"]),
    ...pickBaselines(facts, "stress", ["stress_mean"]),
    ...pickBaselines(facts, "activity", ["steps", "active_minutes"]),
  };

  return computeDayScore(
    {
      sleep_efficiency_pct: sleep.sleep_efficiency_pct ?? null,
      tst_min: sleep.tst_min ?? null,
      rmssd_ms: sleep.rmssd_ms ?? null,
      rhr_day_bpm: cardio.rhr_day_bpm ?? null,
      rhr_sleep_bpm: sleep.rhr_sleep_bpm ?? null,
      stress_mean: stress.stress_mean ?? null,
      steps: activity.steps ?? null,
      active_minutes: activity.active_minutes ?? null,
    },
    baselines,
  );
}

function isAbstain(insight: unknown): boolean {
  if (!insight || typeof insight !== "object") return true;
  return (insight as { abstain?: boolean }).abstain === true;
}

function dayOfWeekKey(periodKey: string, tz: string): string {
  const d = new Date(`${periodKey}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return fmt.toLowerCase();
}

function isWeekend(periodKey: string, tz: string): boolean {
  const wd = dayOfWeekKey(periodKey, tz);
  return wd === "sat" || wd === "sun";
}

interface AbstainCheck {
  abstain: boolean;
  reason: string | null;
}

/**
 * Decide whether the day has enough signal for the LLM synthesis call.
 *
 * The legacy `SYNTHESIS_SYSTEM_PROMPT` shortcuts to abstain when ≥2
 * use-cases abstain themselves; we mirror that here with structured
 * reasons so the dashboard can surface the cause.
 */
function decideAbstain(inputs: SynthesisInputsOnDisk): AbstainCheck {
  if (!inputs.factsPresent) {
    return { abstain: true, reason: "no_facts" };
  }
  const sleepOk = !!inputs.sleep && !isAbstain(inputs.sleep);
  const recoveryOk = !!inputs.recovery && !isAbstain(inputs.recovery);
  const activityOk = !!inputs.activity && !isAbstain(inputs.activity);
  const okCount = (sleepOk ? 1 : 0) + (recoveryOk ? 1 : 0) + (activityOk ? 1 : 0);
  if (okCount === 0) {
    return { abstain: true, reason: "no_signal" };
  }
  if (okCount === 1) {
    // ≥2 use-cases missing/abstaining → synthesis abstains per the
    // legacy prompt rule. Pick the most-important missing reason so
    // the dashboard surfaces something actionable.
    if (!sleepOk) return { abstain: true, reason: "no_sleep" };
    if (!recoveryOk) return { abstain: true, reason: "no_recovery" };
    return { abstain: true, reason: "no_signal" };
  }
  return { abstain: false, reason: null };
}

function buildAbstainPayload(periodKey: string, reason: string): SynthesisV3Payload {
  return {
    schema_version: "use_case/synthesis/v1",
    // Final state — the abstain payload is terminal, no LLM regen will
    // land. Matches the legacy writer's behaviour for abstain shortcuts.
    incomplete: false,
    language: "de",
    abstain: true,
    abstain_reason: reason,
    verdict_band: null,
    headline: null,
    summary_short: null,
    summary_long: null,
    key_insight: null,
    top_action_today: null,
    domain_pointers: [],
    contradictions: [],
    confidence: {
      value: 0,
      reasoning: `Abstain: ${reason}. Datenbasis zu dünn für ein belastbares Tagesurteil.`,
    },
    period_key: periodKey,
  };
}

/**
 * Confidence seed from data density. Mirrors the morning/weekly cluster
 * pattern — a deterministic prior the LLM can either trust or override
 * in its own confidence reasoning.
 */
function seedConfidence(inputs: SynthesisInputsOnDisk): number {
  let n = 0;
  if (inputs.sleep && !isAbstain(inputs.sleep)) n += 1;
  if (inputs.recovery && !isAbstain(inputs.recovery)) n += 1;
  if (inputs.activity && !isAbstain(inputs.activity)) n += 1;
  if (n === 3) return 0.7;
  if (n === 2) return 0.5;
  if (n === 1) return 0.3;
  return 0;
}

function buildSeedPayload(
  periodKey: string,
  inputs: SynthesisInputsOnDisk,
): SynthesisV3Payload {
  return {
    schema_version: "use_case/synthesis/v1",
    // Cluster seed is in-flight; the prose stage flips to false at
    // atomic-rename time after the LLM lands.
    incomplete: true,
    language: "de",
    abstain: false,
    abstain_reason: null,
    // Verdict band starts as the deterministic day-score band (the
    // legacy prompt has a "follow day_score_deterministic" rule). The
    // LLM may override on strong contradicting signal.
    verdict_band: inputs.dayScore?.band ?? null,
    headline: null,
    summary_short: null,
    summary_long: null,
    key_insight: null,
    top_action_today: null,
    domain_pointers: [],
    contradictions: [],
    confidence: {
      value: seedConfidence(inputs),
      reasoning: "",
    },
    period_key: periodKey,
  };
}

/**
 * Build the partial extract package. Deterministic, no LLM.
 *
 * Reads the three prerequisite cluster insights (sleep / recovery /
 * activity) + the day's `day_score.json` from disk. When ≥2 of those are
 * missing or abstaining, abstain immediately so prose() skips the LLM
 * call. Otherwise emit a seed payload with `verdict_band` from the
 * day-score, the LLM-fillable prose fields empty, and a confidence
 * value derived from data density.
 */
export async function extract(
  ctx: ClusterContext,
  input: SynthesisExtractInput,
): Promise<PulseDataPackage<SynthesisV3Payload>> {
  if (!input || !DATE_RE.test(input.period_key)) {
    throw new Error(
      `synthesis_v3.extract: invalid period_key '${input?.period_key ?? "(missing)"}'`,
    );
  }
  const periodKey = input.period_key;

  // ctx.periodKey carries the cell key (same as input.period_key).
  void ctx;

  const inputs = loadSynthesisInputsFromDisk(config.insightsRoot, periodKey);

  const { abstain, reason } = decideAbstain(inputs);

  if (abstain && reason) {
    const payload = buildAbstainPayload(periodKey, reason);
    const provenance: ProvenanceTag[] = [
      { field_path: "abstain", source: "rule_computed" },
    ];
    return {
      cluster: "synthesis_v3",
      key: periodKey,
      scope: "daily",
      generated_at: new Date().toISOString(),
      payload,
      provenance,
      deps: [],
      package_version: 1,
    };
  }

  const payload = buildSeedPayload(periodKey, inputs);

  // Provenance for the deterministic fields. verdict_band is seeded
  // from the day-score band (rule_computed); confidence.value is the
  // data-density prior (rule_computed). The LLM may override both in
  // prose; we re-tag them as `llm_derived` there.
  const provenance: ProvenanceTag[] = [
    { field_path: "period_key", source: "rule_computed" },
    { field_path: "verdict_band", source: "rule_computed" },
    { field_path: "confidence.value", source: "rule_computed" },
  ];

  return {
    cluster: "synthesis_v3",
    key: periodKey,
    scope: "daily",
    generated_at: new Date().toISOString(),
    payload,
    provenance,
    deps: [],
    package_version: 1,
  };
}

/** Sidecar helper exported for prose() — re-exports inputs for the LLM call. */
export function loadInputsForProse(
  periodKey: string,
): {
  sleep: UseCaseInsight;
  recovery: UseCaseInsight;
  activity: UseCaseInsight;
  dayScore: DayScoreResult | null;
} {
  const inputs = loadSynthesisInputsFromDisk(config.insightsRoot, periodKey);
  return {
    sleep: {
      domain: "sleep",
      insight: inputs.sleep,
      ok: !!inputs.sleep && !isAbstain(inputs.sleep),
    },
    recovery: {
      domain: "recovery",
      insight: inputs.recovery,
      ok: !!inputs.recovery && !isAbstain(inputs.recovery),
    },
    activity: {
      domain: "activity",
      insight: inputs.activity,
      ok: !!inputs.activity && !isAbstain(inputs.activity),
    },
    dayScore: inputs.dayScore ?? computeDayScoreFromFacts(periodKey),
  };
}
