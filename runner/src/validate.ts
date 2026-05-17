/**
 * Validate model output against the JSON Schema, then verify the confidence
 * math (Σ weight × score ≈ confidence.value within tolerance).
 *
 * Schema v2 (dual-consumer): the model emits a typed object with nested
 * `verdict`, `confidence`, `upward_signals`. The orchestrator stamps the
 * envelope on top. Legacy v1 fallbacks have been dropped — current prompts
 * produce v2 natively on attempt 1.
 */

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { config } from "./config.ts";
import { FACTORS_BY_DOMAIN } from "./confidence-weights.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export type ValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: "parse"; raw: string; error: string }
  | { ok: false; reason: "schema"; data: unknown; errors: ErrorObject[] }
  | { ok: false; reason: "math"; data: unknown; reported: number; calc: number; delta: number };

/**
 * Normalise model output to the canonical v2 shape. With the v2 prompt the
 * model emits canonical natively — these branches only fire on transient
 * deviations and prevent a retry burn. They do NOT carry v1 → v2 migration
 * (no legacy reader exists).
 */
export function normaliseOutput(
  raw: Record<string, unknown>,
  domain: string,
): Record<string, unknown> {
  const out = { ...raw };

  // strip envelope keys if the model leaked them in
  for (const k of [
    "version",
    "domain",
    "timeframe",
    "period_key",
    "data_window",
    "generated_at",
    "model",
    "facts_hash",
    "duration_ms",
  ]) {
    delete out[k];
  }

  // ── verdict normalisation ────────────────────────────────────────────────
  if (out.verdict && typeof out.verdict === "object") {
    const v = out.verdict as Record<string, unknown>;

    // drivers: coerce direction enum slips, keep canonical when present
    if (Array.isArray(v.drivers)) {
      v.drivers = (v.drivers as Array<Record<string, unknown>>).map((d) => {
        const directionRaw = String(d.direction ?? "neutral").toLowerCase();
        const direction = ["positive", "good", "lift", "high"].includes(directionRaw)
          ? "positive"
          : ["negative", "bad", "drop", "drag", "low"].includes(directionRaw)
            ? "negative"
            : ["positive", "neutral", "negative"].includes(directionRaw)
              ? directionRaw
              : "neutral";
        return {
          metric_id: String(d.metric_id ?? d.metric ?? "unknown"),
          name: String(d.name ?? "metric"),
          value: typeof d.value === "number" ? d.value : 0,
          unit: String(d.unit ?? ""),
          direction,
        };
      });
    }

    // next_action: fill targets_metric if absent; default + coerce effort/horizon
    if (v.next_action && typeof v.next_action === "object") {
      const a = v.next_action as Record<string, unknown>;
      const VALID_EFFORTS = ["low", "medium", "high"];
      if (typeof a.effort !== "string" || !VALID_EFFORTS.includes(a.effort)) a.effort = "low";

      const VALID_HORIZONS = ["now", "today", "tonight", "tomorrow", "this_week"];
      if (typeof a.horizon !== "string" || !VALID_HORIZONS.includes(a.horizon)) {
        const raw = String(a.horizon ?? "").toLowerCase();
        a.horizon =
          raw.includes("tonight") || raw.includes("sleep") || raw.includes("bed")
            ? "tonight"
            : raw.includes("week") || raw.includes("days") || raw.includes("nights")
              ? "this_week"
              : raw === "now" || raw === "today"
                ? raw
                : "tomorrow";
      }
      if (typeof a.targets_metric !== "string" || !a.targets_metric) {
        const drivers = (v.drivers as Array<{ metric_id?: string; direction?: string }>) ?? [];
        const neg = drivers.find((d) => d.direction === "negative");
        const pick = neg ?? drivers[0];
        a.targets_metric = String(pick?.metric_id ?? "unknown");
      }
    }
  }

  // ── confidence normalisation ─────────────────────────────────────────────
  if (out.confidence && typeof out.confidence === "object" && !Array.isArray(out.confidence)) {
    const c = out.confidence as Record<string, unknown>;
    const weights = FACTORS_BY_DOMAIN[domain] ?? [];
    const wMap = new Map(weights.map((w) => [w.factor, w.weight]));

    // factors: ensure weight is canonical, round score to 0.05, truncate rationale
    if (Array.isArray(c.factors)) {
      c.factors = (c.factors as Array<Record<string, unknown>>).map((f) => {
        const factor = String(f.factor);
        const weight = typeof f.weight === "number" ? f.weight : wMap.get(factor) ?? 0;
        const score =
          typeof f.score === "number" ? Math.round(f.score * 20) / 20 : 0;
        const rationaleRaw = typeof f.rationale === "string" ? f.rationale : "";
        const rationale =
          rationaleRaw.length > 220 ? rationaleRaw.slice(0, 217) + "..." : rationaleRaw;
        return { factor, weight, score, rationale };
      });
    }

    // calc: recompute deterministically (model may estimate, runner trumps)
    if (Array.isArray(c.factors)) {
      const calc = (c.factors as Array<{ weight: number; score: number }>).reduce(
        (s, f) => s + f.weight * f.score,
        0,
      );
      c.calc = Math.round(calc * 1000) / 1000;
    }

    // ceiling_reason: leave as-is, but ensure null is null not the string "null"
    if (c.ceiling_reason === "null" || c.ceiling_reason === "") c.ceiling_reason = null;

    // math_check_passed: runner authoritative
    const value = typeof c.value === "number" ? c.value : NaN;
    const calc = typeof c.calc === "number" ? c.calc : NaN;
    if (Number.isFinite(value) && Number.isFinite(calc)) {
      // single_day_window etc may legitimately push value < calc; tolerance is
      // either side within 0.10, OR ceiling-cap explained.
      const within = Math.abs(value - calc) <= config.confidenceTolerance;
      const cappedDown = c.ceiling_reason && value <= calc + 0.01;
      c.math_check_passed = within || Boolean(cappedDown);
    } else {
      c.math_check_passed = false;
    }

    // reasoning trim
    if (typeof c.reasoning === "string" && c.reasoning.length > 320) {
      c.reasoning = c.reasoning.slice(0, 317) + "...";
    }
  }

  // ── analysis-layer normalisations ────────────────────────────────────────

  // metric_findings: default reasoning_trace=[] if missing
  if (Array.isArray(out.metric_findings)) {
    out.metric_findings = (out.metric_findings as Array<Record<string, unknown>>).map((m) => {
      if (!Array.isArray(m.reasoning_trace)) m.reasoning_trace = [];
      // single-sentence reasoning_trace gets dropped to []
      if ((m.reasoning_trace as unknown[]).length === 1) m.reasoning_trace = [];
      return m;
    });
  }

  // comparison: default deltas to []
  if (out.comparison && typeof out.comparison === "object") {
    const cp = out.comparison as Record<string, unknown>;
    if (!Array.isArray(cp.deltas)) cp.deltas = [];
    if (typeof cp.available !== "boolean") cp.available = false;
    if (cp.baseline_source === undefined) cp.baseline_source = null;
  }

  // patterns: ensure optional string fields are never undefined (schema requires them as strings)
  if (Array.isArray(out.patterns)) {
    out.patterns = (out.patterns as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      hypothesis: typeof p.hypothesis === "string" ? p.hypothesis : "",
      testable_with: typeof p.testable_with === "string" ? p.testable_with : "",
    }));
  }

  // limiters: kind enum coerce common slips
  if (Array.isArray(out.limiters)) {
    out.limiters = (out.limiters as Array<Record<string, unknown>>).map((l) => {
      const validKinds = ["sentinel", "single_window", "artifact", "data_gap", "sparse_sampling"];
      let kind = String(l.kind ?? "single_window");
      if (!validKinds.includes(kind)) kind = "single_window";
      return {
        kind,
        metric_id: l.metric_id === undefined ? null : (l.metric_id as string | null),
        text: typeof l.text === "string" ? l.text : "",
      };
    });
  }

  // observations: ensure unit field is a string (schema requires it)
  if (Array.isArray(out.observations)) {
    out.observations = (out.observations as Array<Record<string, unknown>>).map((o) => ({
      ...o,
      unit: typeof o.unit === "string" ? o.unit : "",
    }));
  }

  // trim arrays to schema max
  const TRIMS: Record<string, number> = {
    observations: 8,
    metric_findings: 7,
    patterns: 5,
    limiters: 5,
    evidence: 6,
  };
  for (const [key, max] of Object.entries(TRIMS)) {
    if (Array.isArray(out[key]) && (out[key] as unknown[]).length > max) {
      out[key] = (out[key] as unknown[]).slice(0, max);
    }
  }

  // context_summary trim
  if (typeof out.context_summary === "string" && out.context_summary.length > 240) {
    const cut = out.context_summary.slice(0, 237);
    const lastDot = cut.lastIndexOf(".");
    out.context_summary =
      (lastDot > 100 ? cut.slice(0, lastDot + 1) : cut) + (lastDot > 100 ? "" : "...");
  }

  return out;
}

