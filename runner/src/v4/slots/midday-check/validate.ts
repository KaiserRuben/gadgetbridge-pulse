import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildFeedback,
  validateInsight,
  type ValidationResult,
} from "../../validate/grounding.ts";
import { MIDDAY_CHECK_SYSTEM_PROMPT } from "./prompt.ts";
import type { MiddayCheckPackage } from "./package.ts";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schemas",
  "slot-midday-check.schema.json",
);

let _schema: object | null = null;
function loadSchema(): object {
  if (_schema) return _schema;
  _schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
  return _schema;
}

const PROSE_FIELDS = ["headline", "summary_short", "next_window"];

export function validateMiddayCheck(
  rawOutput: string,
  pkg: MiddayCheckPackage,
): ValidationResult {
  return validateInsight(rawOutput, pkg, {
    schema: loadSchema(),
    proseFieldsToScan: PROSE_FIELDS,
    promptText: MIDDAY_CHECK_SYSTEM_PROMPT,
  });
}

export { buildFeedback };
