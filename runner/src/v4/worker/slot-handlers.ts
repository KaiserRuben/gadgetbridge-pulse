/**
 * Per-slot handler registry. Lifts each slot's (buildPackage, schema,
 * prompts, validator) into a uniform shape the dispatcher can call without
 * branching on slot_id.
 *
 * Imports per-slot modules lazily — keeps the worker bundle slim and
 * isolates per-slot type leaks.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { SlotBuildContext } from "../slots/_shared.ts";
import type { SlotId, Scope } from "../types.ts";

import { buildNightReviewPackage, nightReviewFactsHash } from "../slots/night-review/package.ts";
import { NIGHT_REVIEW_SYSTEM_PROMPT, NIGHT_REVIEW_PROMPT_VERSION, buildNightReviewUserPrompt } from "../slots/night-review/prompt.ts";

import { buildMorningBriefingPackage, morningBriefingFactsHash } from "../slots/morning-briefing/package.ts";
import { MORNING_BRIEFING_SYSTEM_PROMPT, MORNING_BRIEFING_PROMPT_VERSION, buildMorningBriefingUserPrompt } from "../slots/morning-briefing/prompt.ts";

import { buildMiddayCheckPackage, middayCheckFactsHash } from "../slots/midday-check/package.ts";
import { MIDDAY_CHECK_SYSTEM_PROMPT, MIDDAY_CHECK_PROMPT_VERSION, buildMiddayCheckUserPrompt } from "../slots/midday-check/prompt.ts";

import { buildEveningReviewPackage, eveningReviewFactsHash } from "../slots/evening-review/package.ts";
import { EVENING_REVIEW_SYSTEM_PROMPT, EVENING_REVIEW_PROMPT_VERSION, buildEveningReviewUserPrompt } from "../slots/evening-review/prompt.ts";

import { buildDaySynthesisPackage, daySynthesisFactsHash } from "../slots/day-synthesis/package.ts";
import { DAY_SYNTHESIS_SYSTEM_PROMPT, DAY_SYNTHESIS_PROMPT_VERSION, buildDaySynthesisUserPrompt } from "../slots/day-synthesis/prompt.ts";

import { buildPostWorkoutPackage, postWorkoutFactsHash, type PostWorkoutEventRef } from "../slots/post-workout/package.ts";
import { POST_WORKOUT_SYSTEM_PROMPT, POST_WORKOUT_PROMPT_VERSION, buildPostWorkoutUserPrompt } from "../slots/post-workout/prompt.ts";

import { buildAnomalyExplainPackage, anomalyExplainFactsHash, type AnomalyExplainEventRef } from "../slots/anomaly-explain/package.ts";
import { ANOMALY_EXPLAIN_SYSTEM_PROMPT, ANOMALY_EXPLAIN_PROMPT_VERSION, buildAnomalyExplainUserPrompt } from "../slots/anomaly-explain/prompt.ts";

import { buildWeekSynthesisPackage, weekSynthesisFactsHash } from "../slots/week-synthesis/package.ts";
import { WEEK_SYNTHESIS_SYSTEM_PROMPT, WEEK_SYNTHESIS_PROMPT_VERSION, buildWeekSynthesisUserPrompt } from "../slots/week-synthesis/prompt.ts";

const SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
);

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, file), "utf8")) as object;
}

export interface SlotEventRef {
  post_workout?: PostWorkoutEventRef;
  anomaly_explain?: AnomalyExplainEventRef;
}

export interface SlotHandler {
  slot_id: SlotId;
  scope: Scope;
  slot_version: string;
  prompt_version: string;
  system_prompt: string;
  schema: object;
  /**
   * Build the input package for the slot. For event slots, `event` is
   * required (caller asserts).
   */
  buildPackage: (ctx: SlotBuildContext, event?: SlotEventRef) => Promise<unknown>;
  /** Build the user prompt from the package. */
  buildUserPrompt: (pkg: unknown) => string;
  /** Stable hash of the package (for InputsUsed.facts_hash). */
  factsHash: (pkg: unknown) => string;
  /** Which prose fields the validator should scan. (Optional override.) */
  proseFieldsToScan?: string[];
}

