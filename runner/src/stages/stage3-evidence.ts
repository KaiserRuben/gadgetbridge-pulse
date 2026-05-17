/**
 * Stage 3 — Evidence picker.
 *
 * Calls the LLM (free-form JSON, NO `format` schema) to pick 3–5 observation
 * IDs that should be narrated in the daily prose. Falls back to a
 * deterministic tier+confidence-ordered top-3 when:
 *   - Ollama is unreachable
 *   - the model returns un-parseable JSON
 *   - the parsed JSON has the wrong shape
 *   - none of the picked IDs match the observation set
 *
 * Output:
 *   { selected_ids: string[]; rationale: string; used_fallback: boolean }
 */

import type { Observation } from "@/lib/types/observations";

import { config } from "../config.ts";
import { callOllama } from "../ollama.ts";
import {
  EVIDENCE_PICKER_SYSTEM,
  buildEvidencePickerUser,
  parseEvidencePickerResponse,
} from "../prompts/evidence-picker.ts";

export interface PickedEvidence {
  /** Observation IDs (in priority order) — 0..5. */
  selected_ids: string[];
  /** Short English rationale (≤80 chars) — empty when fallback used. */
  rationale: string;
  /** True if the deterministic fallback was used instead of the LLM pick. */
  used_fallback: boolean;
  /**
   * Backwards-compat alias — older callers (P3 stub consumers) read `ids`.
   * Mirror of `selected_ids`.
   */
  ids: string[];
}

const MAX_PICKED = 5;
const FALLBACK_LIMIT = 3;

function deterministicFallback(observations: Observation[]): string[] {
  const eligible = observations.filter(
    (o) => !o.suppressed_by || o.suppressed_by.length === 0,
  );
  const byTier = (t: Observation["tier"]) =>
    eligible
      .filter((o) => o.tier === t)
      .sort((a, b) => b.confidence.value - a.confidence.value);
  const ordered = [
    ...byTier("S1"),
    ...byTier("S2"),
    ...byTier("S3"),
    ...byTier(null),
  ];
  return ordered.slice(0, FALLBACK_LIMIT).map((o) => o.id);
}

export async function runStage3(observations: Observation[]): Promise<PickedEvidence> {
  // Empty observation list — nothing to narrate, return empty pick.
  if (observations.length === 0) {
    return {
      selected_ids: [],
      ids: [],
      rationale: "",
      used_fallback: true,
    };
  }

  // Deterministic-first: the LLM pick was costing ~20s per run for a
  // top-3 selection that the rule engine already ranks (tier × severity ×
  // confidence). The LLM only adds value when there are more than a handful
  // of S2/S3 observations competing for slots — toggle in via env flag.
  if (process.env.STAGE3_USE_LLM !== "1") {
    const ids = deterministicFallback(observations);
    console.log(
      `[stage3] picked ${ids.length} ids deterministically: ${ids.join(", ") || "(none)"}`,
    );
    return {
      selected_ids: ids,
      ids,
      rationale: "deterministic top-3 by tier+severity+confidence",
      used_fallback: true,
    };
  }

  const validIds = new Set(observations.map((o) => o.id));

  try {
    const result = await callOllama({
      model: config.model,
      system: EVIDENCE_PICKER_SYSTEM,
      user: buildEvidencePickerUser(observations),
      tag: "stage3_evidence",
      format: undefined,
      options: {
        temperature: 0.1,
        num_predict: 500,
      },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(result.content));
    } catch (err) {
      throw new Error(
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const shape = parseEvidencePickerResponse(parsed);
    if (!shape) throw new Error("response did not match expected shape");

    // Filter to known observation IDs and enforce upper bound.
    const filtered = shape.selected_ids
      .filter((id) => validIds.has(id))
      .slice(0, MAX_PICKED);

    if (filtered.length === 0) {
      throw new Error("no selected_ids matched the observation set");
    }

    console.log(
      `[stage3] picked ${filtered.length} ids via LLM: ${filtered.join(", ")}`,
    );
    return {
      selected_ids: filtered,
      ids: filtered,
      rationale: shape.rationale.slice(0, 80),
      used_fallback: false,
    };
  } catch (err) {
    const ids = deterministicFallback(observations);
    console.warn(
      `[stage3] LLM pick failed (${err instanceof Error ? err.message : err}); fallback ids: ${ids.join(", ") || "(none)"}`,
    );
    return {
      selected_ids: ids,
      ids,
      rationale: "",
      used_fallback: true,
    };
  }
}

/**
 * Some models wrap the JSON object in fenced code or prefix it with prose.
 * Extract the first balanced `{ ... }` block from the content if a direct
 * parse would fail. Best-effort — returns the original string if no balanced
 * block is found (caller's JSON.parse will then error).
 */
function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;
  // Strip a leading code fence (``` or ```json).
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) return fence[1].trim();
  // Find first '{' and matching '}'.
  const start = trimmed.indexOf("{");
  if (start === -1) return trimmed;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed;
}

/**
 * Deterministic stub kept for backwards compatibility with v2-orchestrator.
 * Delegates to {@link runStage3}.
 *
 * @deprecated import {@link runStage3} directly.
 */
export async function runStage3Stub(
  observations: Observation[],
): Promise<PickedEvidence> {
  return runStage3(observations);
}
