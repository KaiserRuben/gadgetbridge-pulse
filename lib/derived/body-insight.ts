/**
 * Deterministic body insight composer (Phase U3).
 *
 * The body domain has no LLM-backed cluster runner-side (`body_insight`
 * is intentionally deferred). To give the page parity with the other
 * domain detail surfaces — i.e. a single `<InsightSection>` at the top
 * — we compose a minimal `SleepInsightV3`-shaped object from the body
 * facts-bundle metrics already loaded server-side.
 *
 * Rules:
 *  - Insufficient data (<3 weight points) → `abstain` insight with a
 *    clear reason. InsightSection then renders the "Wenig Signal" stub.
 *  - Otherwise: headline + summary derive from 7d weight + body-fat
 *    deltas; KPIs are weight (latest), body-fat % (latest), and BMI
 *    (latest), each with a band computed from 30d trend direction.
 *  - Confidence scales with data density: 0.9 at >=14 points, 0.7 at
 *    >=7, 0.5 below.
 *
 * Output is a `SleepInsightV3`-typed object because the consumer
 * `<InsightSection>` accepts `AnyInsight`, and we just need a shape
 * that satisfies its render contract. The `schema_version` claim is
 * cosmetic — InsightSection does not read it. The page passes the
 * result directly via the legacy `insight` prop; no cluster lookup.
 */

import type { SleepInsightV3, KpiItem, Band } from "@/lib/types/v3";

export interface BodyTrendInput {
  /** 30d series (oldest→newest), with null gaps preserved. */
  weightKg: (number | null)[];
  bodyFatPct: (number | null)[];
  bmi: (number | null)[];
  skinTempMedian: (number | null)[];
  skinTempDelta: (number | null)[];
}

/**
 * Compose a deterministic body insight from up to 30 days of body
 * facts. Returns `null` when the input has fewer than 3 weight points
 * (the page falls back to its own empty state) or a fully-populated
 * `SleepInsightV3`-shaped abstain / ready insight otherwise.
 */
