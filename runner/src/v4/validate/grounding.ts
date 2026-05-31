/**
 * Shared validation harness for v4 slots.
 *
 * Two-layer validation per slot:
 *   1. JSON-schema (Ajv 2020) — payload shape
 *   2. Numeric grounding — every number appearing in scanned prose fields
 *      must also appear in the slot's input package (or be a pairwise
 *      difference / round-trip of two package numbers). Threshold literals
 *      from the prompt are allowed via `extraText`.
 *
 * Port of `runner/src/v3/validate.ts`, lifted into v4 so v3 can be deleted
 * in Phase 4 without dangling imports.
 */

import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";

export interface ValidationOptions {
  schema: object;
  ajv?: Ajv;
  /** Small integers (0..7) and `100` are treated as noise by default. */
  groundingNoiseFilter?: (n: number) => boolean;
  /** Override which keys carry prose that we scan for numbers. */
  proseFieldsToScan?: string[];
  /** System prompt / manifest. Numbers here count as cited (threshold literals). */
  promptText?: string;
}

export interface ValidationResult {
  ok: boolean;
  schemaValid: boolean;
  schemaErrors: string[];
  schemaWarnings: string[];
  groundingErrors: string[];
  parsed: unknown;
  parseError: string | null;
  raw: string;
}

const SOFT_KEYWORDS = new Set(["maxLength", "minLength"]);

const DEFAULT_PROSE_FIELDS = [
  "headline",
  "summary_short",
  "summary_long",
  "analysis_today",
  "analysis_context",
  "analysis",
  "key_insight",
];

let _sharedAjv: Ajv | null = null;
export function makeAjv(): Ajv {
  if (_sharedAjv) return _sharedAjv;
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  _sharedAjv = ajv;
  return ajv;
}

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

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (!("incomplete" in obj)) obj.incomplete = true;
  }

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
          extraText: opts.promptText,
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

export function extractJson(text: string): string {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenced.length > 0) return fenced[fenced.length - 1][1].trim();
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
  const withMarker = candidates.filter((c) => /"schema_version"\s*:\s*"[a-z][a-z0-9-]+\/v\d+"/.test(c));
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

interface GroundingOpts {
  fields: string[];
  isNoise: (n: number) => boolean;
  extraText?: string;
}

function checkGrounding(parsed: unknown, pkg: unknown, opts: GroundingOpts): string[] {
  const numbersInPkg = new Set<string>();
  collectNumbers(pkg, numbersInPkg);
  if (opts.extraText) collectNumbers(opts.extraText, numbersInPkg);

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

const PROSE_KEYS = new Set(["reasoning", "why", "callout", "anchor"]);

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
      if (typeof v === "string" && (fields.includes(key) || PROSE_KEYS.has(key))) {
        const sanitized = v
          .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
          .replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?\b/g, "")
          .replace(/\b\d{1,2}:\d{2}h?\b/g, "");
        const matches = sanitized.match(/-?\d{1,3}(?:[.,]\d{3})+|-?\d+(?:[.,]\d+)?/g) ?? [];
        for (const raw of matches) {
          const candidates = candidateNumbers(raw);
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
    const matches = value.match(/-?\d{1,3}(?:[.,]\d{3})+|-?\d+(?:[.,]\d+)?/g) ?? [];
    for (const raw of matches) {
      for (const n of candidateNumbers(raw)) {
        if (Number.isFinite(n)) {
          out.add(canonical(n));
          out.add(canonical(Math.round(n)));
        }
      }
    }
    const isoMatches = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/g) ?? [];
    for (const iso of isoMatches) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if (!m) continue;
      const [, yyyy, mm, dd] = m;
      const dN = Number(dd);
      const mN = Number(mm);
      const yN = Number(yyyy);
      const yy = yyyy.slice(2);
      const forms = [
        `${dN}.${mN}`,
        `${dN}.${mm}`,
        `${dd}.${mN}`,
        `${dd}.${mm}`,
        `${dN}.${mN}.${yyyy}`,
        `${dN}.${mN}.${yy}`,
        `${dd}.${mm}.${yyyy}`,
        `${dd}.${mm}.${yy}`,
      ];
      for (const f of forms) {
        const num = Number(f);
        if (Number.isFinite(num)) {
          out.add(canonical(num));
          out.add(canonical(Math.round(num)));
        }
      }
      out.add(canonical(dN));
      out.add(canonical(mN));
      out.add(canonical(yN));
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

function candidateNumbers(raw: string): number[] {
  const out: number[] = [];
  const sign = raw.startsWith("-") ? -1 : 1;
  const abs = raw.replace(/^-/, "");
  const decimal = Number(abs.replace(",", "."));
  if (Number.isFinite(decimal)) out.push(sign * decimal);
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
