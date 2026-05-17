import { SLEEP_FACTORS } from "../../confidence-weights.ts";
import {
  COMPARISON_TYPED,
  EVIDENCE_TYPED_ARRAY,
  LIMITERS_ARRAY,
  METRIC_FINDINGS_ARRAY,
  OBSERVATIONS_ARRAY,
  PATTERNS_ARRAY,
  UPWARD_SIGNALS,
  VERDICT,
  confidenceBlockSchema,
} from "../shared.ts";

/**
 * snapshot/sleep — strict JSON Schema (v2, dual-consumer).
 *
 * Property order is the contract: reasoning fields first, summary fields
 * second, confidence reasoning last. qwen3.6 fills properties left-to-right.
 *
 * The envelope (version, domain, timeframe, period_key, data_window,
 * generated_at, model, facts_hash, duration_ms) is NOT in this schema —
 * the orchestrator stamps it onto the output. The model only emits the
 * fields below.
 */
export const SleepSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    // ── analysis layer ─────────────────────────────────────────────────
    context_summary: {
      type: "string",
      minLength: 30,
      maxLength: 240,
      description:
        "One or two plain-English sentences naming what was measured. NEVER repeat the headline.",
    },
    observations: OBSERVATIONS_ARRAY(3, 8),
    metric_findings: METRIC_FINDINGS_ARRAY(3, 7),
    patterns: PATTERNS_ARRAY(1, 5),
    limiters: LIMITERS_ARRAY(1, 5),
    evidence: EVIDENCE_TYPED_ARRAY(2, 6),
    comparison: COMPARISON_TYPED,

    // ── verdict (UI consumer) ──────────────────────────────────────────
    verdict: VERDICT,

    // ── confidence ─────────────────────────────────────────────────────
    confidence: confidenceBlockSchema(SLEEP_FACTORS),

    // ── upward signals (abstraction LLM consumer) ──────────────────────
    upward_signals: UPWARD_SIGNALS,
  },
  required: [
    "context_summary",
    "observations",
    "metric_findings",
    "patterns",
    "limiters",
    "evidence",
    "comparison",
    "verdict",
    "confidence",
    "upward_signals",
  ],
} as const;
