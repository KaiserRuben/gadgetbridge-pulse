import { COACH_FACTORS } from "../../confidence-weights.ts";
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
 * snapshot/coach — top-level synthesiser. Reads the 6 domain insights
 * (sleep, cardio, activity, body, stress, anomalies) and produces a
 * cross-domain verdict.
 *
 * Same v2 process-first schema as domain prompts so CoachCard renders it
 * unchanged. Drivers, metric_findings, etc. should now reference the
 * STRONGEST signals across all six inputs.
 */
export const CoachSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    context_summary: {
      type: "string",
      minLength: 30,
      maxLength: 240,
      description:
        "One or two sentences naming what was synthesised (count of input insights, period, any input gaps).",
    },
    observations: OBSERVATIONS_ARRAY(3, 8),
    metric_findings: METRIC_FINDINGS_ARRAY(3, 7),
    patterns: PATTERNS_ARRAY(1, 5),
    limiters: LIMITERS_ARRAY(1, 5),
    evidence: EVIDENCE_TYPED_ARRAY(2, 6),
    comparison: COMPARISON_TYPED,
    verdict: VERDICT,
    confidence: confidenceBlockSchema(COACH_FACTORS),
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
