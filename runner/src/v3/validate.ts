/**
 * Shared validation + retry harness for v3 use cases.
 *
 * Validates an LLM output against:
 *   1. JSON parseability (with lenient extractor for prompt-only mode)
 *   2. AJV schema
 *   3. Numeric grounding (every cited number appears in the input package)
 *
 * On failure, can run a retry loop with feedback injected into the next call.
 */

import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";

export interface ValidationOptions {
  schema: object;
  ajv?: Ajv;
  /** Numeric values like 0..7 (small integers) and 100 are treated as noise. */
  groundingNoiseFilter?: (n: number) => boolean;
  /** Override which output fields are scanned for numbers. */
  proseFieldsToScan?: string[];
}

export interface ValidationResult {
  ok: boolean;
  schemaValid: boolean;
  schemaErrors: string[];
  /** Non-fatal schema issues (currently maxLength/minLength overflows). */
  schemaWarnings: string[];
  groundingErrors: string[];
  parsed: unknown;
  parseError: string | null;
  raw: string;
}

/** AJV keywords that should not fail validation — surfaced as warnings only. */
const SOFT_KEYWORDS = new Set(["maxLength", "minLength"]);

const DEFAULT_PROSE_FIELDS = [
  "headline",
  "summary_short",
  "summary_long",
  "analysis_today",
  "analysis_context",
  "key_insight",
];

/** Builds a shared Ajv instance with formats + lenient strict-mode. */
export function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

/** Validate one LLM output against schema + grounding. */
export function validateInsight(
  rawOutput: string,
  pkg: unknown,
  opts: ValidationOptions,
): ValidationResult {
  const ajv = opts.ajv ?? makeAjv();
  const validate = ajv.compile(opts.schema);

  const jsonText = extractJson(rawOutput);
  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  // Inject the completion flag (default true). The writer flips to false at
  // atomic-rename time. LLM is never told about this field — it stays
  // payload-local plumbing for the runner + dashboard.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (!("incomplete" in obj)) obj.incomplete = true;
  }

  // Run AJV; partition errors into hard schema violations vs. soft warnings
  // (length overflows). Length issues should not trigger retries — model rarely
  // recovers by writing shorter prose and we'd rather keep the content.
  if (parsed != null) validate(parsed);
  const allErrors = validate.errors ?? [];
  const hardAjvErrors = allErrors.filter((e) => !SOFT_KEYWORDS.has(e.keyword));
  const softAjvErrors = allErrors.filter((e) => SOFT_KEYWORDS.has(e.keyword));

  const schemaValid = parsed != null && hardAjvErrors.length === 0;
  const schemaErrors = hardAjvErrors.map(formatError);
  const schemaWarnings = softAjvErrors.map(formatError);
  if (parseError) schemaErrors.unshift(`JSON.parse: ${parseError}`);

  const groundingErrors =
    parsed && schemaValid
      ? checkGrounding(parsed, pkg, {
          fields: opts.proseFieldsToScan ?? DEFAULT_PROSE_FIELDS,
          isNoise: opts.groundingNoiseFilter ?? defaultNoiseFilter,
        })
      : [];

  return {
    ok: schemaValid && groundingErrors.length === 0,
    schemaValid,
    schemaErrors,
    schemaWarnings,
    groundingErrors,
    parsed,
    parseError,
    raw: rawOutput,
  };
}

/** Build a feedback string the caller can inject into the next LLM attempt. */
export function buildFeedback(result: ValidationResult): string {
  const lines: string[] = [];
  if (!result.schemaValid) {
    lines.push("VORHERIGE ANTWORT WAR INVALID. Korrigiere folgende Schema-Verstöße:");
    for (const e of result.schemaErrors.slice(0, 12)) lines.push(`  - ${e}`);
  } else if (result.groundingErrors.length > 0) {
    lines.push("VORHERIGE ANTWORT ENTHIELT NICHT-GEGROUNDETE ZAHLEN:");
    for (const e of result.groundingErrors.slice(0, 8)) lines.push(`  - ${e}`);
    lines.push("Verwende NUR Zahlen aus dem Paket. Keine erfundenen Werte oder Sequenzen.");
  }
  return lines.join("\n");
}

// ── JSON extraction (handles prompt-only mode where model may add prose) ─────

export function extractJson(text: string): string {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenced.length > 0) return fenced[fenced.length - 1][1].trim();
  // Walk balanced { ... } objects, return last that parses (prefer those with
  // a "schema_version" marker — handles models that echo schema before answer).
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  const withMarker = candidates.filter((c) => /"schema_version"\s*:\s*"use_case\//.test(c));
  const pool = withMarker.length > 0 ? withMarker : candidates;
  for (let i = pool.length - 1; i >= 0; i--) {
    try {
      JSON.parse(pool[i]);
      return pool[i];
    } catch {
      // try previous
    }
  }
  return text;
}

// ── Numeric grounding ───────────────────────────────────────────────────────

interface GroundingOpts {
  fields: string[];
  isNoise: (n: number) => boolean;
}

