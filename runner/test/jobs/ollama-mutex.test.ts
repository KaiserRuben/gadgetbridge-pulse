/**
 * Global GPU slot: two parallel callOllama invocations serialise so the
 * underlying POST never overlaps. We mock undici's fetch and observe the
 * concurrent-in-flight count across both calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let inFlight = 0;
let maxInFlight = 0;

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    Agent: actual.Agent,
    fetch: vi.fn(async () => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      try {
        // Simulate enough latency that two concurrent callers would overlap
        // if the mutex were missing.
        await new Promise((r) => setTimeout(r, 50));
        return new Response(
          JSON.stringify({
            message: { content: "ok", thinking: "" },
            total_duration: 50_000_000,
            prompt_eval_count: 10,
            eval_count: 5,
            done_reason: "stop",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      } finally {
        inFlight--;
      }
    }),
  };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
  // Ensure no Redis path is taken — the lock helper short-circuits when
  // REDIS_URL is empty.
  delete process.env.REDIS_URL;
  vi.resetModules();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  vi.restoreAllMocks();
});

describe("callOllama global mutex", () => {
  it("serialises concurrent calls (maxInFlight <= 1)", async () => {
    const { callOllama } = await import("../../src/ollama.ts");
    const make = () =>
      callOllama({
        model: "test",
        system: "s",
        user: "u",
        format: { type: "object" },
        tag: "mutex-test",
      });
    const [a, b, c] = await Promise.all([make(), make(), make()]);
    expect(a.content).toBe("ok");
    expect(b.content).toBe("ok");
    expect(c.content).toBe("ok");
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });
});
