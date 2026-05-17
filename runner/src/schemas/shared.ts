/** Reusable JSON Schema fragments — schema v2 (dual-consumer: UI + abstraction LLM). */

import type { Factor } from "../confidence-weights.ts";

// ── analysis-layer items ────────────────────────────────────────────────────

export const OBSERVATION_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      minLength: 2,
      maxLength: 60,
      description:
        "Stable snake_case slug for this observation (e.g. 'bedtime', 'stage_split', 'apnea_count'). Letters, digits, underscores only.",
      pattern: "^[a-z0-9_]+$",
    },
    facts_ref: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description:
        "Dotted path into the facts blob this observation cites (e.g. 'stats.latency_min', 'stages.deep_min'). NEVER 'narrative' or empty.",
    },
    value: {
      type: ["string", "number"],
      description:
        "The actual value at facts_ref (or a derived expression like '186 + 92 = 278 min'). NEVER an empty string.",
    },
    unit: {
      type: "string",
      minLength: 0,
      maxLength: 16,
      description:
        "Short unit ('min', 'pct', 'bpm', 'ms', '°C', 'count'). Empty string when unitless.",
    },
    text: {
      type: "string",
      minLength: 20,
      maxLength: 220,
      description:
        "One bare-fact sentence. NO judgement, no comparison, no recommendation. Just what the value IS.",
    },
  },
  required: ["id", "facts_ref", "value", "unit", "text"],
} as const;

export const OBSERVATIONS_ARRAY = (min: number, max: number) => ({
  type: "array",
  items: OBSERVATION_ITEM,
  minItems: min,
  maxItems: max,
});

export const METRIC_FINDING = {
  type: "object",
  additionalProperties: false,
  properties: {
    metric_id: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description:
        "Dotted facts path (e.g. 'stats.latency_min', 'stages.deep_min'). NEVER an English word like 'sleep'.",
    },
    value: {
      type: ["string", "number"],
      description:
        "The actual numeric value from facts (or derived expression as a string). NEVER an empty string.",
    },
    unit: {
      type: "string",
      minLength: 0,
      maxLength: 16,
      description: "Short unit string ('min', 'pct', 'bpm', 'ms', '°C'). Empty when unitless.",
    },
    vs_norm: {
      type: "string",
      enum: ["below", "within", "above", "sentinel", "artifact"],
      description:
        "Where this value sits relative to its healthy band: below | within | above. Use 'sentinel' if the source is a -1 sentinel; 'artifact' if firmware reports something biologically implausible.",
    },
    norm_band: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
      description:
        "Two-element [low, high] healthy band for this metric in its native unit (e.g. [0, 20] for sleep latency in min, [85, 100] for efficiency in pct). Use [0, 0] only when no norm exists for sentinel/artifact rows.",
    },
    delta_from_norm: {
      type: "number",
      description:
        "Signed distance from the nearest band edge (positive=above ceiling, negative=below floor, 0=within). Omit for sentinel/artifact.",
    },
    interpretation: {
      type: "string",
      minLength: 30,
      maxLength: 240,
      description:
        "ONE plain-English sentence explaining what THIS NUMBER means physiologically; cite the comparison threshold (e.g. 'healthy adults <20 min').",
    },
    reasoning_trace: {
      type: "array",
      items: { type: "string", minLength: 4, maxLength: 120 },
      minItems: 0,
      maxItems: 4,
      description:
        "Optional 2–4 short calc steps that justify the interpretation. Either omit (empty array) or 2–4 short steps. NEVER a single sentence — that belongs in interpretation.",
    },
  },
  required: ["metric_id", "value", "unit", "vs_norm", "norm_band", "interpretation", "reasoning_trace"],
} as const;

export const METRIC_FINDINGS_ARRAY = (min: number, max: number) => ({
  type: "array",
  items: METRIC_FINDING,
  minItems: min,
  maxItems: max,
});

export const PATTERN = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      minLength: 2,
      maxLength: 60,
      description: "Stable snake_case slug naming the pattern (e.g. 'high_latency_high_efficiency').",
      pattern: "^[a-z0-9_]+$",
    },
    involved_metrics: {
      type: "array",
      items: { type: "string", minLength: 2, maxLength: 80 },
      minItems: 1,
      maxItems: 5,
      description: "Facts paths that participate in this pattern.",
    },
    description: {
      type: "string",
      minLength: 20,
      maxLength: 240,
      description: "One sentence stating the cross-metric observation.",
    },
    hypothesis: {
      type: "string",
      minLength: 0,
      maxLength: 200,
      description: "Optional: a candidate cause. Empty string allowed.",
    },
    testable_with: {
      type: "string",
      minLength: 0,
      maxLength: 160,
      description:
        "Optional: data that would confirm/refute this (e.g. '7 nights of consistent bedtime'). Empty string allowed.",
    },
  },
  required: ["id", "involved_metrics", "description", "hypothesis", "testable_with"],
} as const;

export const PATTERNS_ARRAY = (min: number, max: number) => ({
  type: "array",
  items: PATTERN,
  minItems: min,
  maxItems: max,
});

