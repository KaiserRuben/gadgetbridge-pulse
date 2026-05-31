/**
 * Night-review validator.
 *
 * Loads slot's JSON schema once, wraps the shared `validateInsight` helper
 * with night-review-specific prose fields + noise filter.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildFeedback,
  validateInsight,
  type ValidationResult,
} from "../../validate/grounding.ts";
import { NIGHT_REVIEW_SYSTEM_PROMPT } from "./prompt.ts";
import type { NightReviewPackage } from "./package.ts";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "slot-night-review.schema.json",
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
  "analysis_today",
  "analysis_context",
];

export function validateNightReview(
  rawOutput: string,
  pkg: NightReviewPackage,
): ValidationResult {
  return validateInsight(rawOutput, pkg, {
    schema: loadSchema(),
    proseFieldsToScan: PROSE_FIELDS,
    promptText: NIGHT_REVIEW_SYSTEM_PROMPT,
  });
}

export { buildFeedback };
