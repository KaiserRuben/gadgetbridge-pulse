/**
 * Training schemas loader.
 *
 * Mirrors `schemas/v2/index.ts`: read JSON files at module-load time via
 * `readFileSync` (avoids `import attributes` instability in older tsx).
 * Runtime cost paid once at startup.
 *
 * The runner uses these for Ajv validation of plan documents, set logs,
 * pain flags, adjustment proposals and the training-insight payload.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(name: string): object {
  const p = path.resolve(__dirname, name);
  return JSON.parse(readFileSync(p, "utf8")) as object;
}

export const trainingPlanSchema = load("training-plan.schema.json");
export const exerciseSchema = load("exercise.schema.json");
export const plannedSessionSchema = load("planned-session.schema.json");
export const actualSessionSchema = load("actual-session.schema.json");
export const setLogSchema = load("set-log.schema.json");
export const painFlagSchema = load("pain-flag.schema.json");
export const adjustmentProposalSchema = load("adjustment-proposal.schema.json");
export const trainingInsightSchema = load("training-insight.schema.json");
export const chatMessageSchema = load("chat-message.schema.json");

/**
 * All training schemas, useful for batch Ajv registration with $ref
 * cross-resolution.
 */
export const trainingSchemas = [
  trainingPlanSchema,
  exerciseSchema,
  plannedSessionSchema,
  actualSessionSchema,
  setLogSchema,
  painFlagSchema,
  adjustmentProposalSchema,
  trainingInsightSchema,
  chatMessageSchema,
] as const;
