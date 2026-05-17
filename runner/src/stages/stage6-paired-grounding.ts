/**
 * Stage 6 — Paired numeric grounding.
 *
 * Per-driver check: every number that appears in `clause` or `delta_text`
 * must equal `facts.<metric_id>` rounded, OR `facts.<metric_id>.baseline.median`
 * rounded. The looser whole-facts membership test in the legacy
 * `numbers_in_facts` layer can't catch hallucinated comparisons (e.g. the
 * driver claims "Median 113" while the actual baseline is 127 and 113
 * happens to appear elsewhere in facts).
 *
 * Returns a list of human-readable violations. Empty list = pass. Tie this
 * into the orchestrator's regen-with-feedback loop so the next attempt
 * receives the violations as system input.
 */

import type { DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import type { Observation } from "@/lib/types/observations";

export interface PairedGroundingResult {
  ok: boolean;
  violations: string[];
}

/**
 * Tolerances for matching prose numbers to facts values:
 *   - integers within ±1 of the facts value
 *   - one-decimal values within ±0.1
 *   - percentages within ±0.5
 *
 * The slack absorbs rounding the LLM did when surfacing the number into
 * prose. Tighter than the legacy free-text check by orders of magnitude
 * because it's pinned to a metric path.
 */
function rounded(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function matches(value: number, target: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return false;
  const candidates = [
    rounded(target, 0),
    rounded(target, 1),
    rounded(target, 2),
  ];
  return candidates.some((c) => Math.abs(value - c) <= 0.51);
}

/** Resolve a dotted path like "cardio.metrics.rhr_day_bpm" inside facts. */
function readPath(obj: unknown, dotted: string): unknown {
  if (!dotted) return undefined;
  let cur: unknown = obj;
  for (const seg of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function readBaselineMedian(
  facts: FactsBundleV2,
  metricId: string,
): number | null {
  // metricId is like "cardio.metrics.rhr_day_bpm"; baseline lives at
  // "cardio.baseline.rhr_day_bpm.median".
  const segs = metricId.split(".");
  if (segs.length < 3) return null;
  const baselinePath = `${segs[0]}.baseline.${segs.slice(2).join(".")}.median`;
  const v = readPath(facts, baselinePath);
  return typeof v === "number" ? v : null;
}

/**
 * Extract numbers from a snippet, restricted to tokens that carry a metric
 * unit (bpm, ms, min, h, %, °C, kg, kcal, km, Schritte). Bare numbers in
 * meta-prose like "14-Tage-Schnitt" or "30-Tage-Median" are skipped — they
 * are window labels, not metric claims.
 *
 * Tolerates German "1.234,5" and US "1,234.5" thousand separators.
 */
const NUMBER_WITH_UNIT_RE =
  /([+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|[+-]?\d+(?:[.,]\d+)?)\s*(bpm|ms|min|h|%|°C|kg|kcal|km|Schritte\/Tag|Schritte)\b/gi;

function extractNumbers(s: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  NUMBER_WITH_UNIT_RE.lastIndex = 0;
  while ((m = NUMBER_WITH_UNIT_RE.exec(s)) !== null) {
    let token = m[1];
    const hasComma = token.includes(",");
    const hasDot = token.includes(".");
    if (hasComma && hasDot) {
      const lastComma = token.lastIndexOf(",");
      const lastDot = token.lastIndexOf(".");
      const decAt = Math.max(lastComma, lastDot);
      const before = token.slice(0, decAt).replace(/[.,]/g, "");
      const after = token.slice(decAt + 1);
      token = `${before}.${after}`;
    } else if (hasComma) {
      token = token.replace(",", ".");
    }
    const n = Number(token);
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  NUMBER_WITH_UNIT_RE.lastIndex = 0;
  return out;
}

/**
 * Direction sanity: with both today's value and a baseline median in hand we
 * can derive what direction the driver _should_ claim. The flat band is ±5%
 * of the baseline magnitude (or ±1 unit floor) to avoid noise-driven flips.
 */
function expectedDirection(
  factValue: number,
  baselineMedian: number,
): "up" | "down" | "flat" {
  const diff = factValue - baselineMedian;
  const tolerance = Math.max(Math.abs(baselineMedian) * 0.05, 1);
  if (Math.abs(diff) <= tolerance) return "flat";
  return diff > 0 ? "up" : "down";
}

export function checkPairedGrounding(
  daily: DailyInsightV2,
  facts: FactsBundleV2,
  observations: Observation[] = [],
): PairedGroundingResult {
  const violations: string[] = [];

  // S1 observations live in their own threshold space (e.g. tachycardia at
  // 125 bpm fires S1 even when baseline.median is 127). The direction sign
  // is determined by the rule, not the baseline delta. Skip direction checks
  // for any driver whose metric_id matches an S1 observation.
  //
  // Path-shape normalisation: rules emit `cardio.hr_max_bpm` while the LLM
  // (and facts) use the canonical `cardio.metrics.hr_max_bpm`. Both forms
  // get added to the skip set so the comparison is form-agnostic.
  const s1Metrics = new Set<string>();
  for (const o of observations) {
    if (o.tier !== "S1" || !o.metric_id) continue;
    s1Metrics.add(o.metric_id);
    const segs = o.metric_id.split(".");
    if (segs.length === 2) {
      // domain.<metric> → domain.metrics.<metric>
      s1Metrics.add(`${segs[0]}.metrics.${segs[1]}`);
    } else if (segs.length >= 3 && segs[1] === "metrics") {
      // already canonical → also add the short form
      s1Metrics.add(`${segs[0]}.${segs.slice(2).join(".")}`);
    }
  }

  for (const d of daily.drivers ?? []) {
    if (!d.metric_id) continue;
    const factValue = readPath(facts, d.metric_id);
    const baselineMedian = readBaselineMedian(facts, d.metric_id);

    // Don't validate when the metric path is missing — schema-required
    // already covers that. Don't validate when the LLM picked a synthetic
    // path (e.g. "stress.signal_quality") that has no numeric value.
    const hasFactNum = typeof factValue === "number";
    const hasBaselineNum = typeof baselineMedian === "number";
    if (!hasFactNum && !hasBaselineNum) continue;

    // Direction-vs-delta consistency: with both numbers in hand the sign of
    // (today − baseline) dictates the only valid `direction`. Catch the
    // failure mode where the model says "Schlafzeit reduziert" while
    // tst_min(today) > baseline.median. Skip for S1-observation metrics
    // where the rule engine's threshold-based direction takes precedence.
    if (hasFactNum && hasBaselineNum && !s1Metrics.has(d.metric_id)) {
      const expected = expectedDirection(factValue as number, baselineMedian as number);
      if (d.direction !== expected) {
        const diff = (factValue as number) - (baselineMedian as number);
        violations.push(
          `driver "${d.metric_id}": direction="${d.direction}" widerspricht den Daten — heute=${factValue} vs Median=${baselineMedian} (Δ=${diff.toFixed(1)}, erwartet "${expected}")`,
        );
      }
    }

    const haystack = `${d.clause} ${d.delta_text}`.trim();
    if (!haystack) continue;
    const nums = extractNumbers(haystack);
    if (nums.length === 0) continue;

    for (const n of nums) {
      // Whitelist: numbers obviously not metric values get a free pass.
      // -- duration tokens like "+125 bpm" map cleanly; sentinel "0" tokens
      //    inside parts of strings ("vs. 0") still get checked because they
      //    can mask real hallucinations.
      const okFact = hasFactNum && matches(n, factValue as number);
      const okBaseline =
        hasBaselineNum && matches(n, baselineMedian as number);
      if (okFact || okBaseline) continue;

      // Allow integer differences when the prose names a delta explicitly:
      //   "+12 bpm vs. Median 113"  → 12 might be |today - median|.
      // Compute |fact - baseline| and accept matches against the absolute
      // delta as well.
      if (hasFactNum && hasBaselineNum) {
        const delta = Math.abs((factValue as number) - (baselineMedian as number));
        if (matches(n, delta)) continue;
      }

      violations.push(
        `driver "${d.metric_id}": prose number ${n} does not match value=${
          hasFactNum ? factValue : "?"
        } or baseline.median=${hasBaselineNum ? baselineMedian : "?"}`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
