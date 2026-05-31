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

import { Agent, fetch as undiciFetch } from "undici";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { parseAndValidate, SchemaValidationError } from "../validate.ts";
import type { ClassifyOutput, MealJob } from "../types.ts";
import {
  SEARCH_NUTRITION_TOOL,
  TOOL_NAMES,
  dispatchSearchNutrition,
} from "./classify-tools.ts";

// Default Node fetch (undici) caps body timeout at 5 min; qwen3.6 vision +
// thinking on cold-cache can exceed that. Disable the per-request body/headers
// timeouts at the dispatcher; the AbortSignal below provides the upper bound.
const vlmDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
});

// Wall-clock upper bound for one /api/chat call. Single-GPU Ollama serialises
// against concurrent v3 day_end calls (qwen3.6 36B, no NUM_PARALLEL), so the
// classify request can sit in the queue 15+ min before the model even starts.
// Bumped from 15 → 45 min and made env-tunable so heavy days don't false-abort.
const CLASSIFY_TIMEOUT_MS = Number(process.env.PULSE_CLASSIFY_TIMEOUT_MS) || 2_700_000;

const SCHEMA_PATH = fileURLToPath(
  new URL("../../schemas/nutrition/classify-output.schema.json", import.meta.url),
);

let schemaCache: unknown = null;
async function loadSchema(): Promise<unknown> {
  if (schemaCache) return schemaCache;
  schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

// Phase 2b decomposition-first prompt. Builds on the v4-locked text from
// docs/NUTRITION_VLM_VALIDATION.md §2.4 but adds:
//   - explicit ZERLEGUNGS-REGEL for composite dishes (Dürüm, Burger,
//     Bowl, Sandwich, Pasta+Sauce, …) so the model returns the underlying
//     components instead of one lumped "Belegtes Brötchen" blob,
//   - extended hint algorithm: rule 3 now applies even WITHOUT a quantity
//     (the user typed "Dürüm Hähnchen" but no gram count → decompose into
//     typical Dürüm components at typical portion sizes),
//   - Verpackung exclusion clarification (a foil/lid is NEVER a component,
//     so we don't double-count what we can't eat).
//
// Multi-image handling (label / context) stays from v4. Length cap raised
// from num_predict=3000 → 20000 because the prior validation doc's "cap is
// unavoidable" finding was wrong: live retest on the Dürüm photo with
// num_predict=20000 produced clean 6-component decomposition in ~70s without
// hitting done_reason=length. The cap was an artificial bug.
export const SYSTEM_PROMPT = `Du bist Ernährungsanalyst. Antworte nur als JSON gemäß Schema.

AUFGABE
Erkenne sichtbare Komponenten in der Mahlzeit und schätze deren Masse
in Gramm. Das Bild zeigt das Essen *vor* dem Verzehr (Konvention der
App). Ein eventueller Nutzer-Hinweis beschreibt Abweichungen (anderes
Gericht, andere Menge, nicht aufgegessen).

ZERLEGUNGS-REGEL (kritisch)
Zusammengesetzte Gerichte MÜSSEN in ihre typischen Bestandteile zerlegt
werden — die einzelnen Lebensmittel, die ein Mensch beim Essen
unterscheidet. Nicht als generischen Blob ("Wrap", "Bowl", "Belegtes
Brötchen", "Sandwich") ausgeben.

Vorgehen:
1. Identifiziere das Gericht (Bild + Hinweis).
2. Liste die typischen Komponenten dieses Gerichts auf — Stärke,
   Protein, Gemüse/Salat, Sauce/Dressing, Würzöl, Käse usw., je nach
   Gericht. Standard-Beilagen, die zur Definition des Gerichts gehören,
   gehören dazu, auch wenn sie im Bild durch Verpackung verdeckt sind.
3. Wenn das Gericht wirklich homogen ist (Suppe, Smoothie, einzelne
   Frucht, Glas Wasser), reicht eine Komponente.

Spezifität:
- food_key beschreibt das Lebensmittel selbst, nicht eine generische
  Kategorie. "kichererbsen_gekocht" statt "huelsenfrucht". Bei
  Zubereitungen, die sich nährwertmäßig deutlich unterscheiden, das
  spezifischere Wort verwenden (z.B. mariniertes Spießfleisch ≠
  Brathähnchenbrust).
- Wenn Du Dir bei der genauen Form unsicher bist (Sorte, Zubereitung),
  trotzdem die plausibelste Spezifikation wählen und confidence senken.

Verpackung (Folie, Box, Teller, Becher, Servierbesteck, Strohhalm) ist
NIE eine Komponente.

MEAL_KIND (wichtig — Default "snack" ist NIE die ehrliche Antwort)
Wähle einen der 5 Werte basierend primär auf Uhrzeit (Europe/Berlin),
sekundär auf Komposition. Die Uhrzeit der Mahlzeit steht im
Nutzer-Header ("Zeit: …").

- "breakfast": 04:00–10:30, oder Komposition klar Frühstück
  (Müsli, Porridge, Brot+Aufstrich, Eier+Brot, Joghurt+Obst).
- "lunch": 11:00–14:30, vollständige Hauptmahlzeit (Stärke +
  Protein + Gemüse), warm oder kalt.
- "dinner": 17:30–22:00, vollständige Hauptmahlzeit.
- "drink": *nur* Getränke, keine festen Komponenten (Kaffee,
  Smoothie, Bier, Wasser, Tee, Saft). Auch wenn das Getränk Kalorien
  hat (Latte, Proteinshake) — solange nichts Festes dabei ist.
- "snack": kleine Zwischenmahlzeit (1-2 Komponenten, keine
  Hauptmahlzeit-Struktur) ODER Mahlzeit außerhalb der typischen
  Zeitfenster (z.B. 15:30 Kuchen, 22:30 Chips, 02:00 Pizzaresten).

Konflikt-Regel: Wenn Uhrzeit und Komposition widersprechen
(z.B. 09:00 + Currywurst+Pommes), gewinnt die Komposition. Wenn die
Uhrzeit am Rand eines Fensters liegt (10:45, 14:35), gewinnt die
Komposition. "snack" ist nur der Default, wenn weder Uhrzeit noch
Komposition auf eine Hauptmahlzeit zeigen.

MEHRERE BILDER (wenn vorhanden)
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

ALGORITHMUS FÜR DEN NUTZER-HINWEIS (deterministisch)
1. Anteil-Angabe ("⅔ gegessen", "die Hälfte"): skaliere ALLE
   sichtbaren Komponenten mit dem Anteil. source bleibt "vlm". Notiere
   "skaliert mit Hinweis: <faktor>" in notes.
2. Spezifische Menge + Komponentenname ("120g Kuchen", "30g Butter"):
   ersetze die genannte Komponente. food_key/label/grams aus Hinweis.
   source="user_text". Weitere sichtbare Komponenten bleiben "vlm".
3. Vollständig anderes Gericht (MIT oder OHNE Mengenangabe):
   z.B. "Dürüm, Hähnchen" oder "Matcha Latte 300ml". Der Hinweis ist
   autoritativ. ZERLEGE das genannte Gericht gemäß ZERLEGUNGS-REGEL in
   seine typischen Komponenten. Wenn eine Gesamtmenge im Hinweis steht
   (z.B. "300ml"), verteile die Masse auf die Komponenten. Sonst nimm
   typische Portionsgrößen. Setze source="user_text" für ALLE Komponenten.
   Notiere visuellen Konflikt in notes ("Bild zeigt X, Hinweis Y").
4. Hinweis leer oder unklar: ignoriere den Hinweis, nur das Bild zählt.

Bei Konflikt Bild-vs-Hinweis (z.B. Folie verdeckt Inhalt, Bild unklar):
Hinweis gewinnt.

FORMAT-REGELN
- food_key: snake_case, deutsche Wurzeln, ae/oe/ue/ss statt Umlauten.
- label: deutsch, mit Umlauten ok.
- confidence ∈ [0,1].
- rationale: max 10 Wörter, mit visuellem Anker.

Schreibe das JSON direkt. Keine Vorrede.`;

// Appended only when NUTRITION_TOOLS_ENABLED is on. Keeps the no-tool prompt
// stable (so the prompt-assertion tests don't need to know about tools) and
// the tool-loop variant has a minimal additive paragraph at the end —
// drowning the model in tool-usage rules is the surest way to make it call
// the tool 5× for no reason.
const TOOL_PROMPT_APPENDIX = `

TOOL-NUTZUNG (optional)
Wenn du dir bei food_key oder Schreibweise unsicher bist, rufe das Tool
"search_nutrition" mit einem deutschen Suchbegriff auf. Es gibt dir
2-3 Kandidaten aus der Datenbank zurück. Wähle den passendsten
food_key aus den Ergebnissen. Maximal 5 Tool-Aufrufe pro Mahlzeit.
Beispiel: Du siehst Salat-Blätter → suche "Kopfsalat" oder "Romana",
nicht das generische "Salat", das mehrdeutig ist.`;

interface CallOptions {
  temperature: number;
  num_predict?: number;
  num_ctx: number;
}

// num_predict inherits the shared cap from `config.ollamaOptions` (32000) —
// merged in `postOllamaChat`. num_ctx stays VRAM-tuned for vision (8192).
const OPTIONS: CallOptions = {
  temperature: 0.1,
  num_ctx: 8192,
};

const RETRY_OPTIONS: CallOptions = {
  ...OPTIONS,
  temperature: 0.4,
};

/**
 * Agentic-loop budget. Each Ollama round-trip (model emits tool_calls →
 * we dispatch → re-call) counts as one iteration. Empirically the model
 * either resolves in ≤3 calls or starts looping pathologically; 5 leaves
 * generous headroom without letting a runaway loop hold the GPU mutex.
 *
 * Set NUTRITION_TOOLS_ENABLED=1 to opt in to the tool path. Off by default
 * pending validation against the 4-photo probe set; once it ships, flip
 * via env (or change the read below to default-on).
 */
export const MAX_TOOL_ITERATIONS = 5;

function toolsEnabled(): boolean {
  const v = (process.env.NUTRITION_TOOLS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

interface OllamaChatMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
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
  const mealAtLocal = formatBerlinTime(input.job.user_meal_at);
  const useTools = toolsEnabled();

  const start = Date.now();
  const first = useTools
    ? await callClassifyWithTools(model, schema, input.images, hint, mealAtLocal, OPTIONS)
    : await callClassify(model, schema, input.images, hint, mealAtLocal, OPTIONS);
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
  // Retry without the hint AND without the tool loop. The tool loop is a
  // best-effort quality lift; if it failed once, we'd rather get a valid
  // classify back than spend another long minute in the loop. Falling back
  // to the plain prompt-only call is the safest second pass.
  const retry = await callClassify(model, schema, input.images, "", mealAtLocal, RETRY_OPTIONS);
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

interface PostOpts {
  model: string;
  messages: OllamaChatMessage[];
  format?: unknown;
  tools?: ReadonlyArray<unknown>;
  options: CallOptions;
}

interface PostOk {
  ok: true;
  message: NonNullable<OllamaChatResponse["message"]>;
  doneReason?: string;
}
interface PostFail {
  ok: false;
  reason: string;
}

/**
 * POST to /api/chat. Single round-trip, no business logic. Callers handle:
 *   - schema validation of `message.content`
 *   - tool-call dispatch
 *   - retry / fallback decisions
 *
 * Per-call budget is 15 min. qwen3.6 vision + thinking on a cold cache plus a
 * tool round-trip routinely blew the previous 300s window. The single-slot
 * mutex prevents pile-up, so we'd rather wait for a slow generation than fail
 * a legitimate inference. Tool-loop callers can hit this multiple times in
 * sequence; each round-trip has its own 900s window.
 */
async function postOllamaChat(opts: PostOpts): Promise<PostOk | PostFail> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    messages: opts.messages,
    // Merge shared generation defaults (num_predict + top_p + temperature
    // fallback) so the global cap applies even though this site bypasses
    // `callOllama`. Per-call `opts.options` still wins for overrides.
    options: { ...config.ollamaOptions, ...opts.options },
  };
  if (opts.format !== undefined) body.format = opts.format;
  if (opts.tools !== undefined && opts.tools.length > 0) body.tools = opts.tools;

  const url = `${config.ollamaUrl.replace(/\/+$/, "")}/api/chat`;
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      dispatcher: vlmDispatcher,
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `fetch: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, reason: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
  }
  const json = (await res.json()) as OllamaChatResponse;
  if (!json.message) {
    return { ok: false, reason: `empty message (done_reason=${json.done_reason ?? "?"})` };
  }
  return { ok: true, message: json.message, doneReason: json.done_reason };
}

function buildInitialUserMessage(
  images: ClassifyImage[],
  hint: string,
  mealAtLocal: string,
  systemPrompt: string,
): OllamaChatMessage {
  const imageNote = describeImages(images);
  const header = `Zeit: ${mealAtLocal}.`;
  const userContent =
    hint.length > 0
      ? `${header} ${imageNote} Nutzer-Hinweis: "${hint.replace(/"/g, '\\"')}"`
      : `${header} ${imageNote}`;
  const msg: OllamaChatMessage = {
    role: "user",
    content: `${systemPrompt}\n\n${userContent}`,
  };
  if (images.length > 0) msg.images = images.map((img) => img.base64);
  return msg;
}

