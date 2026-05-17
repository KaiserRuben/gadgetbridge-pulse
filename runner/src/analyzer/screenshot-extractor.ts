/**
 * Vision LLM caller for Huawei Health body-comp screenshots (Phase 4).
 *
 * Pure function. Given a base64-encoded image (caller is responsible for
 * resizing — see lib/image-resize.ts), asks qwen3.6:latest to extract every
 * visible body-composition measurement as a JSON array of {label, value, unit,
 * confidence}.
 *
 * Locked scope per PROBE_vision.md:
 *   - Verdict SHIP, 5/5 on synthetic Huawei UI, 0 hallucinations on test image.
 *   - Latency 60-93s on this hardware (warm). Caller should pre-resize the
 *     image to long-edge ≤ 640px — full-resolution 974×791 timed out at 120s
 *     during probing.
 *   - Single GPU, sequential — caller must serialise concurrent calls.
 *
 * No I/O at module top level. No file reads. No state. Caller assembles the
 * base64 image and passes it in.
 */

export type ExtractedFieldLabel =
  | "weight"
  | "body_fat_pct"
  | "muscle_pct"
  | "bmi"
  | "water_pct"
  | "bone_mass_kg"
  | "basal_metabolism_kcal";

export type ExtractedConfidence = "high" | "medium" | "low";

export interface ExtractedField {
  label: ExtractedFieldLabel;
  value: number;
  unit: string;
  confidence: ExtractedConfidence;
}

export interface ExtractedScreenshot {
  measurements: ExtractedField[];
}

export interface ExtractScreenshotOptions {
  model?: string;
  ollamaUrl?: string;
  /** Hard timeout per call. Default 120s (vision is slow). */
  timeoutMs?: number;
}

const ALLOWED_LABELS: ReadonlyArray<ExtractedFieldLabel> = [
  "weight",
  "body_fat_pct",
  "muscle_pct",
  "bmi",
  "water_pct",
  "bone_mass_kg",
  "basal_metabolism_kcal",
];

const ALLOWED_LABELS_SET: ReadonlySet<string> = new Set(ALLOWED_LABELS);

const ALLOWED_CONFIDENCES: ReadonlySet<ExtractedConfidence> = new Set([
  "high",
  "medium",
  "low",
]);

/**
 * German prompt — the user's locale and the in-app language of Huawei Health.
 * The locked label whitelist matches `ExtractedFieldLabel`. PROBE found
 * qwen3.6 reliably honours an enum-constrained schema; we still re-validate
 * client-side because schema enforcement at the Ollama layer is
 * post-generation, not generation-time.
 */
const PROMPT = `Dies ist ein Screenshot der Huawei-Health-App, Körperkomposition. Extrahiere alle sichtbaren Messwerte als JSON: {measurements: [{label, value, unit, confidence}]}. Werte nicht erfinden. Bei unsicherem Lesen confidence='low' verwenden. Erlaubte Labels: weight, body_fat_pct, muscle_pct, bmi, water_pct, bone_mass_kg, basal_metabolism_kcal.`;

const SCREENSHOT_SCHEMA = {
  type: "object",
  properties: {
    measurements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", enum: [...ALLOWED_LABELS] },
          value: { type: "number" },
          unit: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["label", "value", "unit", "confidence"],
      },
    },
  },
  required: ["measurements"],
} as const;

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

function parseExtraction(raw: string): ExtractedScreenshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `screenshot-extractor: invalid JSON content from LLM: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("screenshot-extractor: top-level must be an object");
  }
  const obj = parsed as { measurements?: unknown };
  if (!Array.isArray(obj.measurements)) {
    throw new Error("screenshot-extractor: missing measurements array");
  }
  const measurements: ExtractedField[] = [];
  for (const item of obj.measurements) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("screenshot-extractor: measurement entry not an object");
    }
    const m = item as {
      label?: unknown;
      value?: unknown;
      unit?: unknown;
      confidence?: unknown;
    };
    if (typeof m.label !== "string" || !ALLOWED_LABELS_SET.has(m.label)) {
      // Skip unknown labels — schema should have prevented this, but defend.
      continue;
    }
    if (typeof m.value !== "number" || !Number.isFinite(m.value)) {
      throw new Error(
        `screenshot-extractor: measurement.value must be finite number for label '${m.label}'`,
      );
    }
    if (typeof m.unit !== "string") {
      throw new Error(
        `screenshot-extractor: measurement.unit must be string for label '${m.label}'`,
      );
    }
    if (
      typeof m.confidence !== "string" ||
      !ALLOWED_CONFIDENCES.has(m.confidence as ExtractedConfidence)
    ) {
      throw new Error(
        `screenshot-extractor: invalid confidence '${String(m.confidence)}' for label '${m.label}'`,
      );
    }
    measurements.push({
      label: m.label as ExtractedFieldLabel,
      value: m.value,
      unit: m.unit,
      confidence: m.confidence as ExtractedConfidence,
    });
  }
  return { measurements };
}

/**
 * Single Ollama vision chat call. Uses global fetch (Node 22+ / Next runtime).
 * Caps the call at `timeoutMs` (default 120s) via AbortSignal. Single-GPU
 * environment — caller is responsible for serialising concurrent calls.
 *
 * `imageBase64` MUST be the raw base64 (no `data:image/...;base64,` prefix);
 * the route handler strips the prefix before calling.
 */
export async function extractScreenshot(
  imageBase64: string,
  opts: ExtractScreenshotOptions = {},
): Promise<ExtractedScreenshot> {
  const model = opts.model ?? "qwen3.6:latest";
  const ollamaUrl =
    opts.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  // NOTE: This analyzer cannot use the shared `callOllama` wrapper because
  // the wrapper does not (yet) support the `images` field on the user
  // message — required for vision input. We still drop the `think: false`
  // flag here so we benefit from the schema-enforcement fix uniformly:
  // empirically `think: false` on qwen3.6 silently bypasses the `format`
  // grammar engine (verified 2026-05-16). Once the wrapper grows image
  // support, migrate this call too.
  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "user",
        content: PROMPT,
        images: [imageBase64],
      },
    ],
    format: SCREENSHOT_SCHEMA,
    options: {
      temperature: 0.1,
      num_ctx: 8192,
      num_predict: 1024,
    },
  };

  const url = `${ollamaUrl}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("AbortError") || msg.includes("timeout")) {
      throw new Error(`screenshot-extractor: Ollama timeout after ${timeoutMs}ms`);
    }
    throw new Error(`screenshot-extractor: fetch failed: ${msg}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `screenshot-extractor: Ollama HTTP ${res.status}: ${txt.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as OllamaChatResponse;
  const content = json.message?.content ?? "";
  if (!content) {
    throw new Error(
      `screenshot-extractor: empty content (done_reason=${json.done_reason ?? "unknown"})`,
    );
  }
  return parseExtraction(content);
}

export const ALLOWED_SCREENSHOT_LABELS = ALLOWED_LABELS;
