/**
 * invokeLlmForSlot smoke. Uses a stubbed invoker — no Ollama needed.
 *
 * Three flows:
 *   1. Valid first attempt → ok=true after one call.
 *   2. Schema fail → grounding fail → retry succeeds.
 *   3. Both attempts fail → ok=false, attempts length = max.
 */

import { describe, expect, it } from "vitest";
import { invokeLlmForSlot } from "../invoke-llm.ts";
import type { OllamaResult } from "../../../ollama.ts";

const SCHEMA: object = {
  type: "object",
  required: ["schema_version", "kpi"],
  properties: {
    schema_version: { const: "test/v1" },
    kpi: { type: "number" },
    incomplete: { type: "boolean" },
  },
};

const PKG = { value_seen: 42 };

function ollamaResult(content: string): OllamaResult {
  return {
    content,
    totalMs: 100,
    promptTokens: 50,
    evalTokens: 50,
    endpoint: "local",
    endpointUrl: "http://localhost",
  };
}

describe("invokeLlmForSlot", () => {
  it("ok on first attempt with valid grounded output", async () => {
    const result = await invokeLlmForSlot({
      model: "test",
      system_prompt: "sys",
      user_prompt: "user",
      schema: SCHEMA,
      pkg: PKG,
      tag: "test",
      invoker: async () => ollamaResult(JSON.stringify({ schema_version: "test/v1", kpi: 42 })),
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
  });

  it("retries once on validation failure and succeeds", async () => {
    let calls = 0;
    const result = await invokeLlmForSlot({
      model: "test",
      system_prompt: "sys",
      user_prompt: "user",
      schema: SCHEMA,
      pkg: PKG,
      tag: "test",
      max_attempts: 2,
      invoker: async () => {
        calls++;
        if (calls === 1) return ollamaResult(JSON.stringify({ schema_version: "test/v1" })); // missing kpi
        return ollamaResult(JSON.stringify({ schema_version: "test/v1", kpi: 42 }));
      },
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
  });

  it("returns ok=false after exhausting retries", async () => {
    const result = await invokeLlmForSlot({
      model: "test",
      system_prompt: "sys",
      user_prompt: "user",
      schema: SCHEMA,
      pkg: PKG,
      tag: "test",
      max_attempts: 2,
      invoker: async () => ollamaResult(JSON.stringify({ schema_version: "test/v1" })),
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(2);
  });
});
