/**
 * Post-validator for ExtractedScreenshot.
 *
 * Pure function. Catches the failure modes the Ollama JSON schema can't:
 *   - numeric ranges (weight 30-300 kg, body_fat 1-60 %, …)
 *   - duplicate labels (model occasionally emits the same field twice)
 *   - confidence enum sanity (defensive — schema should enforce it)
 *
 * Out-of-range fields stay in the result but their `confidence` is forced
 * to `low` and a warning is appended. The route handler returns warnings
 * to the client so the review UI can highlight low-confidence rows.
 */

import type {
  ExtractedScreenshot,
  ExtractedField,
  ExtractedFieldLabel,
  ExtractedConfidence,
} from "@/runner/analyzer/screenshot-extractor.ts";

export interface ScreenshotValidationResult {
  ok: boolean;
  warnings: string[];
}

interface RangeRule {
  min: number;
  max: number;
  unit: string;
}

const RANGES: Record<ExtractedFieldLabel, RangeRule> = {
  weight: { min: 30, max: 300, unit: "kg" },
  body_fat_pct: { min: 1, max: 60, unit: "%" },
  muscle_pct: { min: 20, max: 80, unit: "%" },
  bmi: { min: 12, max: 50, unit: "" },
  water_pct: { min: 30, max: 80, unit: "%" },
  bone_mass_kg: { min: 1, max: 10, unit: "kg" },
  basal_metabolism_kcal: { min: 800, max: 3000, unit: "kcal" },
};

const VALID_CONFIDENCES: ReadonlySet<ExtractedConfidence> = new Set([
  "high",
  "medium",
  "low",
]);

/**
 * Validate an extraction and mutate out-of-range fields' confidence to
 * `low` in place. Returns {ok, warnings} where ok = no warnings.
 *
 * Mutation is intentional: the route handler returns the same object to the
 * client, and the review UI keys default-checked off `confidence`. Forcing
 * suspicious values to `low` makes them default-unchecked, which is the
 * desired UX.
 */
export function validateExtraction(
  e: ExtractedScreenshot,
): ScreenshotValidationResult {
  const warnings: string[] = [];
  const seen = new Set<ExtractedFieldLabel>();

  for (let i = 0; i < e.measurements.length; i++) {
    const m: ExtractedField = e.measurements[i];
    const tag = `measurement[${i}] (${m.label})`;

    if (!VALID_CONFIDENCES.has(m.confidence)) {
      warnings.push(`${tag}: invalid confidence '${m.confidence}'`);
      m.confidence = "low";
    }

    if (seen.has(m.label)) {
      warnings.push(`${tag}: duplicate label`);
      m.confidence = "low";
    } else {
      seen.add(m.label);
    }

    const rule = RANGES[m.label];
    if (rule && (m.value < rule.min || m.value > rule.max)) {
      warnings.push(
        `${tag}: value ${m.value} ${m.unit} out of range ${rule.min}–${rule.max} ${rule.unit}`,
      );
      m.confidence = "low";
    }
  }

  return { ok: warnings.length === 0, warnings };
}

export function isAllowedScreenshotLabel(s: string): s is ExtractedFieldLabel {
  return Object.prototype.hasOwnProperty.call(RANGES, s);
}
