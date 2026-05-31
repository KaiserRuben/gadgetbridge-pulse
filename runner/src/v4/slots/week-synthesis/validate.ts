import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildFeedback,
  validateInsight,
  type ValidationResult,
} from "../../validate/grounding.ts";
import { WEEK_SYNTHESIS_SYSTEM_PROMPT } from "./prompt.ts";
import type { WeekSynthesisPackage } from "./package.ts";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "slot-week-synthesis.schema.json",
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
  "week_narrative",
  "next_week_focus",
  "signal",
  "takeaway",
];

export function validateWeekSynthesis(
  rawOutput: string,
  pkg: WeekSynthesisPackage,
): ValidationResult {
  return validateInsight(rawOutput, pkg, {
    schema: loadSchema(),
    proseFieldsToScan: PROSE_FIELDS,
    promptText: WEEK_SYNTHESIS_SYSTEM_PROMPT,
  });
}

export { buildFeedback };
