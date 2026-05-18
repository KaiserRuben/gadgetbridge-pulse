/**
 * Tests for Phase U3 domain unification. Covers the deterministic
 * core of the body insight composer, plus content-grep assertions
 * against the heart / stress / activity / body pages and the central
 * "Tag läuft" copy sites that U3 swept into the shared
 * `<EmptyStateCard cause="computing">` primitive.
 *
 * The grep assertions intentionally treat the page sources as
 * regression fixtures — they protect against accidental re-introduction
 * of the old bespoke helpers (`HeartCoachInsights`,
 * `pickStressCoachingCard`, `KiHints`) and the old prose ("Tag läuft
 * noch …"). When U3's contract genuinely needs to evolve, update the
 * fixtures here and the production code in lockstep.
 *
 * Imports cross the dashboard ↔ runner boundary via relative paths to
 * match the alias setup used by the other dashboard-side tests.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeBodyInsight } from "../../../lib/derived/body-insight.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");

function readPage(rel: string): string {
  return readFileSync(path.join(REPO, rel), "utf8");
}

describe("Phase U3: bespoke local helpers were dropped", () => {
  it("heart/[date]/page.tsx no longer exports HeartCoachInsights / pickBestHeartCard", () => {
    const src = readPage("app/(app)/heart/[date]/page.tsx");
    expect(src).not.toContain("function HeartCoachInsights");
    expect(src).not.toContain("function pickBestHeartCard");
  });

  it("stress/[date]/page.tsx no longer exports pickStressCoachingCard / pickStressDrivers / isStressy", () => {
    const src = readPage("app/(app)/stress/[date]/page.tsx");
    expect(src).not.toContain("function pickStressCoachingCard");
    expect(src).not.toContain("function pickStressDrivers");
    expect(src).not.toContain("function isStressy");
  });

  it("activity/[date]/page.tsx no longer defines the KiHints helper", () => {
    const src = readPage("app/(app)/activity/[date]/page.tsx");
    expect(src).not.toContain("function KiHints");
    // The "KI" / "KI-Hinweise" Section eyebrow shouldn't ride alongside
    // <InsightSection> any more — InsightSection IS the KI surface.
    expect(src).not.toContain('eyebrow="KI"');
  });

  it("each page that previously had a bespoke coach block now uses <InsightSection>", () => {
    for (const rel of [
      "app/(app)/heart/[date]/page.tsx",
      "app/(app)/stress/[date]/page.tsx",
      "app/(app)/body/[date]/page.tsx",
      "app/(app)/activity/[date]/page.tsx",
    ]) {
      const src = readPage(rel);
      expect(src, rel).toContain("<InsightSection");
    }
  });
});

describe('Phase U3: "Tag läuft" prose was swept into <EmptyStateCard cause="computing">', () => {
  const PROSE_SITES = [
    "components/domain/hero-v3.tsx",
    "app/(app)/activity/[date]/page.tsx",
    "app/(app)/nutrition/[date]/page.tsx",
    "app/(app)/(home)/page.tsx",
  ];

  it.each(PROSE_SITES)('%s no longer contains "Tag läuft" prose', (rel) => {
    const src = readPage(rel);
    // Tolerate JSX comments that reference the historic copy by checking
    // for the exact German phrase only.
    expect(src).not.toContain("Tag läuft noch");
    expect(src).not.toContain("Tag läuft</Pill>");
  });

  it("hero-v3 routes the live (no synthesis, no day_score) branch through EmptyStateCard", () => {
    const src = readPage("components/domain/hero-v3.tsx");
    expect(src).toContain("EmptyStateCard");
    expect(src).toContain('cause="computing"');
  });

  it("home page catch-up banner routes through EmptyStateCard", () => {
    const src = readPage("app/(app)/(home)/page.tsx");
    expect(src).toContain("showCatchupBanner");
    // The new banner uses the shared primitive with explicit copy.
    expect(src).toMatch(/<EmptyStateCard\s+cause="computing"/);
  });
});

describe("Phase U3: home page collapses SynthesisCell duplication", () => {
  it("the home page renders SynthesisCell once with responsive=true", () => {
    const src = readPage("app/(app)/(home)/page.tsx");
    // There should be exactly one `<SynthesisCell` in the home page.
    const occurrences = src.match(/<SynthesisCell\b/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(src).toContain("responsive");
  });

  it("the home page hides the mode-debug panel behind ?debug=1", () => {
    const src = readPage("app/(app)/(home)/page.tsx");
    expect(src).toContain("debugMode");
    expect(src).toContain('sp.debug === "1"');
  });

  it("the recent-workouts section is always rendered (no length>0 conditional)", () => {
    const src = readPage("app/(app)/(home)/page.tsx");
    // No `recentWorkouts.length > 0 &&` guard wrapping the section.
    expect(src).not.toMatch(/\{recentWorkouts\.length > 0 &&\s*\(\s*<Section/);
    // Empty branch routes through the shared primitive.
    expect(src).toContain('cause="no_data"');
  });
});

describe("composeBodyInsight: insufficient data", () => {
  it("abstains when fewer than 3 weight points are available", () => {
    const insight = composeBodyInsight({
      weightKg: [80.2, null, 80.5, null],
      bodyFatPct: [null, null, null, null],
      bmi: [null, null, null, null],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(true);
    expect(insight.abstain_reason).toMatch(/Gewichts/);
    expect(insight.kpis).toEqual([]);
  });

  it("abstains for an entirely empty input", () => {
    const insight = composeBodyInsight({
      weightKg: [],
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(true);
  });
});

describe("composeBodyInsight: weight trend", () => {
  function densify(weights: number[]): (number | null)[] {
    return weights;
  }

  it("flags a downward trend as below_usual on the weight KPI", () => {
    // 14 days, steady drop of 0.5kg/week.
    const series = Array.from({ length: 14 }, (_, i) => 81 - i * (1 / 7));
    const insight = composeBodyInsight({
      weightKg: densify(series),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(false);
    expect(insight.kpis.length).toBeGreaterThan(0);
    const weightKpi = insight.kpis.find((k) => k.id === "weight_latest");
    expect(weightKpi).toBeDefined();
    expect(weightKpi?.band).toBe("below_usual");
  });

  it("flags a flat trend as steady on the weight KPI", () => {
    const series = Array.from({ length: 10 }, () => 80);
    const insight = composeBodyInsight({
      weightKg: densify(series),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(false);
    const weightKpi = insight.kpis.find((k) => k.id === "weight_latest");
    expect(weightKpi?.band).toBe("steady");
  });

  it("flags an upward trend as above_usual on the weight KPI", () => {
    // 14 days, +0.7kg/week.
    const series = Array.from({ length: 14 }, (_, i) => 78 + i * (0.7 / 7));
    const insight = composeBodyInsight({
      weightKg: densify(series),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(false);
    const weightKpi = insight.kpis.find((k) => k.id === "weight_latest");
    expect(weightKpi?.band).toBe("above_usual");
  });

  it("scales confidence with data density", () => {
    const sparse = composeBodyInsight({
      weightKg: [80, 80.2, 80.1, 80.3],
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    const medium = composeBodyInsight({
      weightKg: Array.from({ length: 7 }, (_, i) => 80 + i * 0.05),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    const dense = composeBodyInsight({
      weightKg: Array.from({ length: 14 }, (_, i) => 80 + i * 0.05),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(sparse.confidence.value).toBeLessThan(medium.confidence.value);
    expect(medium.confidence.value).toBeLessThanOrEqual(dense.confidence.value);
    expect(dense.confidence.value).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });
});

describe("composeBodyInsight: optional KPIs", () => {
  it("includes a body-fat KPI when bodyFatPct has a latest value", () => {
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 7 }, () => 80),
      bodyFatPct: [20.1, null, 20.0, null, 19.9, null, 19.8],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.abstain).toBe(false);
    const bf = insight.kpis.find((k) => k.id === "body_fat_pct");
    expect(bf).toBeDefined();
    expect(bf?.value).toBe(19.8);
  });

  it("includes a BMI KPI with the expected band", () => {
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 7 }, () => 80),
      bodyFatPct: [],
      bmi: [22, 22.1, 22.2, 22.3, 22.4, 22.5, 22.6],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    const bmi = insight.kpis.find((k) => k.id === "bmi");
    expect(bmi).toBeDefined();
    expect(bmi?.band).toBe("steady");
  });

  it("BMI >25 lands in above_usual", () => {
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 7 }, () => 92),
      bodyFatPct: [],
      bmi: [26, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.kpis.find((k) => k.id === "bmi")?.band).toBe("above_usual");
  });

  it("BMI <18.5 lands in below_usual", () => {
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 7 }, () => 55),
      bodyFatPct: [],
      bmi: [18, 17.9, 17.8, 17.9, 17.8, 17.7, 17.6],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.kpis.find((k) => k.id === "bmi")?.band).toBe("below_usual");
  });
});

describe("composeBodyInsight: headline + summary", () => {
  it("emits a 'stabil' headline when 7d weight delta is below the noise floor", () => {
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 14 }, () => 80.1),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.headline).toMatch(/stabil/);
  });

  it("emits a directional headline when 7d delta exceeds the noise floor", () => {
    const series = [80.5, 80.4, 80.3, 80.2, 80.1, 80.0, 79.9, 79.8];
    const insight = composeBodyInsight({
      weightKg: series,
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: [],
      skinTempDelta: [],
    });
    expect(insight.headline).toMatch(/79\.8 kg/);
    expect(insight.headline).toMatch(/−|kg in 7 Tagen/);
  });

  it("summary mentions hauttemperatur when it deviates from the 30d mean", () => {
    // Mean is ~35.5°C, last point pushed to 36.1 → diff ≥ 0.3.
    const skin = [
      35.4, 35.5, 35.4, 35.5, 35.4, 35.5, 35.4, 35.5, 35.4, 35.5, 35.4, 35.5,
      35.4, 35.5, 36.1,
    ];
    const insight = composeBodyInsight({
      weightKg: Array.from({ length: 14 }, () => 80),
      bodyFatPct: [],
      bmi: [],
      skinTempMedian: skin,
      skinTempDelta: [],
    });
    expect(insight.summary_long ?? "").toMatch(/Hauttemperatur/);
  });
});
