/**
 * synthesis_v3 cluster — extract + deps + key round-trip + schema.
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
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "pulse-synthesis-test-"));
process.env.PULSE_ROOT = TMP_ROOT;
process.env.INSIGHTS_ROOT = path.join(TMP_ROOT, "insights");
process.env.GADGETBRIDGE_DB_PATH = path.join(TMP_ROOT, "Gadgetbridge.db");
// pulseDb() guards on existsSync(); a missing path means the synthesis
// extract has no DB-side reads to worry about (it only reads JSON from
// `$INSIGHTS_ROOT`).
process.env.PULSE_DB_PATH = path.join(TMP_ROOT, "pulse.db.absent");

// ─── Imports after env setup ──────────────────────────────────────────────
const { extract, parseSynthesisInputFromKey } = await import(
  "../../src/clusters/synthesis_v3/extract.ts"
);
const { deps } = await import("../../src/clusters/synthesis_v3/deps.ts");
const schema = (
  await import("../../src/clusters/synthesis_v3/package.schema.json", {
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

function seedFactsAndDayScore(period: string): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", period);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "_facts.json"),
    JSON.stringify({
      period_key: period,
      sleep: {
        metrics: {
          tst_min: 420,
          sleep_efficiency_pct: 90,
          rmssd_ms: 55,
          rhr_sleep_bpm: 55,
        },
      },
      cardio: { metrics: { rhr_day_bpm: 60 } },
      stress: { metrics: { stress_mean: 35 } },
      activity: { metrics: { steps: 9000, active_minutes: 60 } },
    }),
  );
  writeFileSync(
    path.join(dir, "day_score.json"),
    JSON.stringify({
      value: 72,
      band: "above_usual",
      contributions: {},
      weight_used: 1,
      reasoning: "Solide Basis (sleep+activity).",
    }),
  );
}

function seedSleepInsight(period: string, abstain = false): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", period);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "sleep_insight.json"),
    JSON.stringify({
      schema_version: "use_case/sleep/v1",
      abstain,
      headline: "Erholsame Nacht",
      summary_short: "Schlaf 7h, Effizienz 90%",
      kpis: [
        { id: "sleep_quality", label_de: "Schlafqualität", value: 80, band: "above_usual" },
      ],
      confidence: { value: 0.8, reasoning: "starke Datenlage" },
    }),
  );
}

function seedRecoveryInsight(period: string, abstain = false): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", period);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "recovery_insight.json"),
    JSON.stringify({
      schema_version: "use_case/recovery/v1",
      abstain,
      headline: "Erholung solide",
      kpis: [
        { id: "autonomic_balance", label_de: "Autonomes Gleichgewicht", value: 70, band: "above_usual" },
      ],
      confidence: { value: 0.7, reasoning: "RMSSD im Korridor" },
    }),
  );
}

function seedActivityInsight(period: string, abstain = false): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", period);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "activity_insight.json"),
    JSON.stringify({
      schema_version: "use_case/activity/v1",
      abstain,
      headline: "Solide Bewegung",
      kpis: [
        { id: "volume_load", label_de: "Volumen-Last", value: 55, band: "steady" },
      ],
      confidence: { value: 0.6, reasoning: "9000 Schritte, 60 min aktiv" },
    }),
  );
}

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── parseSynthesisInputFromKey round-trip ───────────────────────────────
describe("synthesis_v3.parseSynthesisInputFromKey", () => {
  it("parses a valid wake-date", () => {
    expect(parseSynthesisInputFromKey("2026-05-15")).toEqual({
      period_key: "2026-05-15",
    });
  });

  it("rejects malformed keys", () => {
    expect(parseSynthesisInputFromKey("2026-W21")).toBeNull();
    expect(parseSynthesisInputFromKey("foo")).toBeNull();
    expect(parseSynthesisInputFromKey("2026-5-1")).toBeNull();
    expect(parseSynthesisInputFromKey("")).toBeNull();
  });
});

// ── deps fan-out ─────────────────────────────────────────────────────────
describe("synthesis_v3.deps", () => {
  it("maps day_end on a wake-date to the daily cell", () => {
    const out = deps({
      id: "x",
      kind: "day_end",
      periodKey: PERIOD,
      ts: 0,
      payload: {},
    });
    expect(out).toEqual([
      { cluster: "synthesis_v3", key: PERIOD, scope: "daily" },
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
      { cluster: "synthesis_v3", key: PERIOD, scope: "daily" },
    ]);
  });

  it("maps workout_complete to the daily cell", () => {
    const out = deps({
      id: "w",
      kind: "workout_complete",
      periodKey: PERIOD,
      ts: 0,
      payload: {},
    });
    expect(out).toEqual([
      { cluster: "synthesis_v3", key: PERIOD, scope: "daily" },
    ]);
  });

  it("returns [] for unrelated event kinds", () => {
    const kinds = [
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

// ── extract: abstain when no facts ───────────────────────────────────────
describe("synthesis_v3.extract — abstain when no facts", () => {
  it("returns abstain=true with reason no_facts when day folder is empty", async () => {
    const pkg = await extract(ctx, { period_key: "2099-01-01" });
    expect(pkg.payload.abstain).toBe(true);
    expect(pkg.payload.abstain_reason).toBe("no_facts");
    expect(pkg.payload.headline).toBeNull();
    expect(pkg.payload.top_action_today).toBeNull();
    expect(pkg.payload.domain_pointers).toEqual([]);
    expect(pkg.payload.contradictions).toEqual([]);
    expect(pkg.payload.confidence.value).toBe(0);
    expect(pkg.cluster).toBe("synthesis_v3");
    expect(pkg.key).toBe("2099-01-01");
    expect(pkg.scope).toBe("daily");
    expect(pkg.package_version).toBe(1);
    expect(pkg.provenance.some((p) => p.field_path === "abstain")).toBe(true);
  });
});

// ── extract: abstain when no prerequisite insights ──────────────────────
describe("synthesis_v3.extract — abstain when no sleep", () => {
  it("returns abstain=true with reason no_sleep when only recovery exists", async () => {
    const alt = "2026-04-01";
    seedFactsAndDayScore(alt);
    seedRecoveryInsight(alt);
    // No sleep or activity insight — only 1 use-case is OK → abstain.
    const pkg = await extract(ctx, { period_key: alt });
    expect(pkg.payload.abstain).toBe(true);
    // The first missing branch is sleep → reason "no_sleep".
    expect(pkg.payload.abstain_reason).toBe("no_sleep");
    expect(pkg.payload.confidence.value).toBe(0);
  });
});

describe("synthesis_v3.extract — abstain when no signal at all", () => {
  it("returns abstain=true with reason no_signal when all three insights missing", async () => {
    const alt = "2026-04-02";
    seedFactsAndDayScore(alt);
    // No insights at all.
    const pkg = await extract(ctx, { period_key: alt });
    expect(pkg.payload.abstain).toBe(true);
    expect(pkg.payload.abstain_reason).toBe("no_signal");
  });
});

// ── extract: full day → deterministic seed payload ──────────────────────
describe("synthesis_v3.extract — full day", () => {
  beforeAll(() => {
    seedFactsAndDayScore(PERIOD);
    seedSleepInsight(PERIOD);
    seedRecoveryInsight(PERIOD);
    seedActivityInsight(PERIOD);
  });

  it("builds a non-abstain seed payload with empty LLM-fillable fields", async () => {
    const pkg = await extract(ctx, { period_key: PERIOD });
    expect(pkg.payload.abstain).toBe(false);
    expect(pkg.payload.abstain_reason).toBeNull();
    // Verdict band is seeded from the day-score's deterministic band.
    expect(pkg.payload.verdict_band).toBe("above_usual");
    // LLM-fillable prose stays empty for prose() to fill.
    expect(pkg.payload.headline).toBeNull();
    expect(pkg.payload.summary_short).toBeNull();
    expect(pkg.payload.summary_long).toBeNull();
    expect(pkg.payload.key_insight).toBeNull();
    expect(pkg.payload.top_action_today).toBeNull();
    expect(pkg.payload.domain_pointers).toEqual([]);
    expect(pkg.payload.contradictions).toEqual([]);
    // Confidence seed from data density (3 insights → 0.7).
    expect(pkg.payload.confidence.value).toBeGreaterThan(0);
    expect(pkg.payload.confidence.value).toBeLessThanOrEqual(1);
    // Period_key round-trip.
    expect(pkg.payload.period_key).toBe(PERIOD);
    expect(pkg.key).toBe(PERIOD);
    // Provenance carries the deterministic field markers.
    const provFields = pkg.provenance.map((p) => p.field_path).sort();
    expect(provFields).toContain("period_key");
    expect(provFields).toContain("verdict_band");
    expect(provFields).toContain("confidence.value");
  });
});

// ── Schema validation ─────────────────────────────────────────────────────
describe("synthesis_v3 — registry + schema", () => {
  it("registers under CLUSTER_REGISTRY", () => {
    expect(CLUSTER_REGISTRY.has("synthesis_v3")).toBe(true);
    const entry = CLUSTER_REGISTRY.get("synthesis_v3")!;
    expect(entry.name).toBe("synthesis_v3");
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
      schema_version: "use_case/synthesis/v1",
      language: "de",
      incomplete: false,
      abstain: false,
      abstain_reason: null,
      verdict_band: "above_usual",
      headline: "Solider Tag — Schlaf hält Linie",
      summary_short: "TST 420 min, Effizienz 90%, autonomes Gleichgewicht 70.",
      summary_long:
        "Mit TST 420 min und Effizienz 90% liefert die Nacht eine stabile Basis; autonomes Gleichgewicht 70 stützt die Erholung im Korridor.",
      key_insight:
        "Schlafqualität 80 (above_usual) zusammen mit autonomem Gleichgewicht 70 erklärt das hohe Tagesfenster.",
      top_action_today: {
        reasoning:
          "Bewegung ist solide, Erholung gut — leichter Ausdauer-Slot stützt die Trajektorie ohne Last zu drücken.",
        source_domain: "cross_domain",
        anchor: "Mittagslicht",
        tiny: "20 min lockerer Spaziergang an der Sonne",
        why: "Nutzt die gute Erholung, ohne Schlafqualität zu gefährden.",
        horizon: "today",
      },
      domain_pointers: [
        {
          reasoning:
            "Schlafqualität ist der stabilste Wert (80, above_usual) und dominiert das Tagesurteil.",
          domain: "sleep",
          label_de: "Schlafqualität",
          kpi_id: "sleep_quality",
          kpi_value: 80,
          kpi_band: "above_usual",
          callout: "Effizienz 90%, TST 420 min — solide Nacht.",
        },
        {
          reasoning:
            "Autonomes Gleichgewicht 70 zeigt gute Tonus-Verteilung — Tagespuffer für Belastung vorhanden.",
          domain: "recovery",
          label_de: "Autonomes Gleichgewicht",
          kpi_id: "autonomic_balance",
          kpi_value: 70,
          kpi_band: "above_usual",
          callout: "RMSSD 55 ms, RHR-Drift moderat.",
        },
        {
          reasoning:
            "Volumen-Last 55 ist mittig — kein Übertrainings-Signal, kein Ruhetag.",
          domain: "activity",
          label_de: "Volumen-Last",
          kpi_id: "volume_load",
          kpi_value: 55,
          kpi_band: "steady",
          callout: "9000 Schritte, 60 min aktiv — Korridor.",
        },
      ],
      contradictions: [],
      confidence: {
        value: 0.72,
        reasoning: "Drei Domains konsistent, kein Konflikt.",
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
      schema_version: "use_case/synthesis/v1",
      language: "de",
      incomplete: false,
      abstain: false,
      abstain_reason: null,
      verdict_band: "steady",
      headline: "x",
      summary_short: "y",
      summary_long: "z",
      key_insight: "k",
      top_action_today: null,
      domain_pointers: [],
      contradictions: [],
      confidence: { value: 1.5, reasoning: "boom — confidence sprengt die 1.0-Grenze" },
    };
    expect(validate(bad)).toBe(false);
  });
});
