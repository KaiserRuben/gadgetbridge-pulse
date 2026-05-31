/**
 * Stage B — text-only LLM fallback for per-100g nutrition.
 *
 * Called when food-db seed misses on a food_key. Single qwen3.6 text call
 * with the strict locked enrich-output schema as `format` parameter AND
 * post-parse validation via parseAndValidate (pydantic-style). Result is
 * meant to be cached in PULSE_FOOD_NUTRITION so the same food_key is never
 * asked twice. Caller persists; this function returns the per_100g block
 * + the runner-side cache envelope.
 *
 * Prompt + schema: docs/NUTRITION_VLM_VALIDATION.md §3.1.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { parseAndValidate, SchemaValidationError } from "../validate.ts";
import type { EnrichOutput, NutritionFacts } from "../types.ts";

const SCHEMA_PATH = fileURLToPath(
  new URL("../../schemas/nutrition/enrich-output.schema.json", import.meta.url),
);

let schemaCache: unknown = null;
async function loadSchema(): Promise<unknown> {
  if (schemaCache) return schemaCache;
  schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

const SYSTEM_PROMPT = `Du bist eine Nährwert-Datenbank. Liefere pro Speise die durchschnittlichen
Werte je 100g essbarer Anteil (raw oder gekocht, wie im Namen spezifiziert).

Regeln:
- Antworte ausschließlich als gültiges JSON gemäß Schema. Kein Prosa.
- Werte basieren auf typischen USDA-/BLS-Referenzen für die genannte Form
  (roh vs. gekocht, mit/ohne Schale).
- Einheiten: kcal, g, mg, µg. Keine Konvertierung.
- vit_b12_ug: 0 wenn pflanzlich.
- notes: 1 Satz mit Annahmen (Zubereitung, Sorte) oder Unsicherheiten.`;

const OPTIONS = {
  temperature: 0.1,
  // num_predict inherits config.ollamaOptions (32k shared cap).
  num_ctx: 8192,
};

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

export interface EnrichInput {
  food_key: string;
  label_de: string;
}

export interface EnrichLLMResult {
  raw: EnrichOutput;
  /** Storage-shape per100g (renamed from per_100g). */
  per100g: NutritionFacts;
  latencyMs: number;
  model: string;
  captured_at: string;
}

export async function enrichFoodViaLLM(input: EnrichInput): Promise<EnrichLLMResult> {
  const model = config.model;
  const schema = await loadSchema();
  const userContent = `Liefere die Nährwerte pro 100g für:\nfood_key: ${input.food_key}\nlabel_de: ${input.label_de}`;
  const body = {
    model,
    stream: false,
    messages: [
      { role: "user" as const, content: `${SYSTEM_PROMPT}\n\n${userContent}` },
    ],
    format: schema,
    options: { ...config.ollamaOptions, ...OPTIONS },
  };
  const start = Date.now();
  const url = `${config.ollamaUrl.replace(/\/+$/, "")}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
  } catch (err) {
    throw new Error(`enrichFoodViaLLM: fetch failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`enrichFoodViaLLM: HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as OllamaChatResponse;
  const content = json.message?.content ?? "";
  if (!content) {
    throw new Error(`enrichFoodViaLLM: empty content (done_reason=${json.done_reason ?? "?"})`);
  }
  let raw: EnrichOutput;
  try {
    raw = parseAndValidate<EnrichOutput>(content, schema);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new Error(`enrichFoodViaLLM: ${err.message}`);
    }
    throw err;
  }
  const per100g: NutritionFacts = {
    kcal: raw.per_100g.kcal,
    protein_g: raw.per_100g.protein_g,
    carbs_g: raw.per_100g.carbs_g,
    fat_g: raw.per_100g.fat_g,
    fiber_g: raw.per_100g.fiber_g,
    iron_mg: raw.per_100g.iron_mg,
    vit_c_mg: raw.per_100g.vit_c_mg,
    vit_b12_ug: raw.per_100g.vit_b12_ug,
    calcium_mg: raw.per_100g.calcium_mg,
    magnesium_mg: raw.per_100g.magnesium_mg,
  };
  const latencyMs = Date.now() - start;
  log.info(
    "nutrition",
    `enrichFoodViaLLM ${input.food_key} ${latencyMs}ms kcal=${per100g.kcal}`,
  );
  return {
    raw,
    per100g,
    latencyMs,
    model,
    captured_at: new Date().toISOString(),
  };
}