/**
 * Format a UTC ISO timestamp as a short Berlin-local hint for the prompt,
 * e.g. "Mo 19:05" (weekday + 24h time). Intl.DateTimeFormat handles DST.
 */
function formatBerlinTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unbekannt";
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(d).replace(",", "");
}

async function callClassify(
  model: string,
  schema: unknown,
  images: ClassifyImage[],
  hint: string,
  mealAtLocal: string,
  options: CallOptions,
): Promise<CallOk | CallFail> {
  // Strict JSON-Schema (pydantic-equivalent grammar) is always sent as
  // `format`. Vision + schema works on this stack; the lenient `format:"json"`
  // fallback we used briefly produced outputs missing required scalars
  // (meal_kind) and was the wrong call.
  const initial = buildInitialUserMessage(images, hint, mealAtLocal, SYSTEM_PROMPT);
  const post = await postOllamaChat({
    model,
    messages: [initial],
    format: schema,
    options,
  });
  if (!post.ok) return post;
  const content = post.message.content ?? "";
  if (!content) {
    return {
      ok: false,
      reason: `empty content (done_reason=${post.doneReason ?? "unknown"})`,
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

/**
 * Normalise tool-call arguments. Ollama sometimes returns them as a JSON
 * string (older builds, certain templates) and sometimes as an object.
 * Be liberal in what we accept.
 */
function normaliseToolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return { query: raw };
    }
  }
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  return {};
}