export function composeBodyInsight(input: BodyTrendInput): SleepInsightV3 {
  const weights = compact(input.weightKg);
  const bodyFats = compact(input.bodyFatPct);
  const bmis = compact(input.bmi);
  const skinTemps = compact(input.skinTempMedian);

  // ── Abstain when we don't have enough weight points to compute a trend.
  if (weights.length < 3) {
    return {
      schema_version: "use_case/sleep/v1",
      language: "de",
      abstain: true,
      abstain_reason:
        "Zu wenige Gewichts-Messungen für einen Trend. Trag dein Gewicht häufiger ein, um Verläufe zu sehen.",
      headline: null,
      summary_short: null,
      summary_long: null,
      analysis_today: null,
      analysis_context: null,
      suggestions_today: [],
      suggestions_long_term: [],
      kpis: [],
      confidence: {
        reasoning: "Datenfenster zu schmal — Trendaussage nicht möglich.",
        value: 0.3,
      },
    };
  }

  const latestWeight = weights[weights.length - 1];
  const latestBodyFat = bodyFats[bodyFats.length - 1] ?? null;
  const latestBmi = bmis[bmis.length - 1] ?? null;

  const weight7d = trailingDelta(weights, 7);
  const weight14d = trailingDelta(weights, 14);
  const bodyFat7d = trailingDelta(bodyFats, 7);

  const dataDensity = weights.length;
  const confidenceValue =
    dataDensity >= 14 ? 0.9 : dataDensity >= 7 ? 0.7 : 0.5;

  const headline = buildHeadline(latestWeight, weight7d);
  const summary = buildSummary(weight7d, weight14d, bodyFat7d, skinTemps);

  const kpis: KpiItem[] = [];

  kpis.push({
    id: "weight_latest",
    label_de: "Gewicht",
    value: round1(latestWeight),
    band: bandForWeightDelta(weight7d),
    reasoning:
      weight7d != null
        ? `Letzte 7 Tage: ${signed1(weight7d)} kg.`
        : "Nur ein Messpunkt im 7-Tage-Fenster — keine Trendaussage.",
  });

  if (latestBodyFat != null) {
    kpis.push({
      id: "body_fat_pct",
      label_de: "Körperfett",
      value: round1(latestBodyFat),
      band: bandForBodyFatDelta(bodyFat7d),
      reasoning:
        bodyFat7d != null
          ? `Letzte 7 Tage: ${signed1(bodyFat7d)} %.`
          : "Zu wenige Körperfett-Messungen für 7-Tage-Trend.",
    });
  }

  if (latestBmi != null) {
    kpis.push({
      id: "bmi",
      label_de: "BMI",
      value: round1(latestBmi),
      band: bandForBmi(latestBmi),
      reasoning: bmiInterpretation(latestBmi),
    });
  }

  return {
    schema_version: "use_case/sleep/v1",
    language: "de",
    abstain: false,
    abstain_reason: null,
    headline,
    summary_short: null,
    summary_long: summary,
    analysis_today: null,
    analysis_context: null,
    suggestions_today: [],
    suggestions_long_term: [],
    kpis,
    confidence: {
      reasoning: `Berechnet aus ${dataDensity} Gewichtsmessungen.`,
      value: confidenceValue,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function compact(series: (number | null)[]): number[] {
  return series.filter((v): v is number => v != null);
}

/**
 * Return `last - last-N-back` from a compacted series. Returns null when
 * we don't have at least N+1 points within the trailing window.
 */
function trailingDelta(series: number[], n: number): number | null {
  if (series.length < 2) return null;
  if (series.length <= n) {
    // Not enough back-history for a full N-day delta; fall back to "since
    // first observation in window" as a best-effort.
    return series[series.length - 1] - series[0];
  }
  return series[series.length - 1] - series[series.length - 1 - n];
}

function buildHeadline(latest: number, weight7d: number | null): string {
  const lat = round1(latest);
  if (weight7d == null) return `${lat} kg aktuell.`;
  if (Math.abs(weight7d) < 0.2) return `${lat} kg — stabil über 7 Tage.`;
  const arrow = weight7d < 0 ? "−" : "+";
  return `${lat} kg (${arrow}${Math.abs(round1(weight7d))} kg in 7 Tagen).`;
}

function buildSummary(
  weight7d: number | null,
  weight14d: number | null,
  bodyFat7d: number | null,
  skinTemps: number[],
): string | null {
  const parts: string[] = [];
  if (weight7d != null && weight14d != null) {
    const dir7 = weight7d < -0.2 ? "abnehmend" : weight7d > 0.2 ? "zunehmend" : "stabil";
    const dir14 = weight14d < -0.4 ? "abnehmend" : weight14d > 0.4 ? "zunehmend" : "stabil";
    if (dir7 === dir14) {
      parts.push(`Gewicht ${dir7} über 7 und 14 Tage.`);
    } else {
      parts.push(`Gewicht 7d ${dir7}, 14d ${dir14} — Trend in Bewegung.`);
    }
  }
  if (bodyFat7d != null && Math.abs(bodyFat7d) >= 0.3) {
    parts.push(`Körperfett ${signed1(bodyFat7d)} % in 7 Tagen.`);
  }
  if (skinTemps.length >= 7) {
    const avg = skinTemps.reduce((s, v) => s + v, 0) / skinTemps.length;
    const last = skinTemps[skinTemps.length - 1];
    const diff = last - avg;
    if (Math.abs(diff) >= 0.3) {
      parts.push(
        `Hauttemperatur ${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} °C vs. 30-Tage-Mittel.`,
      );
    }
  }
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function bandForWeightDelta(delta7d: number | null): Band {
  if (delta7d == null) return "steady";
  // Anything bigger than 0.5 kg in a week is a non-trivial move.
  if (delta7d <= -0.5) return "below_usual";
  if (delta7d >= 0.5) return "above_usual";
  return "steady";
}

function bandForBodyFatDelta(delta7d: number | null): Band {
  if (delta7d == null) return "steady";
  if (delta7d <= -0.3) return "below_usual";
  if (delta7d >= 0.3) return "above_usual";
  return "steady";
}

function bandForBmi(bmi: number): Band {
  if (bmi < 18.5) return "below_usual";
  if (bmi > 25) return "above_usual";
  return "steady";
}

function bmiInterpretation(bmi: number): string {
  if (bmi < 18.5) return "BMI im Untergewicht-Bereich.";
  if (bmi < 25) return "BMI im Normalbereich.";
  if (bmi < 30) return "BMI im Übergewicht-Bereich.";
  return "BMI im Adipositas-Bereich.";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function signed1(n: number): string {
  const r = round1(n);
  if (r === 0) return "±0.0";
  return r > 0 ? `+${r.toFixed(1)}` : `−${Math.abs(r).toFixed(1)}`;
}
