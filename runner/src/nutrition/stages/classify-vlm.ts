/**
 * Stage A — VLM food classification.
 *
 * Sends a meal photo (+ optional user_text) to Ollama's chat endpoint with
 * `format` set to the classify-output JSON schema. Response is JSON-parsed
 * AND schema-validated against the same schema (pydantic-style) so we
 * never accept an empty body that the network layer happily delivered.
 *
 * Prompt is the v4-locked text from docs/NUTRITION_VLM_VALIDATION.md §2.4.
 * Caller-side hardening per §2.5: on done_reason=length + empty content,
 * retry once with the hint stripped at temperature=0.4. Second failure →
 * surface as `failed_classify` upstream; do not invent components.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { parseAndValidate, SchemaValidationError } from "../validate.ts";
import type { ClassifyOutput, MealJob } from "../types.ts";

const SCHEMA_PATH = fileURLToPath(
  new URL("../../schemas/nutrition/classify-output.schema.json", import.meta.url),
);

let schemaCache: unknown = null;
async function loadSchema(): Promise<unknown> {
  if (schemaCache) return schemaCache;
  schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

// Locked v4 prompt — see docs/NUTRITION_VLM_VALIDATION.md §2.4.
// Extended to handle multi-image meals: the user can attach the food shot
// plus the nutrition label / packaging / receipt as separate images. The
// model resolves them as one meal, using the label numbers to anchor
// per-100g values when present.
const SYSTEM_PROMPT = `Du bist Ernährungsanalyst. Antworte nur als JSON gemäß Schema.

Erkenne sichtbare Komponenten in der Mahlzeit und schätze deren Masse
in Gramm. Das Bild zeigt das Essen *vor* dem Verzehr (Konvention der
App). Ein eventueller Nutzer-Hinweis beschreibt Abweichungen (anderes
Gericht, andere Menge, nicht aufgegessen).

MEHRERE BILDER (wenn vorhanden):
- Bild #1 ist normalerweise das Essen (die "meal" Aufnahme).
- Weitere Bilder können sein:
  - Verpackung / Nährwert-Label ("label"): liefert per-100g Werte
    deterministisch. Wenn ein Label sichtbar ist, übernimm die label-Werte
    für betroffene Komponenten und notiere "label gelesen" in notes.
    Schätze NICHT, wenn das Label die Werte angibt.
  - Kontext-Aufnahmen ("context"): Tellerwinkel, Quittung, Servierbesteck —
    helfen bei der Massen-Schätzung, sind aber nicht selbst Nahrung.
- Es gibt nie mehr Komponenten als die Summe sichtbarer Speisen in Bild #1
  (auch wenn das Label viele Inhaltsstoffe listet). Inhaltsstoffe aus einem
  Label NICHT als eigene components auflisten — nur als anchor in rationale.

Algorithmus für den Nutzer-Hinweis (deterministisch):
1. Anteil-Angabe ("⅔ gegessen", "die Hälfte"): skaliere ALLE
   sichtbaren Komponenten mit dem Anteil. source bleibt "vlm". Notiere
   "skaliert mit Hinweis: <faktor>" in notes.
2. Spezifische Menge + Komponentenname ("120g Kuchen", "30g Butter"):
   ersetze die genannte Komponente. food_key/label/grams aus Hinweis.
   source="user_text". Weitere sichtbare Komponenten bleiben "vlm".
3. Vollständig anderer Mahlzeitname mit Menge ("300ml Matcha Latte"):
   ersetze ALLE Komponenten durch eine aus dem Hinweis.
   source="user_text". Notiere visuellen Konflikt in notes.
4. Sonst: ignoriere den Hinweis.

Format-Regeln:
- food_key: snake_case, deutsche Wurzeln, ae/oe/ue/ss statt Umlaute.
- label: deutsch, mit Umlauten ok.
- confidence ∈ [0,1].
- rationale: max 10 Wörter, mit visuellem Anker.

Schreibe das JSON direkt. Keine Vorrede.`;

interface CallOptions {
  temperature: number;
  num_predict: number;
  num_ctx: number;
}

const OPTIONS: CallOptions = {
  temperature: 0.1,
  num_predict: 3000,
  num_ctx: 8192,
};

const RETRY_OPTIONS: CallOptions = {
  ...OPTIONS,
  temperature: 0.4,
};

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

/** One prepared image to send to the VLM. */
export interface ClassifyImage {
  /** Raw base64 (no `data:` prefix), already resized for VLM input. */
  base64: string;
  /** Optional hint to the model (and the UI): "meal" / "label" / "context". */
  kind: "meal" | "label" | "context" | null;
  ord: number;
}

