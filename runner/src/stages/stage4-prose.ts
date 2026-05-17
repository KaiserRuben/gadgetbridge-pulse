/**
 * Stage 4 — Prose draft.
 *
 * Calls the LLM in Ollama `format` mode with the daily/v2 JSON Schema.
 * The model fills `reasoning_trace` first (per schema property order) and
 * then the German prose answer fields.
 *
 * Retry policy:
 *   - Up to 3 attempts.
 *   - Temperature decay 0.15 → 0.10 → 0.05.
 *   - Each attempt: parse JSON, AJV-validate against daily.schema.json.
 *   - On final failure: synthesize an abstaining DailyInsightV2 with
 *     abstain_reason="llm_schema_fail".
 *
 * The pause-state `i_feel_fine` flag is injected after the model returns
 * (the model is told to set it false; runner overrides authoritatively).
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";

import type {
  DailyInsightV2,
  FactsBundleV2,
  PauseStateV1,
} from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";

import { config } from "../config.ts";
import { callOllama } from "../ollama.ts";
import {
  DAILY_SYSTEM_PROMPT,
  buildDailyUser,
} from "../prompts/daily.ts";
import { dailySchema } from "../schemas/v2/index.ts";
import type { PickedEvidence } from "./stage3-evidence.ts";
import type { SimilarDay } from "./stage2-retrieval.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateDaily = ajv.compile(dailySchema);

const MAX_ATTEMPTS = 3;
const TEMPERATURES = [0.15, 0.1, 0.05];

const MIN_TRACE_LEN = 40;

export interface Stage4Result {
  daily: DailyInsightV2;
  attempts: number;
  used_abstain_fallback: boolean;
  /** AJV error string from the last failed attempt, if any (for diagnostics). */
  last_error: string | null;
}

export interface Stage4Options {
  /**
   * Verifier-driven feedback from a previous run. Prepended to the user
   * message so the LLM knows exactly which violations to fix on this attempt.
   * Empty / undefined on the first invocation; non-empty when the orchestrator
   * is regenerating after Stage 6 surfaced semantic violations.
   */
  feedback?: string[];
  /**
   * Override starting temperature. Default uses `TEMPERATURES[attempt]` from
   * 0.15. Orchestrator passes lower values (0.10 / 0.05) for semantic regen
   * attempts so the model converges on the violations instead of exploring.
   */
  temperatureBase?: number;
}

/**
 * Run Stage 4. Returns the verified DailyInsightV2 (or a synthetic abstain
 * payload after MAX_ATTEMPTS failures).
 */
export async function runStage4(
  facts: FactsBundleV2,
  observations: Observation[],
  picked: PickedEvidence,
  similarDays: SimilarDay[],
  pause: Pick<PauseStateV1, "i_feel_fine">,
  opts: Stage4Options = {},
): Promise<Stage4Result> {
  const feedback = opts.feedback ?? [];
  const tempBase = opts.temperatureBase;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // When the orchestrator overrides the base temperature, the per-attempt
    // decay is preserved by stepping down by the same fraction (0.05) per
    // retry inside this invocation. Cap below at 0.02 — colder than that and
    // the model becomes deterministic enough to repeat the same violation.
    const temperature = tempBase != null
      ? Math.max(0.02, tempBase - attempt * 0.05)
      : (TEMPERATURES[attempt] ?? 0.05);
    const user = buildDailyUser(facts, observations, picked, similarDays, feedback);

    let result;
    try {
      result = await callOllama({
        model: config.model,
        system: DAILY_SYSTEM_PROMPT,
        user,
        tag: "stage4_prose",
        format: dailySchema,
        options: {
          temperature,
          num_ctx: 16384,
          num_predict: 6000,
        },
      });
    } catch (err) {
      lastError = `HTTP error: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(
        `[stage4] attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`,
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch (err) {
      lastError = `JSON parse: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(
        `[stage4] attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`,
      );
      continue;
    }

    parsed = repairDaily(parsed);

    const ok = validateDaily(parsed);
    if (!ok) {
      lastError = (validateDaily.errors ?? [])
        .slice(0, 5)
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ");
      const offending = (validateDaily.errors ?? [])
        .slice(0, 5)
        .map((e) => {
          const p = (e.instancePath || "/")
            .split("/")
            .filter(Boolean);
          let v: unknown = parsed;
          for (const k of p) v = (v as Record<string, unknown>)?.[k];
          return `${e.instancePath || "/"}=${JSON.stringify(v)?.slice(0, 60)}`;
        })
        .join(" | ");
      console.warn(
        `[stage4] attempt ${attempt + 1}/${MAX_ATTEMPTS} schema fail: ${lastError} :: ${offending}`,
      );
      continue;
    }

    const daily = parsed as DailyInsightV2;
    // Authoritative override — model is instructed to emit false; the
    // runner stamps the real value from pause state.
    daily.i_feel_fine_override = pause.i_feel_fine;

    console.log(
      `[stage4] ok on attempt ${attempt + 1} (temp=${temperature}, ${result.totalMs}ms, eval=${result.evalTokens})`,
    );

    return {
      daily,
      attempts: attempt + 1,
      used_abstain_fallback: false,
      last_error: null,
    };
  }

  // All attempts failed — synthesize abstain payload.
  console.error(
    `[stage4] all ${MAX_ATTEMPTS} attempts failed; emitting abstain payload (last_error=${lastError})`,
  );
  return {
    daily: synthesizeAbstain(pause, lastError),
    attempts: MAX_ATTEMPTS,
    used_abstain_fallback: true,
    last_error: lastError,
  };
}

