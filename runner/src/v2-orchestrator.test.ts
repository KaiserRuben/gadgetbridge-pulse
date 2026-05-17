/**
 * End-to-end test for the v2 orchestrator.
 *
 * Runs the full 7-stage pipeline against the live SQLite database in
 * `--dry-run` mode (no atomic write). `callOllama` is mocked to always
 * reject so Stage 4 deterministically exhausts retries and emits the
 * abstain payload — keeps the test offline and fast.
 *
 * Verifies that:
 *   - the pipeline completes without throwing
 *   - facts validates against `facts.schema.json`
 *   - the produced daily.json validates against `daily.schema.json`
 *   - all 5 verifier layers fire and the critical ones pass
 *
 * The test is skipped if the DB does not exist on the runner host.
 */

import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";

vi.mock("./ollama.ts", () => ({
  callOllama: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (test mock)")),
}));

import { config } from "./config.ts";
import { latestSnapshotDate } from "./period.ts";
import { runDaily } from "./v2-orchestrator.ts";

const dbAvailable = existsSync(config.dbPath);

describe.runIf(dbAvailable)("v2 orchestrator (e2e dry-run, Ollama mocked)", () => {
  it("produces a valid abstaining daily.json end-to-end when LLM is unreachable", async () => {
    const periodKey = latestSnapshotDate();
    // The orchestrator now auto-degrades to live-only when the day is not
    // complete (isDayComplete checks against wall-clock today). We need the
    // full LLM pipeline to assert the abstain path, so force the full run.
    const result = await runDaily(periodKey, {
      dryRun: true,
      force: true,
      currentLocalTime: `${periodKey}T18:00:00`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Pipeline status: ok / partial / abstained. With force=true the full
    // 7-stage path runs; Ollama mock makes Stage 4 abstain.
    expect(["ok", "partial", "abstained"]).toContain(result.bundle.pipeline_status);

    // With Ollama mocked to fail, stage 4 must fall back to abstain.
    expect(result.daily.abstain).toBe(true);
    expect(result.daily.schema_version).toBe("daily/v2");
    expect(result.daily.headline).toBeNull();
    expect(result.daily.summary).toBeNull();
    expect(result.daily.drivers).toEqual([]);
    expect(result.daily.abstain_reason).toBe("llm_schema_fail");

    // Verifier — both critical layers must pass.
    const ajv = result.verify.layers.find((l) => l.name === "ajv");
    const math = result.verify.layers.find((l) => l.name === "confidence_math");
    expect(ajv?.ok).toBe(true);
    expect(math?.ok).toBe(true);

    // All verifier layers fire in the documented order.
    const names = result.verify.layers.map((l) => l.name);
    expect(names).toEqual([
      "ajv",
      "confidence_math",
      "numbers_in_facts",
      "claim_id_linkage",
      "paired_grounding",
      "confidence_calibration",
      "forbidden_patterns",
    ]);

    // Bundle has stage timings recorded.
    expect(Object.keys(result.bundle.timings)).toContain("stage0_facts");
    expect(Object.keys(result.bundle.timings)).toContain("stage1_rules");
    expect(Object.keys(result.bundle.timings)).toContain("stage6_verify");

    // Facts contract: schema_version + period_key match.
    expect(result.facts.schema_version).toMatch(/^facts\/v2(\.\d+)?$/);
    expect(result.facts.period_key).toBe(periodKey);
  }, 30000);
});
