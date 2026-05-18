/**
 * morning_insight cluster — extract + deps + key round-trip + schema.
 *
 * The LLM hop in `prose()` is not exercised here (would hit Ollama). We
 * cover the deterministic extract path, the abstain shortcut, schema
 * validation, deps fan-out, the worker-key round-trip, and the registry
 * registration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import Ajv from "ajv";
import addFormats from "ajv-formats";

// Redirect insightsRoot before any runner module loads `config.ts`.
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "pulse-morning-test-"));
process.env.PULSE_ROOT = TMP_ROOT;
process.env.INSIGHTS_ROOT = path.join(TMP_ROOT, "insights");
process.env.GADGETBRIDGE_DB_PATH = path.join(TMP_ROOT, "Gadgetbridge.db");
// pulseDb() guards on existsSync(), so a missing path here means
// `buildMorningPackage` skips the plan/session/pain reads — exactly
// what we want for these tests.
process.env.PULSE_DB_PATH = path.join(TMP_ROOT, "pulse.db.absent");

// ─── Imports after env setup ──────────────────────────────────────────────
const { extract, parseMorningInputFromKey } = await import(
  "../../src/clusters/morning_insight/extract.ts"
);
const { deps } = await import("../../src/clusters/morning_insight/deps.ts");
const schema = (
  await import("../../src/clusters/morning_insight/package.schema.json", {
    with: { type: "json" },
  })
).default as object;
const { CLUSTER_REGISTRY } = await import("../../src/clusters/index.ts");

const PERIOD = "2026-05-15";

const ctx = {
  periodKey: PERIOD,
  tz: "Europe/Berlin",
  settings: {
    readAutoProcess: async () => false,
    readCritic: async () => false,
  },
};

function seedFactsWindow(): void {
  const root = process.env.INSIGHTS_ROOT!;
  // 14-day backwards window so the lever math has enough rows.
  const base = new Date(`${PERIOD}T00:00:00Z`);
  for (let i = 0; i <= 14; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dir = path.join(root, "daily", key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "_facts.json"),
      JSON.stringify({
        period_key: key,
        sleep: {
          metrics: {
            tst_min: 420,
            sleep_efficiency_pct: 90,
            deep_min: 60,
            rem_min: 90,
            bedtime_iso: `${key}T22:30:00Z`,
            wake_iso: `${key}T06:30:00Z`,
            rhr_sleep_bpm: 55,
          },
        },
        cardio: {
          metrics: {
            rhr_day_bpm: 60,
            rhr_sleep_bpm: 55,
            hrv_overnight_ms: 55,
            spo2_mean_pct: 96,
          },
        },
        stress: {
          metrics: {
            stress_mean: 35,
            stress_max: 60,
            high_stress_minutes: 30,
          },
        },
        activity: {
          metrics: {
            steps: 9000,
            active_minutes: 60,
            sedentary_minutes: 600,
          },
        },
      }),
    );
  }
}

function seedSleepInsight(): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", PERIOD);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "sleep_insight.json"),
    JSON.stringify({
      schema_version: "use_case/sleep/v1",
      abstain: false,
      headline: "Erholsame Nacht",
      summary_short: "Schlaf 7h, Effizienz 90%",
      kpis: [
        { id: "sleep_quality", label_de: "Schlafqualität", value: 80, band: "above_usual" },
      ],
    }),
  );
}

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── parseMorningInputFromKey round-trip ─────────────────────────────────
describe("morning_insight.parseMorningInputFromKey", () => {
  it("parses a valid wake-date", () => {
    expect(parseMorningInputFromKey("2026-05-15")).toEqual({ period_key: "2026-05-15" });
  });

  it("rejects malformed keys", () => {
    expect(parseMorningInputFromKey("2026-W21")).toBeNull();
    expect(parseMorningInputFromKey("foo")).toBeNull();
    expect(parseMorningInputFromKey("2026-5-1")).toBeNull();
  });
});

// ── deps fan-out ─────────────────────────────────────────────────────────
describe("morning_insight.deps", () => {
  it("maps day_end on a wake-date to the daily cell", () => {
    const out = deps({
      id: "x",
      kind: "day_end",
      periodKey: PERIOD,
      ts: 0,
      payload: {},
    });
    expect(out).toEqual([
      { cluster: "morning_insight", key: PERIOD, scope: "daily" },
    ]);
  });

  it("maps sleep_complete to the daily cell", () => {
    const out = deps({
      id: "y",
      kind: "sleep_complete",
      periodKey: PERIOD,
      ts: 0,
      payload: {},
    });
    expect(out).toEqual([
      { cluster: "morning_insight", key: PERIOD, scope: "daily" },
    ]);
  });

  it("returns [] for unrelated event kinds", () => {
    const kinds = [
      "workout_complete",
      "manual",
      "meal_logged_pending",
      "meal_classified",
      "meal_edited",
    ] as const;
    for (const kind of kinds) {
      expect(
        deps({ id: "z", kind, periodKey: PERIOD, ts: 0, payload: {} }),
      ).toEqual([]);
    }
  });

  it("returns [] when day_end carries a non-date periodKey", () => {
    expect(
      deps({
        id: "z",
        kind: "day_end",
        periodKey: "2026-W21",
        ts: 0,
        payload: {},
      }),
    ).toEqual([]);
  });
});

// ── extract: abstain when neither facts nor sleep insight exist ─────────
describe("morning_insight.extract — abstain when no facts", () => {
  it("returns abstain=true with reason no_facts when day folder is empty", async () => {
    const pkg = await extract(ctx, { period_key: "2099-01-01" });
    expect(pkg.payload.abstain).toBe(true);
    expect(pkg.payload.abstain_reason).toBe("no_facts");
    expect(pkg.payload.headline).toBeNull();
    expect(pkg.payload.day_shape).toEqual([]);
    expect(pkg.payload.care_for).toEqual([]);
    expect(pkg.payload.levers).toEqual([]);
    expect(pkg.payload.confidence.value).toBe(0);
    expect(pkg.cluster).toBe("morning_insight");
    expect(pkg.key).toBe("2099-01-01");
    expect(pkg.scope).toBe("daily");
    expect(pkg.package_version).toBe(1);
    expect(pkg.provenance.some((p) => p.field_path === "abstain")).toBe(true);
  });
});

// ── extract: full day → deterministic seed payload, LLM fields empty ────
describe("morning_insight.extract — full day", () => {
  beforeAll(() => {
    seedFactsWindow();
    seedSleepInsight();
  });

  it("builds a non-abstain seed payload with empty LLM-fillable fields", async () => {
    const pkg = await extract(ctx, { period_key: PERIOD });
    expect(pkg.payload.abstain).toBe(false);
    expect(pkg.payload.abstain_reason).toBeNull();
    // Verdict band derives deterministically from the facts (RMSSD 55,
    // TST 420 — neutral signals only → null or "steady").
    expect(["above_usual", "steady", "below_usual", null]).toContain(
      pkg.payload.verdict_band,
    );
    // LLM-fillable prose stays empty for prose() to fill.
    expect(pkg.payload.headline).toBeNull();
    expect(pkg.payload.summary_short).toBeNull();
    expect(pkg.payload.summary_long).toBeNull();
    expect(pkg.payload.day_shape).toEqual([]);
    expect(pkg.payload.care_for).toEqual([]);
    expect(pkg.payload.levers).toEqual([]);
    expect(pkg.payload.citations).toEqual([]);
    expect(pkg.payload.confidence.value).toBe(0);
    // Period_key round-trip.
    expect(pkg.payload.period_key).toBe(PERIOD);
    expect(pkg.key).toBe(PERIOD);
    // Provenance carries the deterministic field markers.
    const provFields = pkg.provenance.map((p) => p.field_path).sort();
    expect(provFields).toContain("period_key");
    expect(provFields).toContain("verdict_band");
  });
});

// ── extract: abstain when neither sleep_insight nor recovery_today ──────
describe("morning_insight.extract — abstain when no sleep / recovery", () => {
  it("returns abstain=true with reason no_sleep when only stub facts exist", async () => {
    const altPeriod = "2026-04-01";
    const root = process.env.INSIGHTS_ROOT!;
    const dir = path.join(root, "daily", altPeriod);
    mkdirSync(dir, { recursive: true });
    // Empty facts — no sleep block, no cardio.rhr_day_bpm → data_quality
    // flips both `has_last_night_sleep` and `has_recovery_today` false.
    writeFileSync(path.join(dir, "_facts.json"), JSON.stringify({ period_key: altPeriod }));

    const pkg = await extract(ctx, { period_key: altPeriod });
    expect(pkg.payload.abstain).toBe(true);
    expect(pkg.payload.abstain_reason).toBe("no_sleep");
    expect(pkg.payload.headline).toBeNull();
    expect(pkg.payload.confidence.value).toBe(0);
  });
});

// ── Schema validation ─────────────────────────────────────────────────────
describe("morning_insight — registry + schema", () => {
  it("registers under CLUSTER_REGISTRY", () => {
    expect(CLUSTER_REGISTRY.has("morning_insight")).toBe(true);
    const entry = CLUSTER_REGISTRY.get("morning_insight")!;
    expect(entry.name).toBe("morning_insight");
    expect(typeof entry.extract).toBe("function");
    expect(typeof entry.prose).toBe("function");
    expect(typeof entry.deps).toBe("function");
    expect(entry.payloadSchema).toBeDefined();
  });

  it("a constructed full payload validates against package.schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const sample = {
      schema_version: "use_case/morning/v1",
      incomplete: false,
      language: "de",
      abstain: false,
      abstain_reason: null,
      headline: "Knie schonen, Cardio in Oberkörper-Training tauschen",
      summary_short: "RMSSD 52 ms + 2 Knie-Flags links: Cardio-Slot heute eher nicht.",
      summary_long:
        "Letzte Nacht RMSSD 52 ms und RHR-Drift +6 bpm — die Erholungsbasis ist dünn. Im Knie links liegen 2 Flags der letzten 28 Tage (»leichter Druck nach 2. Satz«). Vorgeschlagen statt Cardio: Tag A (Push-dominant) mit der bekannten RPE-Obergrenze 7.",
      verdict_band: "below_usual",
      training_recommendation: {
        reasoning: "Pain-Lock + Recovery niedrig.",
        suggested_session_template_id: "phase1_a",
        justification_de: "Plan-Slot ist Cardio. RMSSD 52 ms und Knie-Schmerz-Flag.",
        alternatives: ["phase1_b"],
      },
      day_shape: [
        {
          reasoning: "RMSSD niedrig → Spaziergang statt Lauf.",
          anchor: "RMSSD letzte Nacht 52 ms",
          action_de: "Mittagsspaziergang 10 min an der Sonne",
          horizon: "midday",
        },
      ],
      care_for: [
        {
          reasoning: "Recurring pain.",
          area_de: "Knie links",
          why_de: "2 Flags in 28 Tagen, »leichter Druck nach 2. Satz«.",
          action_de: "Impact-Last reduzieren.",
        },
      ],
      levers: [
        {
          reasoning: "Sleep-Midpoint drift kostet Recovery.",
          lever: "sleep_midpoint",
          domain: "sleep",
          confidence: "high",
          trajectory: "Schlaf-Mitte rutscht 30 min nach hinten.",
          projection_90d: "Bei gleichem Drift: 1h später bis September.",
          interpretation: null,
          tiny_next_step: {
            anchor: "Lichter aus 22:30",
            tiny: "Bildschirm 30 min vorher weg",
            horizon: "tonight",
          },
        },
      ],
      citations: [
        { kind: "recovery_metric", ref_id: "rmssd_2026_05_15", summary: "RMSSD 52 ms" },
      ],
      confidence: {
        value: 0.72,
        reasoning: "Dichte Datenlage, alle Signale konsistent.",
      },
      model: "qwen3.6:latest",
      period_key: PERIOD,
    };

    const ok = validate(sample);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(ok).toBe(true);
  });

  it("an abstain payload validates", async () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const pkg = await extract(ctx, { period_key: "2099-12-31" });
    expect(validate(pkg.payload)).toBe(true);
  });

  it("rejects an out-of-range confidence value", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const bad = {
      schema_version: "use_case/morning/v1",
      incomplete: false,
      language: "de",
      abstain: false,
      abstain_reason: null,
      headline: "x",
      summary_short: "y",
      summary_long: "z",
      verdict_band: null,
      training_recommendation: {
        reasoning: "x",
        suggested_session_template_id: null,
        justification_de: null,
        alternatives: [],
      },
      day_shape: [],
      care_for: [],
      levers: [],
      citations: [],
      confidence: { value: 1.5, reasoning: "boom" },
    };
    expect(validate(bad)).toBe(false);
  });
});
