/**
 * Tests for the agentic tool-calling layer added to Stage A classify.
 *
 * Covers:
 *   - SEARCH_NUTRITION_TOOL JSON schema round-trips through Ajv (it's a
 *     real JSON Schema, not just a string the model sees).
 *   - dispatchSearchNutrition resolves known seed keys.
 *   - dispatchSearchNutrition is robust to USDA / OFF failures and returns
 *     `[]` rather than throwing.
 *   - The tool loop in classify-vlm terminates: model emits a tool call
 *     once, then commits a final JSON.
 *   - The tool loop produces a valid classify output even when the model
 *     never calls a tool (single-iteration straight-through path).
 *
 * Two transports to mock:
 *   - classify-vlm uses `undici.fetch` (long-running inference). We
 *     `vi.mock("undici", ...)` to intercept it.
 *   - dispatchSearchNutrition + USDA/OFF/translate use bare `globalThis.fetch`.
 *     We stub that on each test.
 *
 * Both mocks dispatch off the same scripted reply queue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Ajv from "ajv";

import {
  SEARCH_NUTRITION_TOOL,
  dispatchSearchNutrition,
  parseSearchArgs,
} from "../../src/nutrition/stages/classify-tools.ts";

// Shared reply queue + counter for chat-completion calls. Each test
// rewrites these before invoking classifyMeal. The undici mock and the
// globalThis.fetch stub both consult them.
let scriptedReplies: Array<{ body: Record<string, unknown>; status?: number }> = [];
let chatCalls = 0;
let externalReply: { body: unknown; status?: number } = {
  body: { foods: [], products: [] },
  status: 200,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    Agent: actual.Agent,
    fetch: vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (!url.includes("/api/chat")) {
        return jsonResponse(externalReply.body, externalReply.status ?? 200);
      }
      chatCalls++;
      const reply = scriptedReplies.shift();
      if (!reply) {
        throw new Error(`classify-tools.test: unexpected /api/chat call #${chatCalls}`);
      }
      return jsonResponse(reply.body, reply.status);
    }),
  };
});

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  scriptedReplies = [];
  chatCalls = 0;
  externalReply = { body: { foods: [], products: [] }, status: 200 };
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  vi.restoreAllMocks();
});

// ── Tool schema ────────────────────────────────────────────────────────────

describe("SEARCH_NUTRITION_TOOL schema", () => {
  it("is shaped like an OpenAI/Ollama function tool", () => {
    expect(SEARCH_NUTRITION_TOOL.type).toBe("function");
    expect(SEARCH_NUTRITION_TOOL.function.name).toBe("search_nutrition");
    expect(typeof SEARCH_NUTRITION_TOOL.function.description).toBe("string");
    expect(SEARCH_NUTRITION_TOOL.function.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["query"],
    });
  });

  it("parameters JSON Schema round-trips through Ajv (compiles + accepts well-formed)", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(SEARCH_NUTRITION_TOOL.function.parameters);
    expect(validate({ query: "Kopfsalat" })).toBe(true);
    expect(validate({ query: "Romana", max_results: 3 })).toBe(true);
    expect(validate({})).toBe(false); // missing query
    expect(validate({ query: "" })).toBe(false); // too short
    expect(validate({ query: "x", max_results: 99 })).toBe(false); // out of range
    expect(validate({ query: "x", extra: true })).toBe(false); // additionalProperties
  });
});

// ── parseSearchArgs ────────────────────────────────────────────────────────

describe("parseSearchArgs", () => {
  it("normalises a well-formed object", () => {
    expect(parseSearchArgs({ query: "  Kopfsalat  " })).toEqual({
      query: "Kopfsalat",
      max_results: undefined,
    });
  });

  it("coerces max_results from a string", () => {
    expect(parseSearchArgs({ query: "Joghurt", max_results: "2" })).toEqual({
      query: "Joghurt",
      max_results: 2,
    });
  });

  it("clamps max_results to [1, 5]", () => {
    expect(parseSearchArgs({ query: "x", max_results: 0 })?.max_results).toBe(1);
    expect(parseSearchArgs({ query: "x", max_results: 99 })?.max_results).toBe(5);
  });

  it("returns null on malformed input", () => {
    expect(parseSearchArgs(null)).toBeNull();
    expect(parseSearchArgs("not-an-object")).toBeNull();
    expect(parseSearchArgs({ query: 42 })).toBeNull();
    expect(parseSearchArgs({ query: "   " })).toBeNull();
  });
});

// ── dispatchSearchNutrition (seed path) ────────────────────────────────────

// Stub all off-host fetches (USDA, OFF, translate) so the dispatch tests
// don't time out trying to reach the network in CI.
function stubBareFetchEmpty(): void {
  globalThis.fetch = vi.fn(async () => jsonResponse({ foods: [], products: [] })) as unknown as typeof fetch;
}

describe("dispatchSearchNutrition — seed table", () => {
  beforeEach(() => {
    stubBareFetchEmpty();
  });

  it("returns a known seed key when the query matches", async () => {
    const result = await dispatchSearchNutrition({ query: "Kichererbsen" });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    const first = result.results[0];
    expect(first.source).toBe("seed");
    expect(first.label.toLowerCase()).toContain("kichererbsen");
    expect(first.per100g_summary).toMatch(/kcal/);
    expect(first.food_key).toBe("chickpeas_cooked");
  });

  it("handles a known German label match too", async () => {
    const result = await dispatchSearchNutrition({ query: "Reis" });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0].source).toBe("seed");
  });
});

// ── dispatchSearchNutrition (failure fall-through) ─────────────────────────

describe("dispatchSearchNutrition — no hits", () => {
  it("returns an empty result when nothing matches and external sources fail", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const result = await dispatchSearchNutrition({
      query: "ZZZxxxObskures42Lebensmittel",
    });
    expect(result.results).toEqual([]);
  });

  it("handles invalid args without throwing", async () => {
    stubBareFetchEmpty();
    const result = await dispatchSearchNutrition({ not: "valid" });
    expect(result.results).toEqual([]);
  });
});

// ── Tool loop — classifyMeal integration ───────────────────────────────────

describe("classifyMeal — tool loop", () => {
  beforeEach(() => {
    stubBareFetchEmpty();
    process.env.NUTRITION_TOOLS_ENABLED = "1";
  });

  it("terminates after one tool call → final JSON", async () => {
    scriptedReplies = [
      // Round 1: model wants to search for "Kichererbsen" — a known seed entry.
      {
        body: {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "search_nutrition",
                  arguments: { query: "Kichererbsen" },
                },
              },
            ],
          },
          done_reason: "stop",
        },
      },
      // Round 2: final schema-valid JSON.
      {
        body: {
          message: {
            role: "assistant",
            content: JSON.stringify({
              meal_kind: "lunch",
              components: [
                {
                  label: "Kichererbsen gekocht",
                  food_key: "chickpeas_cooked",
                  grams: 80,
                  confidence: 0.85,
                  rationale: "Tool: Kichererbsen aus Datenbank.",
                  source: "vlm",
                },
              ],
              notes: "Tool-Loop konvergiert.",
            }),
          },
          done_reason: "stop",
        },
      },
    ];

    const { classifyMeal } = await import("../../src/nutrition/stages/classify-vlm.ts");
    const result = await classifyMeal({
      images: [{ base64: "abc", kind: "meal", ord: 0 }],
      job: {
        meal_id: "m1",
        period_key: "2026-05-18",
        user_meal_at: "2026-05-18T12:00:00+02:00",
        user_text: null,
        notes: null,
        photos: [],
      },
    });
    expect(result.output.components.length).toBe(1);
    expect(result.output.components[0].food_key).toBe("chickpeas_cooked");
    expect(result.hintDropped).toBe(false);
    expect(chatCalls).toBe(2);
  });

  it("works when the model never calls a tool (single-shot)", async () => {
    scriptedReplies = [
      {
        body: {
          message: {
            role: "assistant",
            content: JSON.stringify({
              meal_kind: "snack",
              components: [
                {
                  label: "Apfel",
                  food_key: "apfel",
                  grams: 150,
                  confidence: 0.92,
                  rationale: "Direkt erkannt, kein Tool.",
                  source: "vlm",
                },
              ],
              notes: "",
            }),
          },
          done_reason: "stop",
        },
      },
    ];

    const { classifyMeal } = await import("../../src/nutrition/stages/classify-vlm.ts");
    const result = await classifyMeal({
      images: [{ base64: "abc", kind: "meal", ord: 0 }],
      job: {
        meal_id: "m2",
        period_key: "2026-05-18",
        user_meal_at: "2026-05-18T15:00:00+02:00",
        user_text: null,
        notes: null,
        photos: [],
      },
    });
    expect(result.output.components[0].food_key).toBe("apfel");
    expect(chatCalls).toBe(1);
  });

  it("falls back to retry-without-hint when the tool loop never produces content", async () => {
    // 5 tool-call iterations + 1 retry without tools = 6 chat calls.
    const toolCallReply = {
      body: {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "search_nutrition",
                arguments: { query: "Reis" },
              },
            },
          ],
        },
        done_reason: "stop",
      },
    };
    const retrySuccess = {
      body: {
        message: {
          role: "assistant",
          content: JSON.stringify({
            meal_kind: "snack",
            components: [
              {
                label: "Banane",
                food_key: "banane",
                grams: 120,
                confidence: 0.8,
                rationale: "Retry-Pfad ohne Tool.",
                source: "vlm",
              },
            ],
            notes: "",
          }),
        },
        done_reason: "stop",
      },
    };
    scriptedReplies = [
      toolCallReply,
      toolCallReply,
      toolCallReply,
      toolCallReply,
      toolCallReply,
      retrySuccess,
    ];

    const { classifyMeal } = await import("../../src/nutrition/stages/classify-vlm.ts");
    const result = await classifyMeal({
      images: [{ base64: "abc", kind: "meal", ord: 0 }],
      job: {
        meal_id: "m3",
        period_key: "2026-05-18",
        user_meal_at: "2026-05-18T18:00:00+02:00",
        user_text: "Banane",
        notes: null,
        photos: [],
      },
    });
    expect(result.output.components[0].food_key).toBe("banane");
    expect(result.hintDropped).toBe(true);
    expect(chatCalls).toBe(6);
  });

  it("does not invoke the tool loop when NUTRITION_TOOLS_ENABLED is unset", async () => {
    delete process.env.NUTRITION_TOOLS_ENABLED;
    // Sniff the request body via the mock to confirm no `tools` array is sent.
    let sawToolsParam = false;
    const undici = await vi.importActual<typeof import("undici")>("undici");
    void undici;
    // Replace the queue + monkey-patch the assertion via a single reply that
    // also captures the request shape on the fly.
    scriptedReplies = [
      {
        body: {
          message: {
            content: JSON.stringify({
              meal_kind: "lunch",
              components: [
                {
                  label: "Wasser",
                  food_key: "wasser",
                  grams: 250,
                  confidence: 0.9,
                  rationale: "Single-shot path.",
                  source: "vlm",
                },
              ],
              notes: "",
            }),
          },
          done_reason: "stop",
        },
      },
    ];

    // Replace the undici mock for THIS test only so we can inspect the
    // request body. The base mock above doesn't expose init.
    const { fetch: undiciFetch } = await import("undici");
    const fetchMock = vi.mocked(undiciFetch);
    fetchMock.mockImplementationOnce(async (_input: unknown, init?: unknown) => {
      chatCalls++;
      const i = init as { body?: string } | undefined;
      if (i?.body) {
        const parsed = JSON.parse(i.body) as Record<string, unknown>;
        if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
          sawToolsParam = true;
        }
      }
      const reply = scriptedReplies.shift();
      return jsonResponse(reply?.body ?? {}, reply?.status ?? 200);
    });

    const { classifyMeal } = await import("../../src/nutrition/stages/classify-vlm.ts");
    const result = await classifyMeal({
      images: [{ base64: "abc", kind: "meal", ord: 0 }],
      job: {
        meal_id: "m4",
        period_key: "2026-05-18",
        user_meal_at: "2026-05-18T12:00:00+02:00",
        user_text: null,
        notes: null,
        photos: [],
      },
    });
    expect(result.output.components[0].food_key).toBe("wasser");
    expect(sawToolsParam).toBe(false);
    expect(chatCalls).toBe(1);
  });
});