export const LIMITER_TYPED = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["sentinel", "single_window", "artifact", "data_gap", "sparse_sampling"],
      description:
        "Why this limiter applies: sentinel (-1 raw value), single_window (only one data unit), artifact (implausible firmware reading), data_gap (missing rows), sparse_sampling (too few rows for trend).",
    },
    metric_id: {
      type: ["string", "null"],
      description:
        "Facts path the limiter targets (e.g. 'stats.rdi'), or null when the limiter is window-wide (e.g. single_window).",
    },
    text: {
      type: "string",
      minLength: 20,
      maxLength: 220,
      description: "ONE plain-English sentence. Cite the field and value (or absence) explicitly.",
    },
  },
  required: ["kind", "metric_id", "text"],
} as const;

export const LIMITERS_ARRAY = (min: number, max: number) => ({
  type: "array",
  items: LIMITER_TYPED,
  minItems: min,
  maxItems: max,
});

export const EVIDENCE_TYPED = {
  type: "object",
  additionalProperties: false,
  properties: {
    claim_id: {
      type: "string",
      minLength: 2,
      maxLength: 60,
      description: "Stable snake_case slug for this claim (e.g. 'deep_rem_dominance', 'latency_elevated').",
      pattern: "^[a-z0-9_]+$",
    },
    text: {
      type: "string",
      minLength: 8,
      maxLength: 180,
      description: "Short claim about the data (≤180 chars), e.g. 'Deep + REM dominant'.",
    },
    metric_path: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description:
        "Facts path or arithmetic expression supporting the claim (e.g. 'stages.deep_min + stages.rem_min'). NEVER 'narrative'.",
    },
    value: {
      type: ["string", "number"],
      description:
        "Numeric backing. Number for single-field; string for arithmetic ('186 + 92 = 278 min (61% of asleep)').",
    },
  },
  required: ["claim_id", "text", "metric_path", "value"],
} as const;

export const EVIDENCE_TYPED_ARRAY = (min: number, max: number) => ({
  type: "array",
  items: EVIDENCE_TYPED,
  minItems: min,
  maxItems: max,
});

export const COMPARISON_DELTA = {
  type: "object",
  additionalProperties: false,
  properties: {
    metric_id: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description: "Facts path being compared.",
    },
    delta: {
      type: "number",
      description: "Signed delta in native unit (current − baseline).",
    },
    pct: {
      type: "number",
      description: "Optional signed percent change.",
    },
    period: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      description: "Baseline period label (e.g. 'prior_week', 'lifetime', '2026-04').",
    },
  },
  required: ["metric_id", "delta", "period"],
} as const;

export const COMPARISON_TYPED = {
  type: "object",
  additionalProperties: false,
  properties: {
    available: {
      type: "boolean",
      description: "TRUE only when facts.<domain>.baseline is non-null. FALSE for every snapshot without baseline.",
    },
    baseline_source: {
      type: ["string", "null"],
      enum: [null, "lifetime", "prior_week", "prior_month"],
      description: "Source of the baseline. null when available=false.",
    },
    deltas: {
      type: "array",
      items: COMPARISON_DELTA,
      minItems: 0,
      maxItems: 6,
      description:
        "Signed deltas vs baseline. Empty array when available=false. NEVER fabricate when no baseline is provided.",
    },
  },
  required: ["available", "baseline_source", "deltas"],
} as const;

// ── verdict pieces ──────────────────────────────────────────────────────────

export const DRIVER_TYPED = {
  type: "object",
  additionalProperties: false,
  properties: {
    metric_id: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description:
        "Facts path this driver references (e.g. 'stats.latency_min'). UI uses this for tooltips and links.",
    },
    name: {
      type: "string",
      minLength: 2,
      maxLength: 60,
      description:
        "Human-readable display label (Title-Case prose, e.g. 'Sleep latency'). NEVER snake_case.",
    },
    value: {
      type: "number",
      description:
        "The numeric value from facts (or a clean derived number). NEVER 0 unless the facts value really is 0.",
    },
    unit: {
      type: "string",
      minLength: 0,
      maxLength: 16,
      description: "Short unit ('min', 'pct', 'bpm', 'ms', '°C', '0-100'). Empty allowed for unitless counts.",
    },
    direction: {
      type: "string",
      enum: ["positive", "neutral", "negative"],
      description:
        "Verdict on whether this driver helped (positive), was neutral, or hurt (negative). NEVER 'high', 'low', 'good', 'bad'.",
    },
  },
  required: ["metric_id", "name", "value", "unit", "direction"],
} as const;

export const DRIVERS_3_TYPED = {
  type: "array",
  items: DRIVER_TYPED,
  minItems: 3,
  maxItems: 3,
} as const;

export const NEXT_ACTION_TYPED = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      minLength: 10,
      maxLength: 120,
      description:
        "Imperative plain-English sentence ending with a period. NOT snake_case. NOT an identifier. May start with a number (e.g. '57-min onset…').",
    },
    why: {
      type: "string",
      minLength: 20,
      maxLength: 220,
      description:
        "Plain-English sentence citing a number from the data. NOT snake_case. May start with a number.",
    },
    effort: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    horizon: {
      type: "string",
      enum: ["now", "today", "tonight", "tomorrow", "this_week"],
    },
    targets_metric: {
      type: "string",
      minLength: 2,
      maxLength: 80,
      description:
        "Facts path the action targets (e.g. 'stats.latency_min'). MUST match the metric_id of the most-negative driver when fixing a problem.",
    },
  },
  required: ["title", "why", "effort", "horizon", "targets_metric"],
} as const;

