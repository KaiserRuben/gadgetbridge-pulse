/**
 * Stage 3 — Evidence picker prompt (English, free-form JSON).
 *
 * Asks the model to pick 3–5 observation IDs from the rule-engine output to
 * narrate in the daily insight. Returns
 *   { "selected_ids": string[], "rationale": string }
 *
 * No `format` schema is sent — the response is a plain JSON object that the
 * caller parses with JSON.parse. On any parse / shape failure the caller
 * falls back to a deterministic top-3 by tier+severity.
 */

import type { Observation } from "@/lib/types/observations";

export const EVIDENCE_PICKER_SYSTEM = `You are an editor selecting which observations to narrate in a daily personal-health insight.
Given a list of typed observations from a deterministic rule engine, pick 3–5 most narratively important.
Return JSON only: { "selected_ids": string[], "rationale": string }
Rationale ≤ 80 chars, English, plain.
Prioritize: tier S1 always; then tier S2; then high-severity informational; then up-to-3 narrative-eligible.`;

export function buildEvidencePickerUser(observations: Observation[]): string {
  if (observations.length === 0) {
    return "OBSERVATIONS: (none)";
  }
  return `OBSERVATIONS:\n${observations
    .map(
      (o) =>
        `- id=${o.id} domain=${o.domain} severity=${o.severity} tier=${o.tier ?? "null"}: ${o.text_for_llm}`,
    )
    .join("\n")}`;
}

/**
 * Shape of the parsed picker response (free-form, validated structurally
 * by the caller, NOT via AJV).
 */
export interface EvidencePickerResponse {
  selected_ids: string[];
  rationale: string;
}

/**
 * Best-effort structural validation of a parsed picker response.
 * Returns the typed object on success, or null on any shape mismatch.
 */
export function parseEvidencePickerResponse(
  raw: unknown,
): EvidencePickerResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const ids = obj.selected_ids;
  const rationale = obj.rationale;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((s) => typeof s === "string")) return null;
  if (typeof rationale !== "string") return null;
  return { selected_ids: ids, rationale };
}
