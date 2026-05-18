/**
 * Settings: per-cluster wins over global; cache TTL; default false.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  readAutoProcessSetting,
  readCriticEnabled,
} from "../../src/jobs/settings.ts";
import { makeTestDb, type TestDbHandle } from "./_helpers.ts";

let h: TestDbHandle;

function setKv(key: string, value: unknown): void {
  h.db.prepare(
    `INSERT INTO PULSE_STATE_KV (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

beforeEach(() => {
  h = makeTestDb();
  vi.useRealTimers();
});

afterEach(() => {
  h.close();
  vi.useRealTimers();
});

describe("readAutoProcessSetting", () => {
  it("defaults to false when neither key is set", async () => {
    expect(await readAutoProcessSetting("sleep")).toBe(false);
  });

  it("returns the global value when only global is set", async () => {
    setKv("settings:auto_process", true);
    expect(await readAutoProcessSetting("sleep")).toBe(true);
  });

  it("per-cluster wins over global", async () => {
    setKv("settings:auto_process", true);
    setKv("settings:auto_process:activity", false);
    expect(await readAutoProcessSetting("activity")).toBe(false);
    expect(await readAutoProcessSetting("sleep")).toBe(true);
  });

  it("uses CLUSTER_AUTO_DEFAULTS when neither override is set", async () => {
    // OQ-5 defaults — anomaly_explain/morning_insight/weekly_recap/
    // synthesis_v3 are ON by default; unrelated clusters stay OFF.
    expect(await readAutoProcessSetting("synthesis_v3")).toBe(true);
    expect(await readAutoProcessSetting("morning_insight")).toBe(true);
    expect(await readAutoProcessSetting("weekly_recap")).toBe(true);
    expect(await readAutoProcessSetting("anomaly_explain")).toBe(true);
    expect(await readAutoProcessSetting("sleep_insight")).toBe(false);
  });

  it("global=false beats CLUSTER_AUTO_DEFAULTS=true", async () => {
    // The user explicitly disabled the global master switch — the runner
    // must honor that even for clusters whose default is ON.
    setKv("settings:auto_process", false);
    expect(await readAutoProcessSetting("synthesis_v3")).toBe(false);
  });

  it("caches the result for ~60s", async () => {
    setKv("settings:auto_process", false);
    expect(await readAutoProcessSetting("recovery")).toBe(false);
    // Flip the underlying value; cache must still return the old answer.
    setKv("settings:auto_process", true);
    expect(await readAutoProcessSetting("recovery")).toBe(false);
    // Fast-forward the wall clock past the TTL and verify the next read
    // sees the new value. vi.useFakeTimers manipulates Date.now() under the hood.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date(Date.now() + 61_000));
    expect(await readAutoProcessSetting("recovery")).toBe(true);
  });
});

describe("readCriticEnabled", () => {
  it("defaults to false", async () => {
    expect(await readCriticEnabled()).toBe(false);
  });

  it("respects the configured value", async () => {
    setKv("settings:critic_model", true);
    expect(await readCriticEnabled()).toBe(true);
  });
});