export const RATING = {
  type: "string",
  enum: ["poor", "fair", "good", "excellent"],
} as const;

export const HEADLINE = {
  type: "string",
  minLength: 30,
  maxLength: 140,
  description:
    "Plain-English sentence summarising the verdict. No exclamation marks. No marketing fluff.",
} as const;

export const SCORE_0_100 = {
  type: "integer",
  minimum: 0,
  maximum: 100,
  description:
    "Coach verdict score derived from your analysis above. Do NOT copy facts.score; this is your own integrated rating.",
} as const;

export const VERDICT = {
  type: "object",
  additionalProperties: false,
  properties: {
    rating: RATING,
    score_0_100: SCORE_0_100,
    headline: HEADLINE,
    drivers: DRIVERS_3_TYPED,
    next_action: NEXT_ACTION_TYPED,
  },
  required: ["rating", "score_0_100", "headline", "drivers", "next_action"],
} as const;

// ── confidence ──────────────────────────────────────────────────────────────

export function confidenceFactorsSchema(factors: Factor[]) {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        factor: { type: "string", enum: factors.map((f) => f.factor) },
        weight: { type: "number" },
        score: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "0..1 in steps of 0.05.",
        },
        rationale: {
          type: "string",
          minLength: 10,
          maxLength: 220,
          description:
            "ONE decisive sentence citing a number or condition from facts. NO self-correction ('wait...', 'let me reconsider...'). Commit to the score. Short rationales are fine when the factor is structurally 0 (e.g. 'RDI=-1; not computed').",
        },
      },
      required: ["factor", "weight", "score", "rationale"],
    },
    minItems: factors.length,
    maxItems: factors.length,
  };
}

export function confidenceBlockSchema(factors: Factor[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      value: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Final 0..1 confidence after the ceiling has been applied. Approximates Σ(weight × score) within ±0.10.",
      },
      calc: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Σ(weight × score) computed from the factors below. Runner re-checks; mismatch >0.10 triggers retry.",
      },
      math_check_passed: {
        type: "boolean",
        description:
          "ALWAYS set to true. The runner overwrites this after re-checking |value − calc| ≤ 0.10. Do not invent.",
      },
      ceiling_reason: {
        type: ["string", "null"],
        enum: [null, "single_day_window", "sparse_data", "sentinel_heavy", "new_baseline"],
        description:
          "Which structural cap forced value < calc, or null when no ceiling applied. Snapshot domains use 'single_day_window'.",
      },
      factors: confidenceFactorsSchema(factors),
      reasoning: {
        type: "string",
        minLength: 30,
        maxLength: 320,
        description:
          "1–2 sentences synthesising the rubric: which factors lifted, which capped. NO self-correction prose.",
      },
    },
    required: ["value", "calc", "math_check_passed", "ceiling_reason", "factors", "reasoning"],
  };
}

// ── upward signals ──────────────────────────────────────────────────────────

export const UPWARD_SIGNALS = {
  type: "object",
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      items: {
        type: "string",
        minLength: 2,
        maxLength: 60,
        pattern: "^[a-z0-9_]+$",
      },
      minItems: 1,
      maxItems: 8,
      description:
        "Stable snake_case tags an upstream LLM keys off (e.g. 'sleep_latency_high', 'deep_share_high'). NEVER prose.",
    },
    for_coach: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tag: {
            type: "string",
            minLength: 2,
            maxLength: 60,
            pattern: "^[a-z0-9_]+$",
            description: "snake_case category like 'recovery_lever', 'load_signal', 'risk_flag'.",
          },
          metric_id: { type: "string", minLength: 2, maxLength: 80 },
          weight: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "0..1 importance for the coach. Highest for the metric the next_action targets.",
          },
        },
        required: ["tag", "metric_id", "weight"],
      },
      minItems: 1,
      maxItems: 5,
    },
    for_weekly_trend: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          metric_id: { type: "string", minLength: 2, maxLength: 80 },
          value: { type: "number" },
        },
        required: ["metric_id", "value"],
      },
      minItems: 1,
      maxItems: 8,
      description:
        "Numeric values the weekly aggregator should append. Must be plain numbers (not strings).",
    },
    anomalies_flagged: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            minLength: 2,
            maxLength: 60,
            pattern: "^[a-z0-9_]+$",
          },
          severity: { type: "string", enum: ["info", "warn", "critical"] },
          details: {
            type: "string",
            minLength: 10,
            maxLength: 220,
            description: "ONE sentence; cite the field and value.",
          },
        },
        required: ["id", "severity", "details"],
      },
      minItems: 0,
      maxItems: 5,
    },
  },
  required: ["tags", "for_coach", "for_weekly_trend", "anomalies_flagged"],
} as const;
