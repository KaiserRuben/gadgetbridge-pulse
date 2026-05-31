/**
 * Anomaly explanation — narrow LLM call (Phase 3, Probe 2 scope).
 *
 * Pure function. Given an anomaly observation and a 7-day _facts.json window,
 * asks qwen3.6 to rank plausible influence factors. Output is a tiny JSON
 * object with a hypotheses array (≤5 items, each {factor, strength,
 * rationale}). Schema-enforced via Ollama `format`.
 *
 * Locked scope per PROBE_anomaly_explanation.md: 7-day _facts.json window,
 * `think: false`, German output, English schema, ~26 s typical latency on
 * qwen3.6:latest (Q4_K_M, 36B MoE).
 *
 * No I/O at module top level. No file reads. No state. Caller assembles the
 * 7 days of facts and passes them in.
 */

import { callOllama } from "../ollama.ts";

export interface AnomalyExplanationInput {
  observation_id: string;
  /** YYYY-MM-DD anomaly day. */
  period_key: string;
  /** Free-text framing of the anomaly (e.g. driver clause + delta_text). */
  observation_text: string;
  /** 7 days of `_facts.json` content (today + 6 prior). */
  context_facts: object[];
}

export type HypothesisStrength = "strong" | "moderate" | "weak" | "unlikely";

export interface AnomalyHypothesis {
  factor: string;
  strength: HypothesisStrength;
  /** ≤120 chars; must cite a value/number from the input. */
  rationale: string;
}

export interface AnomalyExplanation {
  hypotheses: AnomalyHypothesis[];
}

export interface ExplainAnomalyOptions {
  model?: string;
  ollamaUrl?: string;
  /**
   * TODO: no longer wired. `callOllama` uses a long-run dispatcher with
   * timeouts disabled (qwen3.6 cold-load + thinking can exceed normal
   * limits). Kept for source compatibility with existing call sites.
   */
  timeoutMs?: number;
}

/**
 * Final shipping prompt — see PROBE_anomaly_explanation.md § "Final prompt to
 * ship". Adds the two post-validator-aligned guard lines learned from probes
 * 1-3 (data-quality artefacts capped at `unlikely`; cross-day attributions
 * must reference the anomaly day or a delta involving it).
 */
const SYSTEM_PROMPT = `Du analysierst eine einzelne Gesundheits-Anomalie und rankst plausible Einflussfaktoren. Du diagnostizierst NICHT. Du gibst keine medizinische Empfehlung. Du nennst nur datengestützte Hypothesen mit Stärke-Label.

Output: JSON {"hypotheses": [{"factor": string, "strength": "strong"|"moderate"|"weak"|"unlikely", "rationale": string (<=120 Zeichen, zitiere konkrete Zahl/Wert aus den Daten)}]}.

Maximal 5 Hypothesen, sortiert nach Stärke absteigend. Wenn die Daten keine konkrete Hypothese stützen, gib eine einzige "unlikely" Hypothese zurück mit rationale="Daten reichen nicht aus".

Datenqualitäts-Lücken (fehlende Sensoren, kurze Tragezeit, niedrige Sample-Zahl) niemals als strong oder moderate, immer unlikely. Eine als strong markierte Hypothese muss die Anomalie selbst oder ein Delta zwischen Anomalietag und Vortagen zitieren — keine isolierten Vortagswerte. Keine Diagnosen, keine Medikamenten- oder Substanznamen, keine Empfehlungen.`;

const HYPOTHESES_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          factor: { type: "string" },
          strength: {
            type: "string",
            enum: ["strong", "moderate", "weak", "unlikely"],
          },
          rationale: { type: "string", maxLength: 120 },
        },
        required: ["factor", "strength", "rationale"],
      },
    },
  },
  required: ["hypotheses"],
} as const;

const STRENGTH_VALUES: ReadonlySet<HypothesisStrength> = new Set([
  "strong",
  "moderate",
  "weak",
  "unlikely",
]);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buildUserMessage(input: AnomalyExplanationInput): string {
  return (
    `Anomalie: ${input.observation_id}, ${input.observation_text} am ${input.period_key}. ` +
    `Kontext (7 Tage): ${JSON.stringify(input.context_facts)}. ` +
    `Was sind plausible Einflussfaktoren?`
  );
}

function parseExplanation(raw: string): AnomalyExplanation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `anomaly-explanation: invalid JSON content from LLM: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("anomaly-explanation: top-level must be an object");
  }
  const obj = parsed as { hypotheses?: unknown };
  if (!Array.isArray(obj.hypotheses)) {
    throw new Error("anomaly-explanation: missing hypotheses array");
  }
  const hypotheses: AnomalyHypothesis[] = [];
  for (const item of obj.hypotheses) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("anomaly-explanation: hypothesis entry not an object");
    }
    const h = item as { factor?: unknown; strength?: unknown; rationale?: unknown };
    if (typeof h.factor !== "string") {
      throw new Error("anomaly-explanation: hypothesis.factor must be string");
    }
    if (typeof h.strength !== "string" || !STRENGTH_VALUES.has(h.strength as HypothesisStrength)) {
      throw new Error(`anomaly-explanation: invalid strength '${String(h.strength)}'`);
    }
    if (typeof h.rationale !== "string") {
      throw new Error("anomaly-explanation: hypothesis.rationale must be string");
    }
    hypotheses.push({
      factor: h.factor,
      strength: h.strength as HypothesisStrength,
      rationale: h.rationale,
    });
  }
  return { hypotheses };
}

/**
 * Single Ollama chat call. Routes through the shared `callOllama` wrapper so
 * the schema-enforcement fix (no `think: false`) and structured logging apply
 * uniformly. Single-GPU environment — caller is responsible for serialising
 * concurrent calls.
 */
export async function explainAnomaly(
  input: AnomalyExplanationInput,
  opts: ExplainAnomalyOptions = {},
): Promise<AnomalyExplanation> {
  const model = opts.model ?? "qwen3.6:latest";

  // Deterministic seed per (observation_id, period_key) so re-runs for the
  // same anomaly produce stable rankings (PROBE found temp=0.3 alone drifted
  // top hypothesis across runs). FNV-1a 32-bit; Ollama clamps to int range.
  const seed = fnv1a(`${input.observation_id}|${input.period_key}`);

  const result = await callOllama({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    format: HYPOTHESES_SCHEMA,
    options: {
      temperature: 0.3,
      num_ctx: 8192,
      seed,
    },
    baseUrl: opts.ollamaUrl,
    tag: "anomaly_explanation",
  });

  const content = result.content;
  if (!content) {
    throw new Error("anomaly-explanation: empty content");
  }
  return parseExplanation(content);
}
