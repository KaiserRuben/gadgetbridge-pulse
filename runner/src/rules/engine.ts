/**
 * Rule-engine entry point.
 *
 * Pure synchronous function:
 *   runRuleEngine(input) → { observations, abstain, abstain_reason }
 *
 * Pipeline:
 *   1. Run all domain rule functions (sleep, heart, body, stress, activity,
 *      data_quality, system) and collect their observations.
 *   2. Cold-start gate: if <14 nights, drop all S2/S3 observations
 *      (absolute thresholds in S1 still fire).
 *   3. Apply suppression to each remaining observation. Suppressed items
 *      keep their place in the output but receive `suppressed_by`. They are
 *      excluded from the actionable count used by the abstain rule.
 *   4. Abstention: if zero non-suppressed S1/S2/S3 observations AND <3 info
 *      observations remain, emit `nothing_notable` and set abstain=true.
 *
 * No LLM. No I/O. No randomness.
 */

import type {
  Observation,
  RuleEngineInput,
  RuleEngineOutput,
} from "./types.ts";

import { runSleepDomain } from "./domains/sleep.ts";
import { runHeartDomain } from "./domains/heart.ts";
import { runBodyDomain } from "./domains/body.ts";
import { runStressDomain } from "./domains/stress.ts";
import { runActivityDomain } from "./domains/activity.ts";
import { runDataQualityDomain } from "./domains/data_quality.ts";
import { runSystemDomain, buildNothingNotable } from "./domains/system.ts";

import {
  isSuppressed,
  localHourFromIso,
  localDateFromIso,
  type SuppressionContext,
} from "./suppression.ts";

const COLD_START_NIGHTS = 14;

/**
 * S1 absolute-threshold observations that fire from day 1 even during
 * cold-start. The locks state: pattern alarms gate at 14 nights;
 * absolute thresholds fire from day 1.
 */
const COLD_START_BYPASS_IDS = new Set<string>([
  // Heart
  "rhr_tachycardia_safety",
  // Body
  "spo2_critical_low",
  // Sleep
  "sleep_apnea_safety",
  "sleep_total_time_critical",
  "sleep_efficiency_low_critical",
  "sleep_latency_high_critical",
]);

function runAllDomains(input: RuleEngineInput): Observation[] {
  return [
    ...runSleepDomain(input),
    ...runHeartDomain(input),
    ...runBodyDomain(input),
    ...runStressDomain(input),
    ...runActivityDomain(input),
    ...runDataQualityDomain(input),
    ...runSystemDomain(input),
  ];
}

/**
 * Cold-start filter: while we have <14 nights of data, drop any S2/S3
 * observations that aren't on the absolute-threshold bypass list. Info
 * (tier=null) and S1 always pass.
 */
function applyColdStart(
  obs: Observation[],
  totalNights: number,
): Observation[] {
  if (totalNights >= COLD_START_NIGHTS) return obs;
  return obs.filter((o) => {
    if (o.tier === null) return true;
    if (o.tier === "S1") return true;
    if (COLD_START_BYPASS_IDS.has(o.id)) return true;
    return false;
  });
}

export function runRuleEngine(input: RuleEngineInput): RuleEngineOutput {
  const totalNights = input.history.total_nights_observed ?? 0;

  const localHour = localHourFromIso(input.currentLocalTime);
  const today = localDateFromIso(input.currentLocalTime);
  const ctx: SuppressionContext = {
    alarmState: input.alarmState,
    pause: input.pause,
    localHour,
    today,
  };

  // 1. Run all domain rules.
  const raw = runAllDomains(input);

  // 2. Cold-start filter.
  const afterColdStart = applyColdStart(raw, totalNights);

  // 3. Apply suppression in-place (clone-and-tag).
  const tagged: Observation[] = afterColdStart.map((o) => {
    const res = isSuppressed(o, ctx);
    if (!res.suppressed) return o;
    return { ...o, suppressed_by: res.by };
  });

  // 4. Count actionable (non-suppressed) by tier.
  const actionable = tagged.filter(
    (o) => !o.suppressed_by || o.suppressed_by.length === 0,
  );
  const tieredCount = actionable.filter((o) => o.tier !== null).length;
  // Per prose-architect spec: data_quality + system info observations
  // (cold_start_active, dq_*) are NOT narratable on their own. Exclude from
  // the abstention threshold — only domain-specific info observations count.
  const narratableInfoCount = actionable.filter(
    (o) =>
      o.tier === null &&
      o.domain !== "data_quality" &&
      o.domain !== "system",
  ).length;

  // 5. Abstention: if no tiered AND no narratable info → emit nothing_notable.
  if (tieredCount === 0 && narratableInfoCount === 0) {
    const reason =
      totalNights < COLD_START_NIGHTS
        ? `Cold-start: ${totalNights}/${COLD_START_NIGHTS} nights of baseline.`
        : "All metrics within personal range.";
    const nothingNotable = buildNothingNotable(input, reason);
    return {
      observations: [...tagged, nothingNotable],
      abstain: true,
      abstain_reason: reason,
    };
  }

  return {
    observations: tagged,
    abstain: false,
    abstain_reason: null,
  };
}