export interface ClassifyInput {
  job: MealJob;
  /**
   * Photos to attach to the VLM call, in display order. Empty array = text-only
   * meal. Up to MAX_PHOTOS_PER_MEAL entries (4) — the upload route enforces.
   */
  images: ClassifyImage[];
}

export interface ClassifyResult {
  output: ClassifyOutput;
  latencyMs: number;
  model: string;
  hintDropped: boolean;
}

export async function classifyMeal(input: ClassifyInput): Promise<ClassifyResult> {
  const model = config.model;
  const schema = await loadSchema();
  const hint = input.job.user_text?.trim() || "";

  const start = Date.now();
  const first = await callClassify(
    model,
    schema,
    input.images,
    hint,
    OPTIONS,
  );
  if (first.ok) {
    return {
      output: first.output,
      latencyMs: Date.now() - start,
      model,
      hintDropped: false,
    };
  }
  log.warn(
    "nutrition",
    `classify ${input.job.meal_id}: first pass empty (${first.reason}) — retry without hint`,
  );
  const retry = await callClassify(model, schema, input.images, "", RETRY_OPTIONS);
  if (!retry.ok) {
    throw new Error(
      `classifyMeal: both passes failed (${first.reason} / ${retry.reason})`,
    );
  }
  const out = retry.output;
  if (hint) {
    out.notes = out.notes
      ? `${out.notes} (Hinweis verworfen: ${hint})`
      : `Hinweis verworfen wegen Mehrdeutigkeit: ${hint}`;
  }
  return {
    output: out,
    latencyMs: Date.now() - start,
    model,
    hintDropped: true,
  };
}

interface CallOk {
  ok: true;
  output: ClassifyOutput;
}
interface CallFail {
  ok: false;
  reason: string;
}

function describeImages(images: ClassifyImage[]): string {
  if (images.length === 0) return "Kein Bild — nur Text.";
  if (images.length === 1) {
    const k = images[0].kind;
    return k ? `1 Bild (#1 ${k}).` : "1 Bild ohne Typ-Hinweis.";
  }
  const parts = images.map((img, i) => `#${i + 1} ${img.kind ?? "meal"}`);
  return `${images.length} Bilder in Reihenfolge: ${parts.join(", ")}.`;
}

async function callClassify(
  model: string,
  schema: unknown,
  images: ClassifyImage[],
  hint: string,
  options: CallOptions,
): Promise<CallOk | CallFail> {
  const imageNote = describeImages(images);
  const userContent =
    hint.length > 0
      ? `${imageNote} Nutzer-Hinweis: "${hint.replace(/"/g, '\\"')}"`
      : imageNote;
  // Strict JSON-Schema (pydantic-equivalent grammar) is always sent as
  // `format`. Vision + schema works on this stack; the lenient `format:"json"`
  // fallback we used briefly produced outputs missing required scalars
  // (meal_kind) and was the wrong call.
  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "user" as const,
        content: `${SYSTEM_PROMPT}\n\n${userContent}`,
        ...(images.length > 0 ? { images: images.map((img) => img.base64) } : {}),
      },
    ],
    format: schema,
    options,
  };
  const url = `${config.ollamaUrl.replace(/\/+$/, "")}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return { ok: false, reason: `fetch: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, reason: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
  }
  const json = (await res.json()) as OllamaChatResponse;
  const content = json.message?.content ?? "";
  if (!content) {
    return {
      ok: false,
      reason: `empty content (done_reason=${json.done_reason ?? "unknown"})`,
    };
  }
  try {
    const output = parseAndValidate<ClassifyOutput>(content, schema);
    return { ok: true, output };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return { ok: false, reason: `schema: ${err.message}` };
    }
    return { ok: false, reason: `parse: ${err instanceof Error ? err.message : err}` };
  }
}