function checkGrounding(parsed: unknown, pkg: unknown, opts: GroundingOpts): string[] {
  const numbersInPkg = new Set<string>();
  collectNumbers(pkg, numbersInPkg);

  // Add pairwise differences (signed AND absolute) and sums of package numbers —
  // common derivations the model computes (e.g. midpoint shift = 413 - 293 = ±120,
  // workout total = 130 + 53 + 20 = 203).
  const baseNumbers = Array.from(numbersInPkg)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  for (let i = 0; i < baseNumbers.length; i++) {
    for (let j = 0; j < baseNumbers.length; j++) {
      if (i === j) continue;
      const a = baseNumbers[i];
      const b = baseNumbers[j];
      const diff = a - b;
      if (Number.isFinite(diff)) {
        numbersInPkg.add(canonical(diff));
        numbersInPkg.add(canonical(Math.round(diff)));
        numbersInPkg.add(canonical(Math.abs(diff)));
        numbersInPkg.add(canonical(Math.round(Math.abs(diff))));
      }
    }
  }

  const errs: string[] = [];
  scanProseRecursive(parsed, opts.fields, numbersInPkg, opts.isNoise, "", errs);
  return errs;
}

function scanProseRecursive(
  value: unknown,
  fields: string[],
  numbersInPkg: Set<string>,
  isNoise: (n: number) => boolean,
  pathPrefix: string,
  errs: string[],
): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanProseRecursive(value[i], fields, numbersInPkg, isNoise, `${pathPrefix}[${i}]`, errs);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      const here = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (typeof v === "string" && (fields.includes(key) || key === "reasoning" || key === "why" || key === "callout" || key === "anchor")) {
        // Strip date-like patterns first so they don't get interpreted as numbers.
        // Patterns covered: YYYY-MM-DD, DD.MM, DD.MM., DD.MM.YYYY, HH:MM, HH:MMh.
        const sanitized = v
          .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
          .replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?\b/g, "")
          .replace(/\b\d{1,2}:\d{2}h?\b/g, "");
        // Match plain numbers AND grouped numbers (German "26.019" = 26019, US "26,019" = 26019).
        const matches = sanitized.match(/-?\d{1,3}(?:[.,]\d{3})+|-?\d+(?:[.,]\d+)?/g) ?? [];
        for (const raw of matches) {
          const candidates = candidateNumbers(raw);
          // Pass if ANY interpretation matches a package number.
          let matched = false;
          for (const n of candidates) {
            if (!Number.isFinite(n)) continue;
            if (isNoise(n)) {
              matched = true;
              break;
            }
            if (numbersInPkg.has(canonical(n))) {
              matched = true;
              break;
            }
          }
          if (!matched) {
            errs.push(`${here}: number ${raw} not in package`);
          }
        }
      } else {
        scanProseRecursive(v, fields, numbersInPkg, isNoise, here, errs);
      }
    }
  }
}

function collectNumbers(value: unknown, out: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(canonical(value));
    out.add(canonical(Math.round(value)));
    out.add(canonical(Math.round(value * 10) / 10));
    return;
  }
  if (typeof value === "string") {
    // Extract numbers embedded in package strings too. For synthesis the package
    // contains nested insight prose; the model legitimately cites numbers from
    // there (e.g. "Effizienz 97%" in sleep_insight.summary_long).
    const matches = value.match(/-?\d{1,3}(?:[.,]\d{3})+|-?\d+(?:[.,]\d+)?/g) ?? [];
    for (const raw of matches) {
      for (const n of candidateNumbers(raw)) {
        if (Number.isFinite(n)) {
          out.add(canonical(n));
          out.add(canonical(Math.round(n)));
        }
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

function canonical(n: number): string {
  return n.toString();
}

/**
 * Build all plausible numeric interpretations of a raw token.
 * "26.019"   → [26.019, 26019]   (decimal OR German thousands)
 * "26,019"   → [26.019, 26019]   (US thousands OR European decimal)
 * "1.250"    → [1.25,  1250]
 * "5h12"     → handled separately if needed
 * "120"      → [120]
 */
function candidateNumbers(raw: string): number[] {
  const out: number[] = [];
  const sign = raw.startsWith("-") ? -1 : 1;
  const abs = raw.replace(/^-/, "");
  // Plain decimal interpretation (any single dot/comma is decimal).
  const decimal = Number(abs.replace(",", "."));
  if (Number.isFinite(decimal)) out.push(sign * decimal);
  // Thousands interpretation (strip all dots and commas → integer).
  if (/[.,]/.test(abs)) {
    const stripped = Number(abs.replace(/[.,]/g, ""));
    if (Number.isFinite(stripped)) out.push(sign * stripped);
  }
  return out;
}

function defaultNoiseFilter(n: number): boolean {
  if (Number.isInteger(n) && n >= 0 && n <= 7) return true;
  if (n === 100) return true;
  return false;
}

function formatError(e: ErrorObject): string {
  return `${e.instancePath || "/"} ${e.message}`;
}
