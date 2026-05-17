/**
 * Observation-level suppression gate.
 *
 * Locked policy:
 *   - Anti-orthosomnia: sleep observations are SUPPRESSED in the morning
 *     window 00:00–10:00 local time (morning anxiety amplifies sleep-data
 *     interpretation per Baron 2017 / Bergen Orthosomnia Scale 2025). After
 *     10:00, sleep observations may surface (`anti_orthosomnia_window`
 *     applies before 10:00).
 *   - Pause mode: suppresses S2 + S3. S1 ALWAYS fires.
 *   - "I feel fine" override: suppresses S2 + S3 for the current local day.
 *     S1 ALWAYS fires.
 *   - Step-change suspension: 5 days for S1+S2 pattern alarms, 3 days for S3.
 *     EXCEPT — per the locks, S1 safety alarms always fire (e.g. SpO2 < 88%
 *     or sustained tachycardia must not be muted by a DST transition). So in
 *     practice step-change only suspends S2 (5 days) and S3 (3 days).
 *   - Permanent mute: dismissed_counts[id] >= 2 OR id ∈ muted_topics.
 *   - Snooze: snooze_until[id] >= today (ISO compare, lexicographic OK).
 *
 * Suppressed observations are NOT removed from the output. They are kept
 * with `suppressed_by: [...]` populated so downstream stages can show them
 * in debug views and so the engine can still abstain coherently.
 */

import type { AlarmStateV1, Observation, PauseInputs } from "./types.ts";

export interface SuppressionContext {
  alarmState: AlarmStateV1;
  pause: PauseInputs;
  /** Local hour 0..23, derived from RuleEngineInput.currentLocalTime. */
  localHour: number;
  /** ISO date YYYY-MM-DD for "today" in local time. */
  today: string;
}

export interface SuppressionResult {
  suppressed: boolean;
  by: string[];
}

/**
 * Number of days since `iso` (YYYY-MM-DD) given today (YYYY-MM-DD), in
 * whole calendar days. If the date is in the future returns a negative
 * number. Returns Number.POSITIVE_INFINITY if `iso` is null.
 */
export function daysSince(iso: string | null, today: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / (24 * 3600 * 1000));
}

/**
 * Apply the suppression gate to a single observation.
 *
 * Pure function: does not mutate the input. Returns `{ suppressed, by }`.
 * Caller is responsible for setting `obs.suppressed_by` if it wants to
 * preserve the gate trail in the output.
 */
export function isSuppressed(
  obs: Observation,
  ctx: SuppressionContext,
): SuppressionResult {
  const reasons: string[] = [];
  const tier = obs.tier;
  const isS1 = tier === "S1";
  const isS2 = tier === "S2";
  const isS3 = tier === "S3";

  // 1. Permanent mute (dismiss-twice ⇒ silent forever, plus explicit muted_topics).
  const dismissCount = ctx.alarmState.dismissed_counts[obs.id] ?? 0;
  if (dismissCount >= 2) reasons.push("muted_dismissed_twice");
  if (ctx.alarmState.muted_topics.includes(obs.id)) reasons.push("muted_topic");

  // 2. Snooze: snoozed if snooze_until[id] is set and today < snooze_until.
  //    ISO YYYY-MM-DD strings compare lexicographically the same as dates.
  const snoozeUntil = ctx.alarmState.snooze_until[obs.id];
  if (snoozeUntil && ctx.today < snoozeUntil) reasons.push("snoozed");

  // 3. Anti-orthosomnia: sleep-domain observations suppressed in the morning
  //    window 00:00–10:00 (morning anxiety window). After 10:00 they surface.
  if (obs.domain === "sleep") {
    if (ctx.localHour < 10) reasons.push("anti_orthosomnia_window");
  }

  // 4. Pause mode: suppresses S2 + S3 only. S1 always fires.
  if (ctx.pause.paused && (isS2 || isS3)) {
    reasons.push("pause_mode");
  }

  // 5. "I feel fine" override: suppresses S2 + S3 for current day. S1 always fires.
  if (ctx.pause.i_feel_fine && (isS2 || isS3)) {
    reasons.push("i_feel_fine");
  }

  // 6. Step-change suspension. Per locks, S1 ALWAYS fires; only pattern-tier
  //    S2 (5d) and S3 (3d) get suspended. Hard absolute thresholds in S1
  //    (e.g. SpO2 < 88%) are safety-critical and must not be hidden by DST.
  const stepChangeAge = daysSince(ctx.pause.step_change_detected_on, ctx.today);
  if (Number.isFinite(stepChangeAge) && stepChangeAge >= 0) {
    if (isS2 && stepChangeAge < 5) reasons.push("step_change_suspended_5d");
    else if (isS3 && stepChangeAge < 3) reasons.push("step_change_suspended_3d");
  }

  return { suppressed: reasons.length > 0, by: reasons };
}

/**
 * Helper: extract the local hour (0..23) from an ISO timestamp string,
 * treating the string as already-local (i.e. ignoring the timezone offset).
 *
 * The engine receives `currentLocalTime` from upstream code which is
 * responsible for converting UTC → local using IANA tz; this helper just
 * peels the hour off the resulting string.
 *
 * Examples:
 *   localHourFromIso("2025-05-08T08:30:00")          → 8
 *   localHourFromIso("2025-05-08T08:30:00+02:00")    → 8
 *   localHourFromIso("2025-05-08T22:00:00Z")         → 22
 */
export function localHourFromIso(iso: string): number {
  // Look for the literal `T` separator and grab the next two characters.
  const tIdx = iso.indexOf("T");
  if (tIdx < 0) return 0;
  const hh = iso.slice(tIdx + 1, tIdx + 3);
  const n = Number(hh);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Helper: extract the local date (YYYY-MM-DD) from an ISO timestamp string,
 * treating the string as already-local.
 */
export function localDateFromIso(iso: string): string {
  const tIdx = iso.indexOf("T");
  return tIdx < 0 ? iso : iso.slice(0, tIdx);
}
