/**
 * Stage C — day-level multi-image aggregator.
 *
 * One qwen3.6 vision call: all of the day's meal photos in chronological
 * order + per-meal structured totals → `day_pattern.events` + `flags`.
 * Runner wraps the model output with deterministic fields (totals, delta,
 * period_key, meals_count, day_complete) before persisting to PULSE_INSIGHT
 * cluster='nutrition'.
 *
 * Caller is expected to feed pre-shrunk images (long-edge ≤ 512 px JPEG
 * q75 via `nutrition/image-prep.ts`). qwen3.6's model runner crashes
 * under VRAM pressure when fed full-resolution photos; cap input bytes
 * upstream, not patch the output downstream.
 *
 * Mode: `format: "json"` (Ollama-native JSON-mode, no grammar engine).
 *
 * Why not strict JSON-Schema: empirically, qwen3.6 + vision input under
 * Ollama's grammar engine crashes the model runner ("HTTP 500: model
 * runner has unexpectedly stopped") with any image count ≥ 1 on local
 * Apple Silicon hardware. Pure-text strict works (Stage B is fine). The
 * grammar engine + vision context allocation exceeds available VRAM.
 *
 * Defense without strict grammar:
 *   1. The prompt declares the exact JSON shape inline (no grammar, but a
 *      verbatim example). Field names, enum values, and the day_pattern
 *      wrapper are all spelled out.
 *   2. Ollama `format: "json"` enforces "output is parseable JSON".
 *   3. Client-side parseAndValidate runs the locked schema after parse.
 *      Shape drift is a real failure — we do NOT silently reshape; if the
 *      prompt no longer constrains the model, the prompt is what needs to
 *      change, not the parser.
 *   4. stripFences pre-parse hygiene: drop ```json ... ``` if the model
 *      wraps the object in markdown. Content-agnostic, not a schema decision.
 *
 * On a genuine HTTP 500 / fetch-level crash we retry once after a 5 s
 * backoff to ride out Ollama's autorecover window.
 *
 * Prompt + schema: docs/NUTRITION_VLM_VALIDATION.md §4.1.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { parseAndValidate, SchemaValidationError } from "../validate.ts";
import type {
  DayAggregateOutput,
  DayPatternKind,
  NutritionFacts,
} from "../types.ts";

const SCHEMA_PATH = fileURLToPath(
  new URL("../../schemas/nutrition/day-aggregate-output.schema.json", import.meta.url),
);

let schemaCache: unknown = null;
async function loadSchema(): Promise<unknown> {
  if (schemaCache) return schemaCache;
  schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

const SYSTEM_PROMPT = `Du bist ein Ernährungsmuster-Erkenner. Antworte AUSSCHLIESSLICH
mit einem JSON-Objekt in genau diesem Format:

{
  "day_pattern": {
    "events": [
      {
        "kind": "single_meal",
        "started_at": "2026-05-17T12:30:00+02:00",
        "ended_at": "2026-05-17T14:15:00+02:00",
        "meal_ids": ["m1", "m2"],
        "summary": "1-2 deutsche Sätze, max 240 Zeichen."
      }
    ],
    "flags": ["high_sugar_afternoon", "alcohol_consumption"]
  }
}

Feldnamen exakt so verwenden: "kind" (NICHT "event_type"), "meal_ids",
"started_at", "ended_at", "summary". "flags" steht NUR auf day_pattern-
Ebene, NIEMALS in einem Event. "day_pattern" ist der Wurzelschlüssel.

"kind" darf nur einer dieser Werte sein:
- "single_meal"   : eine eigenständige Mahlzeit
- "multi_course"  : mehrere Fotos in ≤2h, gleicher Anlass (Restaurant,
                    Brunch, Café-Pause mit Kuchen+Getränk)
- "snacking"      : kontinuierliches Naschen über >2h
- "drink_round"   : Getränke ohne nennenswerten Solid-Food-Anteil

Erkenne MUSTER, beschreibe nicht jedes Foto einzeln. Bei drei zeitlich
engen Bildern (Hauptmahlzeit + Dessert + Getränk) ein einziges Event
"multi_course" mit allen drei meal_ids.

"meal_ids" referenziert die im Input genannten Pseudo-IDs ("m1", "m2", ...).
"flags" sind kurze snake_case-Marker für ungewöhnliche Muster, max 20.`;

const OPTIONS = {
  temperature: 0.1,
  // num_predict inherits config.ollamaOptions (32k shared cap).
  // num_ctx drives KV-cache allocation. Multi-image vision burns ~1k
  // tokens per 512 px photo; prompt + schema is < 600 tokens; output is
  // < 800. 4096 is comfortable headroom and keeps the activation memory
  // small enough that local Apple Silicon survives 3 vision contexts.
  num_ctx: 4096,
};

const RETRY_BACKOFF_MS = 5_000;

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

export interface DayAggregateMealInput {
  /** Real meal id (uuid). Mapped to `m1`, `m2`, ... at call time. */
  meal_id: string;
  meal_at: string;
  kind: string;
  totals: NutritionFacts;
  /** Pre-shrunk JPEG base64 (long-edge ≤ 512 px). null = text-only meal. */
  imageBase64: string | null;
}

