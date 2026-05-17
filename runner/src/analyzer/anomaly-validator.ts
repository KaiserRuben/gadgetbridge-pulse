/**
 * Post-validator for AnomalyExplanation.
 *
 * Per PROBE_anomaly_explanation.md "Failure modes" 2-4: qwen3.6 occasionally
 * promotes plausible-but-wobbly inferential links to `strong`, slips a
 * meta-hypothesis ("missing baseline") into the ranked list, or leans on
 * shaky physiological framing. The schema can't catch these; this validator
 * surfaces them as warnings without blocking the response.
 *
 * Pure function. No I/O. Returns warnings; the route handler logs them and
 * still returns the explanation to the client (transparency over guardrails
 * — the user sees the rationale and can dismiss).
 */

import type {
  AnomalyExplanation,
  AnomalyExplanationInput,
  HypothesisStrength,
} from "./anomaly-explanation.ts";

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
}

/** Matches integers and decimals (German "," and English "."). */
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

/** Diagnostic terms that must never appear in the rationale. */
const DIAGNOSTIC_RE = /\b(Diabetes|Bluthochdruck|Apnoe|AFib|Vorhofflimmern|Burnout|Tachykardie|Bradykardie|Arrhythmie|Schlafapnoe)\b/i;

/** Medication / substance names that must never appear in the rationale. */
const MEDICATION_RE = /\b(Ibuprofen|Melatonin|Magnesium|Schlafmittel|Nahrungsergänzung|Supplement)\b/i;

const VALID_STRENGTHS: ReadonlySet<HypothesisStrength> = new Set([
  "strong",
  "moderate",
  "weak",
  "unlikely",
]);

/**
 * Normalize a numeric string for cross-locale equality. The model may write
 * "551" while the input has "551" — direct match. But it may also write
 * "551,0" while input has "551.0" or just "551". Strip thousand separators
 * (none expected for health metrics) and unify decimal separator.
 */
function normalizeNumber(s: string): string {
  return s.replace(",", ".");
}

export function validateExplanation(
  explanation: AnomalyExplanation,
  input: AnomalyExplanationInput,
): ValidationResult {
  const warnings: string[] = [];

  // Build a lookup haystack of every numeric token in the 7-day context.
  // Stringifying once is cheap and lets us substring-search for cited values.
  const contextHaystack = JSON.stringify(input.context_facts);
  const contextNumbers = new Set<string>();
  for (const m of contextHaystack.matchAll(NUMBER_RE)) {
    contextNumbers.add(normalizeNumber(m[0]));
  }

  for (let i = 0; i < explanation.hypotheses.length; i++) {
    const h = explanation.hypotheses[i];
    const tag = `hypothesis[${i}] (${h.factor})`;

    if (!VALID_STRENGTHS.has(h.strength)) {
      warnings.push(`${tag}: invalid strength '${h.strength}' (defensive check)`);
    }

    if (DIAGNOSTIC_RE.test(h.rationale)) {
      warnings.push(`${tag}: rationale contains diagnostic term`);
    }
    if (MEDICATION_RE.test(h.rationale)) {
      warnings.push(`${tag}: rationale references medication/substance`);
    }

    if (h.strength === "strong") {
      const cited = h.rationale.match(NUMBER_RE) ?? [];
      if (cited.length === 0) {
        warnings.push(`${tag}: strong hypothesis cites no numeric value`);
      } else {
        const matched = cited.some((n) => contextNumbers.has(normalizeNumber(n)));
        if (!matched) {
          warnings.push(
            `${tag}: strong rationale cites number(s) ${cited.join(",")} not found in 7-day context`,
          );
        }
      }
    }
  }

  return { ok: warnings.length === 0, warnings };
}