// ── Per-slot handlers ──────────────────────────────────────────────────────

export const NIGHT_REVIEW_HANDLER: SlotHandler = {
  slot_id: "night_review",
  scope: "daily",
  slot_version: "night-review/v1",
  prompt_version: NIGHT_REVIEW_PROMPT_VERSION,
  system_prompt: NIGHT_REVIEW_SYSTEM_PROMPT,
  schema: loadSchema("slot-night-review.schema.json"),
  buildPackage: async (ctx) => buildNightReviewPackage(ctx),
  buildUserPrompt: (pkg) => buildNightReviewUserPrompt(pkg as Parameters<typeof buildNightReviewUserPrompt>[0]),
  factsHash: (pkg) => nightReviewFactsHash(pkg as Parameters<typeof nightReviewFactsHash>[0]),
};

export const MORNING_BRIEFING_HANDLER: SlotHandler = {
  slot_id: "morning_briefing",
  scope: "daily",
  slot_version: "morning-briefing/v1",
  prompt_version: MORNING_BRIEFING_PROMPT_VERSION,
  system_prompt: MORNING_BRIEFING_SYSTEM_PROMPT,
  schema: loadSchema("slot-morning-briefing.schema.json"),
  buildPackage: async (ctx) => buildMorningBriefingPackage(ctx),
  buildUserPrompt: (pkg) => buildMorningBriefingUserPrompt(pkg as Parameters<typeof buildMorningBriefingUserPrompt>[0]),
  factsHash: (pkg) => morningBriefingFactsHash(pkg as Parameters<typeof morningBriefingFactsHash>[0]),
};

export const MIDDAY_CHECK_HANDLER: SlotHandler = {
  slot_id: "midday_check",
  scope: "daily",
  slot_version: "midday-check/v1",
  prompt_version: MIDDAY_CHECK_PROMPT_VERSION,
  system_prompt: MIDDAY_CHECK_SYSTEM_PROMPT,
  schema: loadSchema("slot-midday-check.schema.json"),
  buildPackage: async (ctx) => buildMiddayCheckPackage(ctx),
  buildUserPrompt: (pkg) => buildMiddayCheckUserPrompt(pkg as Parameters<typeof buildMiddayCheckUserPrompt>[0]),
  factsHash: (pkg) => middayCheckFactsHash(pkg as Parameters<typeof middayCheckFactsHash>[0]),
};

export const EVENING_REVIEW_HANDLER: SlotHandler = {
  slot_id: "evening_review",
  scope: "daily",
  slot_version: "evening-review/v1",
  prompt_version: EVENING_REVIEW_PROMPT_VERSION,
  system_prompt: EVENING_REVIEW_SYSTEM_PROMPT,
  schema: loadSchema("slot-evening-review.schema.json"),
  buildPackage: async (ctx) => buildEveningReviewPackage(ctx),
  buildUserPrompt: (pkg) => buildEveningReviewUserPrompt(pkg as Parameters<typeof buildEveningReviewUserPrompt>[0]),
  factsHash: (pkg) => eveningReviewFactsHash(pkg as Parameters<typeof eveningReviewFactsHash>[0]),
};

export const DAY_SYNTHESIS_HANDLER: SlotHandler = {
  slot_id: "day_synthesis",
  scope: "daily",
  slot_version: "day-synthesis/v1",
  prompt_version: DAY_SYNTHESIS_PROMPT_VERSION,
  system_prompt: DAY_SYNTHESIS_SYSTEM_PROMPT,
  schema: loadSchema("slot-day-synthesis.schema.json"),
  buildPackage: async (ctx) => buildDaySynthesisPackage(ctx),
  buildUserPrompt: (pkg) => buildDaySynthesisUserPrompt(pkg as Parameters<typeof buildDaySynthesisUserPrompt>[0]),
  factsHash: (pkg) => daySynthesisFactsHash(pkg as Parameters<typeof daySynthesisFactsHash>[0]),
};