export function validateOutput(content: string, schema: unknown, domain = ""): ValidationResult {
  // qwen3.6 sometimes emits a second JSON object after the first when it hits
  // the eval ceiling. Extract the first balanced object before parsing.
  const firstObject = extractFirstJsonObject(content);
  if (!firstObject) {
    return {
      ok: false,
      reason: "parse",
      raw: content,
      error: "no balanced JSON object found in output",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstObject);
  } catch (err) {
    return {
      ok: false,
      reason: "parse",
      raw: firstObject,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const normalised =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? normaliseOutput(parsed as Record<string, unknown>, domain)
      : parsed;

  const validate = ajv.compile(schema as object);
  if (!validate(normalised)) {
    return { ok: false, reason: "schema", data: normalised, errors: validate.errors ?? [] };
  }
  parsed = normalised;

  // Math check on the new typed confidence block
  const obj = parsed as Record<string, unknown>;
  const conf = obj.confidence as
    | {
        value?: number;
        calc?: number;
        ceiling_reason?: string | null;
        factors?: { weight: number; score: number }[];
      }
    | undefined;

  if (conf && Array.isArray(conf.factors)) {
    const calc = conf.factors.reduce((s, f) => s + f.weight * f.score, 0);
    const reported = typeof conf.value === "number" ? conf.value : NaN;
    if (Number.isFinite(reported)) {
      const delta = Math.abs(calc - reported);
      // Two acceptance modes:
      //   1. No cap → |reported - calc| ≤ tol (default 0.10)
      //   2. ceiling_reason set → reported MUST be ≤ calc + 0.05 (a small
      //      slack), i.e. the cap can only LOWER, never raise. This prevents
      //      models from setting ceiling_reason but reporting a higher value.
      const tightCapSlack = 0.05;
      const cappedDown =
        Boolean(conf.ceiling_reason) && reported <= calc + tightCapSlack;
      if (delta > config.confidenceTolerance && !cappedDown) {
        return { ok: false, reason: "math", data: obj, reported, calc, delta };
      }
      // Stamp math_check_passed if the schema field exists; let runner overwrite later if needed.
      if (typeof conf === "object" && "math_check_passed" in conf) {
        (conf as { math_check_passed?: boolean }).math_check_passed = true;
      }
    }
  }

  return { ok: true, data: obj as Record<string, unknown> };
}

/**
 * Walk the string and return the substring of the first balanced JSON object,
 * respecting strings + escapes. Tolerates leading whitespace and trailing junk.
 */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Build a short reminder string the orchestrator can append on retry. */
export function buildRetryNote(prev: ValidationResult): string {
  if (prev.ok) return "";
  if (prev.reason === "parse") {
    return `Strict reminder: previous output was not valid JSON. ${prev.error.slice(0, 160)}. Output ONE JSON object that conforms exactly to the schema.`;
  }
  if (prev.reason === "schema") {
    const top = prev.errors
      .slice(0, 4)
      .map((e) => `${e.instancePath || "/"}: ${e.message}`)
      .join("; ");
    return `Strict reminder: schema validation failed: ${top}. Re-issue with all required keys in the correct order, with constraints met. Remember: confidence is now a TYPED OBJECT {value, calc, math_check_passed, ceiling_reason, factors, reasoning}. verdict is a TYPED OBJECT {rating, score_0_100, headline, drivers, next_action}. Do NOT include envelope keys.`;
  }
  if (prev.reason === "math") {
    return `Strict reminder: confidence.value (${prev.reported.toFixed(3)}) does not match Σ(weight × score) (${prev.calc.toFixed(3)}). Recompute factor scores honestly so |value − calc| ≤ ${config.confidenceTolerance.toFixed(2)}, OR set value lower than calc and supply a ceiling_reason (e.g. "single_day_window") to explain the cap.`;
  }
  return "";
}
