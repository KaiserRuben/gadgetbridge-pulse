/**
 * Pattern naming — Phase 3 (PROBE_pattern_naming_and_surprise.md).
 *
 * Salience-injection LLM call. Given one detected `PatternCluster` plus up
 * to 3 example `_facts.json` payloads, asks qwen3.6 to produce a German
 * `name_de` (≤30 chars) + `description_de` (≤120 chars) for the cluster.
 *
 * Critical rule learned from the probe: the model must be told WHICH
 * features are dominant. Without `salient_flags` injection it picks a
 * coherent narrative not the salient one (probe missed `hr_max ~127` on
 * the S1 trio). The system prompt below mandates that the salient flags
 * MUST appear in name OR description.
 *
 * Hard 60s timeout. Caller serialises (single GPU).
 */

import type { PatternCluster } from "./pattern-detection.ts";
import { callOllama } from "../ollama.ts";

export interface NamedPattern extends PatternCluster {
  name_de: string;
  description_de: string;
}

export interface NamePatternOptions {
  model?: string;
  ollamaUrl?: string;
  /**
   * TODO: no longer wired. `callOllama` uses a long-run dispatcher with
   * timeouts disabled. Kept for source compatibility.
   */
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `Du benennst eine wiederkehrende Multi-Metrik-Signatur aus Gesundheitsdaten.
Wichtig: die SALIENT_FLAGS unten benennen die DOMINANTEN Merkmale — du MUSST
diese im Namen oder in der Beschreibung erwähnen. Nicht nebensächliche
Merkmale erwähnen, sondern die markierten.

Output: JSON {name_de (≤30 Zeichen, deutsch), description_de (≤120 Zeichen, ein Satz)}.

NICHT diagnostisch. NICHT pathologisierend. Beschreib nur, was die Daten gemeinsam zeigen.`;

const PATTERN_SCHEMA = {
  type: "object",
  properties: {
    name_de: { type: "string", maxLength: 30 },
    description_de: { type: "string", maxLength: 120 },
  },
  required: ["name_de", "description_de"],
} as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h | 0;
}

function buildUserMessage(
  cluster: PatternCluster,
  exampleDays: object[],
): string {
  return [
    `SALIENT_FLAGS: ${cluster.salient_flags.join(", ")}`,
    `Vorkommen letzte 90 Tage: ${cluster.occurrence_count}`,
    `Beispieltage (3): ${JSON.stringify(exampleDays.slice(0, 3))}`,
    "",
    "Wie würdest du diese Signatur kurz benennen?",
  ].join("\n");
}

function parseNamed(raw: string): { name_de: string; description_de: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `pattern-naming: invalid JSON content from LLM: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("pattern-naming: top-level must be an object");
  }
  const obj = parsed as { name_de?: unknown; description_de?: unknown };
  if (typeof obj.name_de !== "string") {
    throw new Error("pattern-naming: missing name_de");
  }
  if (typeof obj.description_de !== "string") {
    throw new Error("pattern-naming: missing description_de");
  }
  return { name_de: obj.name_de, description_de: obj.description_de };
}

export async function namePattern(
  cluster: PatternCluster,
  exampleDays: object[],
  opts: NamePatternOptions = {},
): Promise<NamedPattern> {
  const model = opts.model ?? "qwen3.6:latest";
  const seed = fnv1a(cluster.signature_id);

  const result = await callOllama({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(cluster, exampleDays),
    format: PATTERN_SCHEMA,
    options: {
      temperature: 0.2,
      num_ctx: 16384,
      num_predict: 256,
      seed,
    },
    baseUrl: opts.ollamaUrl,
    tag: "pattern_naming",
  });

  const content = result.content;
  if (!content) {
    throw new Error("pattern-naming: empty content");
  }
  const named = parseNamed(content);
  return {
    ...cluster,
    name_de: named.name_de.slice(0, 30),
    description_de: named.description_de.slice(0, 120),
  };
}
