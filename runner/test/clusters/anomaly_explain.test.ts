/**
 * anomaly_explain cluster — extract + deps + key round-trip + schema.
 *
 * The LLM hop in `prose()` is mocked at the explainAnomaly module level so
 * tests don't hit Ollama. extract() reads from the on-disk insight tree;
 * we redirect that to a temp dir via INSIGHTS_ROOT before importing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import Ajv from "ajv";
import addFormats from "ajv-formats";

// Redirect insightsRoot before any runner module loads `config.ts`.
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "pulse-anomaly-test-"));
process.env.PULSE_ROOT = TMP_ROOT;
process.env.INSIGHTS_ROOT = path.join(TMP_ROOT, "insights");
// Keep `assertDbExists` happy if any transitive import touches it.
process.env.GADGETBRIDGE_DB_PATH = path.join(TMP_ROOT, "Gadgetbridge.db");

// ─── Imports after env setup ──────────────────────────────────────────────
const { extract, parseAnomalyInputFromKey } = await import(
  "../../src/clusters/anomaly_explain/extract.ts"
);
const { deps } = await import("../../src/clusters/anomaly_explain/deps.ts");
const schema = (await import("../../src/clusters/anomaly_explain/package.schema.json", {
  with: { type: "json" },
})).default as object;
const { CLUSTER_REGISTRY } = await import("../../src/clusters/index.ts");

const PERIOD = "2026-05-15";

function seedFactsWindow(): void {
  const root = process.env.INSIGHTS_ROOT!;
  // Seed 7 days of trivial _facts.json — content not material for these tests.
  const base = new Date(`${PERIOD}T00:00:00Z`);
  for (let i = 0; i <= 6; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dir = path.join(root, "daily", key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "_facts.json"), JSON.stringify({ stub: true, day: key }));
  }
}

function seedDailyJson(): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", PERIOD);
  mkdirSync(dir, { recursive: true });
  const daily = {
    drivers: [
      {
        clause: "Ruhepuls erhöht",
        delta_text: "+8 bpm",
        evidence_ids: ["obs_rhr_up_2026_05_15"],
      },
    ],
  };
  writeFileSync(path.join(dir, "daily.json"), JSON.stringify(daily));
}

beforeAll(() => {
  seedFactsWindow();
  seedDailyJson();
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const ctx = {
  periodKey: PERIOD,
  tz: "Europe/Berlin",
  settings: {
    readAutoProcess: async () => false,
    readCritic: async () => false,
  },
};

describe("anomaly_explain.parseAnomalyInputFromKey", () => {
  it("parses spike keys round-trip", () => {
    const input = parseAnomalyInputFromKey("manual_hr_1731676800000");
    expect(input).toEqual({ metric: "hr", ts_ms: 1731676800000 });
  });

  it("parses driver keys (plain observation_id)", () => {
    const input = parseAnomalyInputFromKey("obs_rhr_up_2026_05_15");
    expect(input).toEqual({ observation_id: "obs_rhr_up_2026_05_15" });
  });

  it("rejects unknown shapes", () => {
    expect(parseAnomalyInputFromKey("!!nope!!")).toBeNull();
  });

  it("does not classify a 'manual_'-prefixed key as a driver", () => {
    // Bad spike key (unknown metric) — should not silently fall through to
    // driver mode just because the regex for driver_id was permissive.
    expect(parseAnomalyInputFromKey("manual_unknown_123")).toBeNull();
  });
});

describe("anomaly_explain.deps", () => {
  it("returns empty array for every event kind", () => {
    const kinds = [
      "sleep_complete",
      "workout_complete",
      "day_end",
      "manual",
      "meal_logged_pending",
      "meal_classified",
      "meal_edited",
    ] as const;
    for (const kind of kinds) {
      const out = deps({
        id: "x",
        kind,
        periodKey: PERIOD,
        ts: 0,
        payload: {},
      });
      expect(out).toEqual([]);
    }
  });
});

describe("anomaly_explain.extract — driver mode", () => {
  it("builds a package with the observation clause from daily.json", async () => {
    const pkg = await extract(ctx, { observation_id: "obs_rhr_up_2026_05_15" });
    expect(pkg.cluster).toBe("anomaly_explain");
    expect(pkg.key).toBe("obs_rhr_up_2026_05_15");
    expect(pkg.scope).toBe("daily");
    expect(pkg.payload.context.mode).toBe("driver");
    expect(pkg.payload.context.observation_text).toContain("Ruhepuls erhöht");
    expect(pkg.payload.context.observation_text).toContain("+8 bpm");
    expect(pkg.payload.context.facts_window_size).toBe(7);
    expect(pkg.payload.hypotheses).toEqual([]);
    expect(pkg.provenance).toEqual([
      { field_path: "context.observation_text", source: "rule_computed" },
    ]);
    expect(pkg.deps).toEqual([]);
    expect(pkg.package_version).toBe(1);
  });

  it("throws when the observation_id is not in daily.json", async () => {
    await expect(
      extract(ctx, { observation_id: "obs_does_not_exist" }),
    ).rejects.toThrow(/not found in daily.json/);
  });
});

describe("anomaly_explain.extract — spike mode", () => {
  it("builds a package with mode=spike + key encoding metric+ts", async () => {
    // The runner's `db.ts` performs a `statSync` at first call — we mock the
    // module so extract takes the spo2 branch without needing a real DB.
    vi.doMock("../../src/db.ts", () => {
      const stmt = {
        all: () => [{ ts: 1731676800, spo2: 92 }],
        get: () => undefined,
      };
      const db = { prepare: () => stmt };
      return { db: () => db };
    });
    vi.resetModules();
    const { extract: freshExtract } = await import(
      "../../src/clusters/anomaly_explain/extract.ts"
    );

    const ts = 1731676800000;
    const pkg = await freshExtract(ctx, { metric: "spo2", ts_ms: ts });

    expect(pkg.key).toBe(`manual_spo2_${ts}`);
    expect(pkg.payload.observation_id).toBe(`manual_spo2_${ts}`);
    expect(pkg.payload.context.mode).toBe("spike");
    expect(pkg.payload.context.metric).toBe("spo2");
    expect(pkg.payload.context.ts_ms).toBe(ts);
    expect(pkg.payload.hypotheses).toEqual([]);
    expect(pkg.provenance).toEqual([
      { field_path: "context.observation_text", source: "wearable_sensor" },
    ]);
    vi.doUnmock("../../src/db.ts");
  });
});

describe("anomaly_explain — registry + schema", () => {
  it("registers under CLUSTER_REGISTRY", () => {
    expect(CLUSTER_REGISTRY.has("anomaly_explain")).toBe(true);
    const entry = CLUSTER_REGISTRY.get("anomaly_explain")!;
    expect(entry.name).toBe("anomaly_explain");
    expect(typeof entry.extract).toBe("function");
    expect(typeof entry.prose).toBe("function");
    expect(typeof entry.deps).toBe("function");
    expect(entry.payloadSchema).toBeDefined();
  });

  it("a constructed payload validates against package.schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const sample = {
      observation_id: "obs_x",
      period_key: "2026-05-15",
      context: {
        mode: "driver",
        observation_text: "Ruhepuls erhöht (+8 bpm)",
        facts_window_size: 7,
      },
      hypotheses: [
        {
          factor: "Späte Mahlzeit",
          strength: "moderate",
          rationale: "Letztes Essen um 22:30 (vs. 19:00 im Mittel)",
        },
      ],
      model: "qwen3.6:latest",
    };

    const ok = validate(sample);
    if (!ok) {
      // Surface diagnostics so failure messages are actionable.
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(ok).toBe(true);
  });

  it("rejects invalid strength labels", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const bad = {
      observation_id: "obs_x",
      period_key: "2026-05-15",
      context: {
        mode: "spike",
        observation_text: "irrelevant",
        facts_window_size: 1,
      },
      hypotheses: [
        { factor: "x", strength: "high", rationale: "y" }, // "high" not in enum
      ],
    };
    expect(validate(bad)).toBe(false);
  });
});
