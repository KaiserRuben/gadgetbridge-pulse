import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildFeedback,
  validateInsight,
  type ValidationResult,
} from "../../validate/grounding.ts";
import { POST_WORKOUT_SYSTEM_PROMPT } from "./prompt.ts";
import type { PostWorkoutPackage } from "./package.ts";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "slot-post-workout.schema.json",
);

let _schema: object | null = null;
function loadSchema(): object {
  if (_schema) return _schema;
  _schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
  return _schema;
}

const PROSE_FIELDS = [
  "headline",
  "summary_short",
  "summary_long",
  "guidance",
  "vs_recent",
  "next_session_hint",
];

export function validatePostWorkout(
  rawOutput: string,
  pkg: PostWorkoutPackage,
): ValidationResult {
  return validateInsight(rawOutput, pkg, {
    schema: loadSchema(),
    proseFieldsToScan: PROSE_FIELDS,
    promptText: POST_WORKOUT_SYSTEM_PROMPT,
  });
}

export { buildFeedback };
