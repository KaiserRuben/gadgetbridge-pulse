/**
 * Client behaviour: bearer auth header, status mapping, no-op when disabled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PULSE_INGEST_BASE_URL = "http://test.invalid";
  process.env.PULSE_INGEST_TOKEN = "secret";
  process.env.PULSE_INGEST_OUTBOX_PATH = ":memory:";
  vi.resetModules();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  vi.restoreAllMocks();
});

describe("ingest client", () => {
  it("attaches Bearer token + idempotency-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { pushBundle } = await import("../client.ts");

    const r = await pushBundle({
      periodKey: "2026-05-11",
      status: "complete",
      stages: [{ name: "x" }],
    });
    expect(r.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("http://test.invalid/api/ingest/bundle");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret");
    expect(headers["idempotency-key"]).toMatch(/^bundle\|2026-05-11/);
  });

  it("returns ok queued=true on HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { pushFacts } = await import("../client.ts");

    const r = await pushFacts({
      periodKey: "2026-05-11",
      status: "live",
      payload: { a: 1 },
    });
    expect(r.ok).toBe(false);
    expect(r.queued).toBe(true);
    expect(r.status).toBe(503);
  });
});
