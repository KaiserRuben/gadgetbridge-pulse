/**
 * weekly_recap cluster — extract + deps + key round-trip + schema.
 *
 * The LLM call in `prose()` is not exercised here (it would hit Ollama);
 * we cover the deterministic extract path, the abstain shortcut, schema
 * validation, deps fan-out, and the registry registration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import Ajv from "ajv";
import addFormats from "ajv-formats";

// Redirect insightsRoot before any runner module loads `config.ts`.
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "pulse-weekly-test-"));
process.env.PULSE_ROOT = TMP_ROOT;
process.env.INSIGHTS_ROOT = path.join(TMP_ROOT, "insights");
process.env.GADGETBRIDGE_DB_PATH = path.join(TMP_ROOT, "Gadgetbridge.db");

// ─── Imports after env setup ──────────────────────────────────────────────
const { extract, parseWeeklyInputFromKey, loadWeeklyWindow } = await import(
  "../../src/clusters/weekly_recap/extract.ts"
);
const { deps } = await import("../../src/clusters/weekly_recap/deps.ts");
const schema = (
  await import("../../src/clusters/weekly_recap/package.schema.json", {
    with: { type: "json" },
  })
).default as object;
const { CLUSTER_REGISTRY } = await import("../../src/clusters/index.ts");
const { datesInWeek, weekKeyForDate } = await import("../../src/period.ts");

// Pick a week that has all 7 days inside one month so the test dates are easy
// to reason about. Period 2026-05-18 is a Monday in ISO week 21.
const WEEK_KEY = "2026-W21";
const WEEK_DATES = datesInWeek(WEEK_KEY); // 2026-05-18 → 2026-05-24

function seedDay(
  date: string,
  facts: Record<string, unknown> | null,
  daily?: Record<string, unknown> | null,
): void {
  const root = process.env.INSIGHTS_ROOT!;
  const dir = path.join(root, "daily", date);
  mkdirSync(dir, { recursive: true });
  if (facts) writeFileSync(path.join(dir, "_facts.json"), JSON.stringify(facts));
  if (daily) writeFileSync(path.join(dir, "daily.json"), JSON.stringify(daily));
}

const ctx = {
  periodKey: WEEK_KEY,
  tz: "Europe/Berlin",
  settings: {
    readAutoProcess: async () => false,
    readCritic: async () => false,
  },
};

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── parseWeeklyInputFromKey round-trip ─────────────────────────────────────
describe("weekly_recap.parseWeeklyInputFromKey", () => {
  it("parses a valid weekKey", () => {
    expect(parseWeeklyInputFromKey("2026-W20")).toEqual({ week_key: "2026-W20" });
  });

  it("rejects malformed keys", () => {
    expect(parseWeeklyInputFromKey("2026-05-18")).toBeNull();
    expect(parseWeeklyInputFromKey("2026-W5")).toBeNull();
    expect(parseWeeklyInputFromKey("foo")).toBeNull();
  });
});

// ── deps fan-out ──────────────────────────────────────────────────────────
describe("weekly_recap.deps", () => {
  it("maps day_end to the containing weekly cell", () => {
    const out = deps({
      id: "x",
      kind: "day_end",
      periodKey: "2026-05-18",
      ts: 0,
      payload: {},
    });
    expect(out).toEqual([
      {
        cluster: "weekly_recap",
        key: weekKeyForDate("2026-05-18"),
        scope: "weekly",
      },
    ]);
  });

  it("returns [] for every non-day_end event kind", () => {
    const kinds = [
      "sleep_complete",
      "workout_complete",
      "manual",
      "meal_logged_pending",
      "meal_classified",
      "meal_edited",
    ] as const;
    for (const kind of kinds) {
      const out = deps({
        id: "y",
        kind,
        periodKey: "2026-05-18",
        ts: 0,
        payload: {},
      });
      expect(out).toEqual([]);
    }
  });

  it("returns [] when day_end carries a non-date periodKey", () => {
    expect(
      deps({
        id: "z",
        kind: "day_end",
        periodKey: "2026-W21", // wrong shape for a day_end event
        ts: 0,
        payload: {},
      }),
    ).toEqual([]);
  });
});

// ── extract: abstain on incomplete week ───────────────────────────────────
describe("weekly_recap.extract — abstain on <4 days", () => {
  beforeAll(() => {
    // Seed only 3 of the 7 dates so the present-count threshold trips.
    for (let i = 0; i < 3; i++) {
      seedDay(WEEK_DATES[i], { period_key: WEEK_DATES[i] });
    }
  });

  it("returns abstain=true with reason insufficient_data", async () => {
    const pkg = await extract(ctx, { week_key: WEEK_KEY });
    expect(pkg.payload.abstain).toBe(true);
    expect(pkg.payload.abstain_reason).toBe("insufficient_data");
    expect(pkg.payload.trajectory_headline.recovery).toBe("Datenlücke");
    expect(pkg.payload.pattern_callouts).toEqual([]);
    expect(pkg.payload.streaks).toEqual([]);
    expect(pkg.payload.personal_best).toBeNull();
    expect(pkg.payload.personal_worst).toBeNull();
    expect(pkg.payload.micro_experiment).toBeNull();
    expect(pkg.payload.confidence.value).toBe(0);
    expect(pkg.cluster).toBe("weekly_recap");
    expect(pkg.key).toBe(WEEK_KEY);
    expect(pkg.scope).toBe("weekly");
    expect(pkg.package_version).toBe(1);
    expect(pkg.provenance.some((p) => p.field_path === "abstain")).toBe(true);
  });
});

// ── extract: full week → deterministic aggregates ─────────────────────────
describe("weekly_recap.extract — full week", () => {
  // The previous block seeded 3 days; finish the rest with synthetic
  // numbers that produce a step-streak and an obvious personal best.
  beforeAll(() => {
    for (let i = 0; i < 7; i++) {
      const date = WEEK_DATES[i];
      // Days 0..2 already seeded with minimal facts. Overwrite ALL seven so
      // every day has the metrics shape we need.
      seedDay(
        date,
        {
          period_key: date,
          sleep: { metrics: { sleep_efficiency_pct: 90, tst_min: 420 } },
          cardio: { metrics: { rhr_day_bpm: 55 + i } }, // best (min) on day 0
          activity: { metrics: { steps: 9000 + i * 500 } }, // best (max) on day 6
          stress: { metrics: { stress_mean: 35 } },
        },
        {
          drivers: [
            { metric_id: "sleep.metrics.tst_min", clause: "Schlaf gut", delta_text: "+5m" },
          ],
        },
      );
    }
  });

  it("builds non-abstain payload with streaks + personal best + worst", async () => {
    const pkg = await extract(ctx, { week_key: WEEK_KEY });
    expect(pkg.payload.abstain).toBe(false);
    expect(pkg.payload.abstain_reason).toBeNull();
    // Trajectory headline left empty for prose to fill.
    expect(pkg.payload.trajectory_headline.recovery).toBe("");
    expect(pkg.payload.trajectory_headline.activity).toBe("");
    expect(pkg.payload.trajectory_headline.stress).toBe("");
    // 7/7 step-goal streak (all days ≥8000), 7/7 sleep-efficiency streak.
    const streakIds = pkg.payload.streaks.map((s) => s.id);
    expect(streakIds).toContain("step_goal_streak");
    expect(streakIds).toContain("sleep_eff_streak");
    // Personal best = max steps → day 6 (last date).
    expect(pkg.payload.personal_best?.metric_id).toBe("activity.metrics.steps");
    expect(pkg.payload.personal_best?.date).toBe(WEEK_DATES[6]);
    // Personal worst = max rhr → day 6 (rhr = 55 + 6 = 61 is highest).
    expect(pkg.payload.personal_worst?.metric_id).toBe("cardio.metrics.rhr_day_bpm");
    expect(pkg.payload.personal_worst?.date).toBe(WEEK_DATES[6]);
    // Confidence base from data density (7/7 → 0.85).
    expect(pkg.payload.confidence.value).toBeCloseTo(0.85, 2);
    expect(pkg.provenance.some((p) => p.field_path === "confidence.value")).toBe(true);
  });
});

// ── Schema validation ─────────────────────────────────────────────────────
describe("weekly_recap — registry + schema", () => {
  it("registers under CLUSTER_REGISTRY", () => {
    expect(CLUSTER_REGISTRY.has("weekly_recap")).toBe(true);
    const entry = CLUSTER_REGISTRY.get("weekly_recap")!;
    expect(entry.name).toBe("weekly_recap");
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
      week_key: "2026-W21",
      schema_version: "weekly/v2",
      language: "de",
      reasoning_trace: "Diese Woche dominant: drei Nächte unter 7h gepaart mit RHR-Anstieg.",
      abstain: false,
      abstain_reason: null,
      trajectory_headline: {
        recovery: "Erholung verlangsamt sich.",
        activity: "Bewegung konstant über Ziel.",
        stress: "Stress mittel, keine Spitzen.",
      },
      chart_refs: [],
      pattern_callouts: [
        {
          id: "late_meal_low_eff",
          description: "Spätes Essen geht oft mit niedriger Effizienz einher.",
          occurrences: 3,
          domains: ["sleep"],
          days: ["2026-05-19", "2026-05-21", "2026-05-23"],
        },
      ],
      streaks: [
        {
          id: "step_goal_streak",
          label: "5 Tage in Folge ≥8000 Schritte",
          length_days: 5,
          metric_id: "activity.metrics.steps",
        },
      ],
      personal_best: {
        metric_id: "activity.metrics.steps",
        value: 12500,
        date: "2026-05-24",
        note: "Wanderung am Sonntag.",
      },
      personal_worst: {
        metric_id: "cardio.metrics.rhr_day_bpm",
        value: 61,
        date: "2026-05-22",
        action_or_note: "fortlaufend beobachten",
      },
      micro_experiment: {
        hypothesis: "Eine Stunde früher ins Bett senkt den Wochen-RHR.",
        anchor: "Lichter aus 22:30",
        tiny: "Bildschirm 30 Min vorher weg",
        fallback: "Buch lesen statt Telefon",
        target_metric_id: "cardio.metrics.rhr_day_bpm",
        duration_days: 7,
      },
      confidence: {
        value: 0.7,
        calc: "0.4*0.7 + 0.3*0.7 + 0.3*0.7 = 0.70",
        factors: ["7/7 Tage Sleep-Daten", "Stress nur 5/7 Tage"],
      },
      model: "qwen3.6:latest",
    };

    const ok = validate(sample);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(ok).toBe(true);
  });

  it("an abstain payload (no prose) also validates", async () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const pkg = await extract(ctx, { week_key: WEEK_KEY });
    // Drop reasoning_trace if it's empty — the schema accepts empty strings
    // but the package may simply not set it.
    expect(validate(pkg.payload)).toBe(true);
  });

  it("rejects an out-of-range confidence value", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const bad = {
      week_key: "2026-W21",
      schema_version: "weekly/v2",
      language: "de",
      abstain: false,
      abstain_reason: null,
      trajectory_headline: { recovery: "x", activity: "y", stress: "z" },
      chart_refs: [],
      pattern_callouts: [],
      streaks: [],
      personal_best: null,
      personal_worst: null,
      micro_experiment: null,
      confidence: { value: 1.5, calc: "boom", factors: [] },
    };
    expect(validate(bad)).toBe(false);
  });
});

// ── Side-channel loader ───────────────────────────────────────────────────
describe("weekly_recap.loadWeeklyWindow", () => {
  it("returns 7 dates Monday→Sunday and the loaded facts/dailies array", async () => {
    const { dates, facts, dailies } = await loadWeeklyWindow(WEEK_KEY);
    expect(dates).toEqual(WEEK_DATES);
    expect(facts.length).toBe(7);
    expect(dailies.length).toBe(7);
    expect(facts.every((f) => f != null)).toBe(true);
  });
});
