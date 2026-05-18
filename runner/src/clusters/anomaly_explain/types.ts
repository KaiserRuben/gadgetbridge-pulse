/**
 * Shape of the payload stored under the anomaly_explain cluster.
 *
 * Two modes share one payload schema:
 *  - driver: bound to an `observation_id` already produced by the rule
 *    engine in `daily.json`. The cell-key equals the observation_id and
 *    the prose call resolves observation_text from that driver clause.
 *  - spike: synthesised from a single wearable sample at a given ts_ms,
 *    chart-click style. The cell-key encodes `manual_<metric>_<ts_ms>`
 *    so re-clicks on the same point are cache-stable.
 *
 * Mirrors `runner/src/clusters/anomaly_explain/package.schema.json` —
 * keep the two in sync.
 */

import type { HypothesisStrength } from "../../analyzer/anomaly-explanation.ts";

export type AnomalyMode = "driver" | "spike";

export interface AnomalyHypothesis {
  factor: string;
  strength: HypothesisStrength;
  rationale: string;
}

export interface AnomalyExplanationContext {
  mode: AnomalyMode;
  observation_text: string;
  /** Optional in driver mode; populated in spike mode. */
  metric?: string;
  /** Optional in driver mode; populated in spike mode. */
  ts_ms?: number;
  /** Number of _facts.json files actually loaded for the window. */
  facts_window_size: number;
}

export interface AnomalyExplanationPayload {
  observation_id: string;
  period_key: string;
  context: AnomalyExplanationContext;
  hypotheses: AnomalyHypothesis[];
  /** Set by prose(); base model, or "base+critic" once Phase 4 lands. */
  model?: string;
}

export interface AnomalyExtractInput {
  /** Driver mode: an observation id already produced by the rule engine. */
  observation_id?: string;
  /** Spike mode: metric + ts_ms synthesise a one-shot observation. */
  metric?: "hr" | "rhr" | "hrv" | "spo2" | "stress" | "steps" | "temp";
  ts_ms?: number;
}