export const POST_WORKOUT_HANDLER: SlotHandler = {
  slot_id: "post_workout",
  scope: "daily",
  slot_version: "post-workout/v1",
  prompt_version: POST_WORKOUT_PROMPT_VERSION,
  system_prompt: POST_WORKOUT_SYSTEM_PROMPT,
  schema: loadSchema("slot-post-workout.schema.json"),
  buildPackage: async (ctx, event) => {
    if (!event?.post_workout) throw new Error("post_workout handler requires event.post_workout");
    return buildPostWorkoutPackage({ ctx, event: event.post_workout });
  },
  buildUserPrompt: (pkg) => buildPostWorkoutUserPrompt(pkg as Parameters<typeof buildPostWorkoutUserPrompt>[0]),
  factsHash: (pkg) => postWorkoutFactsHash(pkg as Parameters<typeof postWorkoutFactsHash>[0]),
};

export const ANOMALY_EXPLAIN_HANDLER: SlotHandler = {
  slot_id: "anomaly_explain",
  scope: "daily",
  slot_version: "anomaly-explain/v1",
  prompt_version: ANOMALY_EXPLAIN_PROMPT_VERSION,
  system_prompt: ANOMALY_EXPLAIN_SYSTEM_PROMPT,
  schema: loadSchema("slot-anomaly-explain.schema.json"),
  buildPackage: async (ctx, event) => {
    if (!event?.anomaly_explain) {
      throw new Error("anomaly_explain handler requires event.anomaly_explain");
    }
    return buildAnomalyExplainPackage({ ctx, event: event.anomaly_explain });
  },
  buildUserPrompt: (pkg) => buildAnomalyExplainUserPrompt(pkg as Parameters<typeof buildAnomalyExplainUserPrompt>[0]),
  factsHash: (pkg) => anomalyExplainFactsHash(pkg as Parameters<typeof anomalyExplainFactsHash>[0]),
};

export const WEEK_SYNTHESIS_HANDLER: SlotHandler = {
  slot_id: "week_synthesis",
  scope: "weekly",
  slot_version: "week-synthesis/v1",
  prompt_version: WEEK_SYNTHESIS_PROMPT_VERSION,
  system_prompt: WEEK_SYNTHESIS_SYSTEM_PROMPT,
  schema: loadSchema("slot-week-synthesis.schema.json"),
  buildPackage: async (ctx) => buildWeekSynthesisPackage(ctx),
  buildUserPrompt: (pkg) => buildWeekSynthesisUserPrompt(pkg as Parameters<typeof buildWeekSynthesisUserPrompt>[0]),
  factsHash: (pkg) => weekSynthesisFactsHash(pkg as Parameters<typeof weekSynthesisFactsHash>[0]),
};

export const SLOT_HANDLERS: Record<SlotId, SlotHandler> = {
  night_review: NIGHT_REVIEW_HANDLER,
  morning_briefing: MORNING_BRIEFING_HANDLER,
  midday_check: MIDDAY_CHECK_HANDLER,
  evening_review: EVENING_REVIEW_HANDLER,
  day_synthesis: DAY_SYNTHESIS_HANDLER,
  post_workout: POST_WORKOUT_HANDLER,
  anomaly_explain: ANOMALY_EXPLAIN_HANDLER,
  week_synthesis: WEEK_SYNTHESIS_HANDLER,
};

export function getSlotHandler(slot_id: SlotId): SlotHandler {
  const handler = SLOT_HANDLERS[slot_id];
  if (!handler) throw new Error(`No handler registered for slot ${slot_id}`);
  return handler;
}
