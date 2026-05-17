import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

/**
 * Schemas live under runner/src/schemas/training/ but the Next.js tsconfig
 * excludes the runner tree wholesale (see `tsconfig.json`). Re-import via
 * `fs.readFileSync` at module-load time so this file stays inside the Next
 * compilation unit while still using the same JSON source-of-truth.
 */
const SCHEMA_DIR = path.resolve(process.cwd(), "runner", "src", "schemas", "training");
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, file), "utf8")) as object;
}

const trainingPlanSchema = loadSchema("training-plan.schema.json");
const exerciseSchema = loadSchema("exercise.schema.json");
const plannedSessionSchema = loadSchema("planned-session.schema.json");
const actualSessionSchema = loadSchema("actual-session.schema.json");
const setLogSchema = loadSchema("set-log.schema.json");
const painFlagSchema = loadSchema("pain-flag.schema.json");
const adjustmentProposalSchema = loadSchema("adjustment-proposal.schema.json");
const trainingInsightSchema = loadSchema("training-insight.schema.json");
const chatMessageSchema = loadSchema("chat-message.schema.json");

/**
 * Single Ajv instance for the Next.js side. Schemas registered with explicit
 * names so $refs across files (e.g. injury_protocol's trigger_location_codes
 * referencing pain-flag.schema.json#/definitions/LocationCode) resolve.
 *
 * Used at ingest boundaries. Reads do not re-validate.
 */
const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
addFormats(ajv);
ajv.addSchema(trainingPlanSchema, "training-plan.schema.json");
ajv.addSchema(exerciseSchema, "exercise.schema.json");
ajv.addSchema(plannedSessionSchema, "planned-session.schema.json");
ajv.addSchema(actualSessionSchema, "actual-session.schema.json");
ajv.addSchema(setLogSchema, "set-log.schema.json");
ajv.addSchema(painFlagSchema, "pain-flag.schema.json");
ajv.addSchema(adjustmentProposalSchema, "adjustment-proposal.schema.json");
ajv.addSchema(trainingInsightSchema, "training-insight.schema.json");
ajv.addSchema(chatMessageSchema, "chat-message.schema.json");

const validatorByRef = new Map<string, ValidateFunction>();
function get(ref: string): ValidateFunction {
  let v = validatorByRef.get(ref);
  if (!v) {
    const compiled = ajv.getSchema(ref);
    if (!compiled) throw new Error(`schema ${ref} not registered`);
    v = compiled;
    validatorByRef.set(ref, v);
  }
  return v;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function run(ref: string, data: unknown): ValidationResult {
  const v = get(ref);
  const ok = v(data) === true;
  return ok
    ? { ok: true, errors: [] }
    : { ok: false, errors: (v.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`.trim()) };
}

export const validateTrainingPlan = (data: unknown): ValidationResult =>
  run("training-plan.schema.json", data);
export const validateExercise = (data: unknown): ValidationResult =>
  run("exercise.schema.json", data);
export const validatePlannedSession = (data: unknown): ValidationResult =>
  run("planned-session.schema.json", data);
export const validateActualSession = (data: unknown): ValidationResult =>
  run("actual-session.schema.json", data);
export const validateSetLog = (data: unknown): ValidationResult =>
  run("set-log.schema.json", data);
export const validatePainFlag = (data: unknown): ValidationResult =>
  run("pain-flag.schema.json", data);
export const validateAdjustmentProposal = (data: unknown): ValidationResult =>
  run("adjustment-proposal.schema.json", data);
export const validateTrainingInsight = (data: unknown): ValidationResult =>
  run("training-insight.schema.json", data);
export const validateChatMessage = (data: unknown): ValidationResult =>
  run("chat-message.schema.json", data);