function synthesizeAbstain(
  pause: Pick<PauseStateV1, "i_feel_fine">,
  lastError: string | null,
): DailyInsightV2 {
  const trace = padTrace(
    `LLM schema failure after ${MAX_ATTEMPTS} attempts; abstaining; last_error=${lastError ?? "unknown"}`,
  );
  const factors = [
    "baseline_window_coverage: w=0.40 s=0.00",
    "signal_quality: w=0.30 s=0.00",
    "persistence_gate: w=0.30 s=0.00",
  ];
  return {
    reasoning_trace: trace.slice(0, 600),
    schema_version: "daily/v2",
    language: "de",
    abstain: true,
    abstain_reason: "llm_schema_fail",
    headline: null,
    verdict_band: null,
    summary: null,
    drivers: [],
    affirmation: null,
    reflection: null,
    action: null,
    i_feel_fine_override: pause.i_feel_fine,
    confidence: {
      value: 0,
      calc: "0.000",
      factors,
    },
  };
}

function padTrace(s: string): string {
  if (s.length >= MIN_TRACE_LEN) return s;
  return s + " ".repeat(MIN_TRACE_LEN - s.length);
}

/**
 * Best-effort repair pass before AJV validation. Targets the recurring
 * failure modes observed in production logs:
 *   - drivers[].delta_text missing → fill with "" (passes maxLength<=40
 *     and the schema's `required` array).
 *   - drivers[].evidence_ids missing or empty → drop the driver (the
 *     schema requires minItems:1; a driver without evidence is unsafe).
 *   - drivers[].direction outside enum → coerce flat-ish values to "flat".
 *   - coaching_cards[].interpretation === "" → null (model sometimes
 *     emits empty string when it has nothing to say).
 *   - reasoning_trace too short → pad to MIN_TRACE_LEN.
 *   - extra unknown keys at the top level: NOT stripped — additionalProperties
 *     is false, so AJV will surface them, and if we remove them we hide
 *     legitimate prompt drift from the diagnostics.
 */
export function repairDaily(input: unknown): unknown {
  if (input == null || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;

  if (typeof obj.reasoning_trace === "string") {
    obj.reasoning_trace = padTrace(obj.reasoning_trace).slice(0, 600);
  }

  // abstain_reason is required + nullable; LLM omits when not abstaining.
  if (!("abstain_reason" in obj)) {
    obj.abstain_reason = null;
  }

  // Headline cap is 40 chars; the model regularly overshoots by 2-5 chars.
  // Truncate at the last word boundary that fits, fall back to a hard slice.
  if (typeof obj.headline === "string" && obj.headline.length > 40) {
    const raw = obj.headline.trim();
    const cap = 39; // leave 1 char for the ellipsis
    let cut = raw.lastIndexOf(" ", cap);
    if (cut < 25) cut = cap;
    obj.headline = raw.slice(0, cut).trimEnd() + "…";
  }

  // Summary cap is 180 chars. Same approach.
  if (typeof obj.summary === "string" && obj.summary.length > 180) {
    const raw = obj.summary.trim();
    const cap = 179;
    let cut = raw.lastIndexOf(" ", cap);
    if (cut < 140) cut = cap;
    obj.summary = raw.slice(0, cut).trimEnd() + "…";
  }

  if (Array.isArray(obj.drivers)) {
    obj.drivers = obj.drivers
      .map((d): unknown => {
        if (d == null || typeof d !== "object") return null;
        const dr = { ...(d as Record<string, unknown>) };
        if (typeof dr.delta_text !== "string") dr.delta_text = "";
        if (typeof dr.metric_id !== "string") dr.metric_id = "";
        if (typeof dr.clause !== "string") dr.clause = "";
        if (
          typeof dr.direction !== "string" ||
          !["up", "down", "flat"].includes(dr.direction)
        ) {
          dr.direction = "flat";
        }
        if (
          !Array.isArray(dr.evidence_ids) ||
          dr.evidence_ids.length === 0 ||
          !dr.evidence_ids.every((x) => typeof x === "string" && x.length > 0)
        ) {
          // Schema requires minItems:1 — a driver without an evidence_id
          // can't be salvaged; drop it.
          return null;
        }
        return dr;
      })
      .filter((x: unknown) => x != null)
      .slice(0, 3);
  }

  if (Array.isArray(obj.coaching_cards)) {
    obj.coaching_cards = obj.coaching_cards
      .map((c): unknown => {
        if (c == null || typeof c !== "object") return null;
        const cc = { ...(c as Record<string, unknown>) };
        if (cc.interpretation === "" || cc.interpretation === undefined) {
          cc.interpretation = null;
        }
        return cc;
      })
      .filter((x: unknown) => x != null)
      .slice(0, 4);
  }

  return obj;
}

/**
 * Backwards-compat wrapper used by the v2 orchestrator while migration
 * paths swap over. Delegates to {@link runStage4} but defaults pause to
 * `i_feel_fine=false` and similarDays to [].
 *
 * @deprecated Use runStage4 directly with the live PauseStateV1.
 */
export async function runStage4Stub(
  facts: FactsBundleV2,
  rules: { observations: Observation[] },
  picked: PickedEvidence,
): Promise<DailyInsightV2> {
  const result = await runStage4(
    facts,
    rules.observations,
    picked,
    [],
    { i_feel_fine: false },
  );
  return result.daily;
}

/** Helper: list of observation IDs eligible for prose surfacing. */
export function narrativeEligibleIds(observations: Observation[]): string[] {
  return observations
    .filter((o) => !o.suppressed_by || o.suppressed_by.length === 0)
    .map((o) => o.id);
}
