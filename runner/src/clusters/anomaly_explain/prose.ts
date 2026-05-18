/**
 * anomaly_explain — Stage 1 (prose). Wraps the existing `explainAnomaly()`
 * LLM call so the JobCell layer can reuse the locked prompt + schema.
 *
 * Critic pass is Phase 4 work — for now we just log when the setting is on
 * and short-circuit to a single-model run. The plumbing (model string tag,
 * `ctx.criticModel`) is here so the Phase 4 wiring slot drops in cleanly.
 */

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { explainAnomaly } from "../../analyzer/anomaly-explanation.ts";
import type { HypothesisStrength } from "../../analyzer/anomaly-explanation.ts";
import type { ProseContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import { loadAnomalyFactsWindow } from "./extract.ts";
import type { AnomalyExplanationPayload, AnomalyHypothesis } from "./types.ts";

/**
 * Map the LLM's discrete strength label to a confidence float in [0,1]
 * for the per-field provenance tag. Anchored so the tag table can render
 * a consistent "Konfidenz" column across clusters.
 */
function strengthToConfidence(s: HypothesisStrength): number {
  switch (s) {
    case "strong":
      return 0.85;
    case "moderate":
      return 0.6;
    case "weak":
      return 0.35;
    case "unlikely":
      return 0.15;
  }
}

export async function prose(
  pkg: PulseDataPackage<AnomalyExplanationPayload>,
  ctx: ProseContext,
): Promise<PulseDataPackage<AnomalyExplanationPayload>> {
  const { observation_id, period_key, context } = pkg.payload;

  // Re-load the facts window — prose() runs in a separate worker pass and
  // the 7-day window may have shifted (live-mode rewrites _facts.json on
  // every chokidar tick). Cheap I/O, fresher numbers.
  const factsWindow = await loadAnomalyFactsWindow(period_key);

  const baseModel = config.model;

  if (ctx.criticModel) {
    // Phase 4: a second critic pass would re-rank the hypotheses with a
    // distinct model + critique prompt. Plumbing is in place
    // (`ctx.criticModel` resolves from `settings:critic_model`), but the
    // critique prompt is not finalised yet — log + skip so the base path
    // still surfaces a usable explanation.
    log.info(
      "anomaly_explain",
      `critic enabled (${ctx.criticModel}) — Phase 4 wiring pending, running base only`,
    );
  }

  const result = await explainAnomaly(
    {
      observation_id,
      period_key,
      observation_text: context.observation_text,
      context_facts: factsWindow,
    },
    {
      model: baseModel,
      ollamaUrl: config.ollamaUrl,
    },
  );

  const hypotheses: AnomalyHypothesis[] = result.hypotheses.map((h) => ({
    factor: h.factor,
    strength: h.strength,
    rationale: h.rationale,
  }));

  // Per-hypothesis provenance — surfaces in the dashboard's <ProvenanceRow>
  // as a grouped "KI-Berechnung" pill, with the per-tag confidence the
  // inspector overlay can show on hover.
  const hypothesisProvenance: ProvenanceTag[] = hypotheses.map((h, i) => ({
    field_path: `hypotheses[${i}]`,
    source: "llm_derived",
    confidence: strengthToConfidence(h.strength),
  }));

  const nextPayload: AnomalyExplanationPayload = {
    ...pkg.payload,
    hypotheses,
    model: ctx.criticModel ? `${baseModel}+${ctx.criticModel}` : baseModel,
  };

  return {
    ...pkg,
    payload: nextPayload,
    provenance: [...pkg.provenance, ...hypothesisProvenance],
    generated_at: new Date().toISOString(),
  };
}