export interface DayAggregateInput {
  period_key: string;
  meals: DayAggregateMealInput[];
  day_complete: boolean;
}

export interface DayPatternEvent {
  kind: DayPatternKind;
  started_at: string;
  ended_at: string;
  meal_ids: string[];
  summary: string;
}

export interface DayPatternBlock {
  schema_version: "nutrition/day-pattern/v1";
  period_key: string;
  language: "de";
  totals: NutritionFacts;
  delta_vs_target: Record<string, number>;
  events: DayPatternEvent[];
  flags: string[];
  meals_count: number;
  day_complete: boolean;
}

export interface DayAggregateResult {
  output: DayPatternBlock;
  latencyMs: number;
  model: string;
  retried: boolean;
}

export async function aggregateDay(input: DayAggregateInput): Promise<DayAggregateResult> {
  const model = config.model;
  const schema = await loadSchema();
  const realIdByPseudo = new Map<string, string>();
  const lines: string[] = [];
  input.meals.forEach((m, idx) => {
    const pseudo = `m${idx + 1}`;
    realIdByPseudo.set(pseudo, m.meal_id);
    lines.push(
      `- ${pseudo} | ${m.meal_at} | kind=${m.kind} | totals=${JSON.stringify(m.totals)}`,
    );
  });
  const userContent = `Mahlzeiten heute (chronologisch). Die Bilder kommen in derselben Reihenfolge:\n\n${lines.join("\n")}\n\nLiefere day_pattern gemäß Schema. ISO-Zeiten in started_at/ended_at, identisch oder eng am Range der Mahlzeiten.`;
  const images = input.meals
    .map((m) => m.imageBase64)
    .filter((b): b is string => Boolean(b));

  const start = Date.now();
  let raw: DayAggregateOutput;
  let retried = false;
  try {
    raw = await callModel(model, schema, userContent, images);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const recoverable =
      msg.includes("HTTP 500") ||
      msg.includes("fetch failed") ||
      msg.includes("ECONNRESET");
    if (!recoverable) throw err;
    log.warn(
      "nutrition",
      `aggregateDay ${input.period_key}: ${msg} → retry after ${RETRY_BACKOFF_MS}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    retried = true;
    raw = await callModel(model, schema, userContent, images);
  }
  const latencyMs = Date.now() - start;

  // Map pseudo-IDs back to real meal IDs. Drop events that reference unknown
  // pseudo-IDs entirely (model hallucination); never silently mis-attribute.
  const events: DayPatternEvent[] = [];
  for (const ev of raw.day_pattern.events) {
    const mapped: string[] = [];
    let ok = true;
    for (const pseudo of ev.meal_ids) {
      const real = realIdByPseudo.get(pseudo);
      if (!real) {
        ok = false;
        break;
      }
      mapped.push(real);
    }
    if (!ok) {
      log.warn(
        "nutrition",
        `aggregateDay ${input.period_key}: dropped event with unknown meal_ids: ${ev.meal_ids.join(",")}`,
      );
      continue;
    }
    events.push({
      kind: ev.kind,
      started_at: ev.started_at,
      ended_at: ev.ended_at,
      meal_ids: mapped,
      summary: ev.summary,
    });
  }

  const totals = sumTotals(input.meals.map((m) => m.totals));
  const output: DayPatternBlock = {
    schema_version: "nutrition/day-pattern/v1",
    period_key: input.period_key,
    language: "de",
    totals,
    delta_vs_target: {}, // populated by v3 packager once targets are loaded
    events,
    flags: raw.day_pattern.flags,
    meals_count: input.meals.length,
    day_complete: input.day_complete,
  };

  log.info(
    "nutrition",
    `aggregateDay ${input.period_key} ${latencyMs}ms (${events.length} events, ${raw.day_pattern.flags.length} flags${retried ? ", retried" : ""})`,
  );
  return { output, latencyMs, model, retried };
}

async function callModel(
  model: string,
  schema: unknown,
  userContent: string,
  images: string[],
): Promise<DayAggregateOutput> {
  const body = {
    model,
    stream: false,
    // `think: false` because thinking eats num_predict before any visible
    // content lands in json-mode (no grammar engine to anchor emission).
    think: false,
    messages: [
      {
        role: "user" as const,
        content: `${SYSTEM_PROMPT}\n\n${userContent}`,
        ...(images.length > 0 ? { images } : {}),
      },
    ],
    options: { ...config.ollamaOptions, ...OPTIONS },
    format: "json",
  };
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
    throw new Error(`aggregateDay: fetch failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`aggregateDay: HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as OllamaChatResponse;
  const content = json.message?.content ?? "";
  if (!content) {
    throw new Error(`aggregateDay: empty content (done_reason=${json.done_reason ?? "?"})`);
  }
  const adapted = stripFences(content);
  try {
    return parseAndValidate<DayAggregateOutput>(adapted, schema);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      log.warn(
        "nutrition",
        `aggregateDay validate fail: ${err.message}; raw=${adapted.slice(0, 400)}`,
      );
      throw new Error(`aggregateDay: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Strip a leading/trailing ```json ... ``` fence. qwen3.6 occasionally
 * wraps the JSON object in markdown despite `format: "json"`. Pure
 * pre-parse hygiene — no schema decisions.
 */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fence ? fence[1].trim() : trimmed;
}

function sumTotals(items: NutritionFacts[]): NutritionFacts {
  const out: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) {
    out.kcal += it.kcal;
    out.protein_g += it.protein_g;
    out.carbs_g += it.carbs_g;
    out.fat_g += it.fat_g;
    addOpt(out, it, "fiber_g");
    addOpt(out, it, "iron_mg");
    addOpt(out, it, "calcium_mg");
    addOpt(out, it, "magnesium_mg");
    addOpt(out, it, "vit_c_mg");
    addOpt(out, it, "vit_b12_ug");
    addOpt(out, it, "vit_d_ug");
    addOpt(out, it, "zinc_mg");
    addOpt(out, it, "folate_ug");
    addOpt(out, it, "omega3_g");
    addOpt(out, it, "sodium_mg");
    addOpt(out, it, "saturated_fat_g");
    addOpt(out, it, "sugar_g");
  }
  out.kcal = round(out.kcal);
  out.protein_g = round(out.protein_g);
  out.carbs_g = round(out.carbs_g);
  out.fat_g = round(out.fat_g);
  return out;
}

function addOpt(out: NutritionFacts, src: NutritionFacts, key: keyof NutritionFacts): void {
  const v = src[key];
  if (typeof v === "number") out[key] = round((out[key] ?? 0) + v);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