/**
 * Agentic tool-calling variant of `callClassify`. The model may invoke the
 * `search_nutrition` tool up to `MAX_TOOL_ITERATIONS` times before producing
 * a final JSON output. On each iteration we:
 *
 *   1. Send the conversation so far + the JSON schema (`format`) + the
 *      tool definition. `format` is always on — qwen3.6 honours it
 *      alongside `tools` in live tests, and dropping it risks free prose
 *      on the final turn. `tools` is omitted on the LAST iteration so the
 *      model is forced to commit a final answer rather than loop.
 *   2. If the model emits tool_calls: append the assistant message, dispatch
 *      each tool, append role:"tool" results, continue.
 *   3. If the model emits content + no tool_calls: that's our answer —
 *      parse + validate.
 *
 * Exhausting the iteration budget without a final answer is a hard fail —
 * the caller falls back to the plain `callClassify` retry path.
 */
async function callClassifyWithTools(
  model: string,
  schema: unknown,
  images: ClassifyImage[],
  hint: string,
  mealAtLocal: string,
  options: CallOptions,
): Promise<CallOk | CallFail> {
  const promptWithAppendix = SYSTEM_PROMPT + TOOL_PROMPT_APPENDIX;
  const initial = buildInitialUserMessage(images, hint, mealAtLocal, promptWithAppendix);
  const messages: OllamaChatMessage[] = [initial];

  let lastReason = "tool loop never produced content";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    // Strategy: pass `tools` on every iteration so the model can decide,
    // but only pass `format` on the FINAL iteration. On earlier iterations
    // we want the model to be free to either call a tool or emit prose
    // about its decision — clamping with `format` while tools are live
    // is the documented incompatibility. The model is told to emit a
    // schema-conforming JSON when done, and the final iteration enforces
    // it. If we hit the last iteration and the model still wants a tool,
    // we stop accepting tool calls so it's forced to commit.
    const isLastIter = iteration === MAX_TOOL_ITERATIONS - 1;
    const post = await postOllamaChat({
      model,
      messages,
      // Schema is always on for this loop variant — qwen3.6 honours
      // `tools` + `format` together in the live environment (verified
      // 2026-05-18) and dropping the schema risks free-prose output.
      // If a future model breaks this assumption, the env flag turns
      // tools off entirely and the prompt-only path takes over.
      format: schema,
      tools: isLastIter ? undefined : [SEARCH_NUTRITION_TOOL],
      options,
    });
    if (!post.ok) {
      lastReason = post.reason;
      break;
    }
    const msg = post.message;
    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // No tool requested — this is the final answer. Validate + return.
      const content = msg.content ?? "";
      if (!content) {
        lastReason = `empty content (done_reason=${post.doneReason ?? "unknown"})`;
        break;
      }
      try {
        const output = parseAndValidate<ClassifyOutput>(content, schema);
        return { ok: true, output };
      } catch (err) {
        if (err instanceof SchemaValidationError) {
          return { ok: false, reason: `schema: ${err.message}` };
        }
        return {
          ok: false,
          reason: `parse: ${err instanceof Error ? err.message : err}`,
        };
      }
    }

    // Tool calls requested. Append the assistant turn (with the tool_calls
    // intact so the conversation is well-formed), then dispatch each call.
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      if (name !== TOOL_NAMES.SEARCH_NUTRITION) {
        log.warn("nutrition", `classify tool loop: unknown tool ${name}`);
        messages.push({
          role: "tool",
          tool_name: name,
          content: JSON.stringify({ error: `unknown tool: ${name}` }),
        });
        continue;
      }
      const args = normaliseToolArgs(call.function.arguments);
      log.info(
        "nutrition",
        `classify tool loop: search_nutrition(${JSON.stringify(args).slice(0, 120)})`,
      );
      const result = await dispatchSearchNutrition(args);
      messages.push({
        role: "tool",
        tool_name: TOOL_NAMES.SEARCH_NUTRITION,
        content: JSON.stringify(result),
      });
    }
    // Continue → next iteration re-calls Ollama with the extended history.
  }

  return { ok: false, reason: `tool loop exhausted: ${lastReason}` };
}

