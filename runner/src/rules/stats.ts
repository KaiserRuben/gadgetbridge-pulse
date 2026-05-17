/**
 * Pure statistical helpers used by the rule engine.
 *
 * Design choices (locked):
 * - Median + MAD over mean + SD: robust to outliers, single bad night does
 *   not flip the baseline. (See e.g. Rousseeuw & Croux 1993.)
 * - Mann–Kendall + Theil–Sen for trend detection: distribution-free, robust
 *   to non-normal residuals typical of physiological time series.
 * - HRV log-transform: lnRMSSD = ln(RMSSD) per Plews 2014 (working with the
 *   log-normal distribution gives stable per-person variance).
 *
 * All functions are pure, deterministic, and side-effect free.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Drop NaN / non-finite values; nulls are filtered upstream. */
function clean(xs: readonly number[]): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  }
  return out;
}

/**
 * Drop nulls from a `(number | null)[]` and return a plain number[].
 * Convenience used heavily by domain runners reading history buffers.
 */
export function compact(xs: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Median / MAD / robust z
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Median of a numeric array. Returns NaN for empty input — callers must
 * check `isFinite` before using the result.
 */
export function median(xs: readonly number[]): number {
  const a = clean(xs);
  const n = a.length;
  if (n === 0) return NaN;
  const sorted = [...a].sort((p, q) => p - q);
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median Absolute Deviation, scaled by 1.4826 to be ≈ σ for normal data.
 * Returns NaN for empty input. Returns 0 if all observations equal the median.
 *
 * If the caller already computed the median, pass it in to skip the second sort.
 */
export function mad(xs: readonly number[], med?: number): number {
  const a = clean(xs);
  if (a.length === 0) return NaN;
  const m = med ?? median(a);
  const deviations = a.map((x) => Math.abs(x - m));
  const rawMad = median(deviations);
  return rawMad * 1.4826;
}

/**
 * Robust z-score: (x - median) / MAD.
 *
 * Sentinel: if MAD === 0 (constant baseline), returns 0 — NOT NaN — so that
 * downstream gates do not fire spuriously on the first deviation. This matches
 * the safety-first locking decision: missing variance => "we don't know enough,
 * stay quiet".
 *
 * If MAD is NaN (empty baseline) the function still returns 0 for the same
 * reason. Callers that need to *know* the baseline was empty must check `mad`
 * separately before calling.
 */
export function zRobust(x: number, med: number, madVal: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(med)) return 0;
  if (!Number.isFinite(madVal) || madVal === 0) return 0;
  return (x - med) / madVal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Median + MAD over the last `window` finite values of a series. Nulls and
 * non-finite entries are silently dropped. If fewer than 3 finite values
 * remain the result is `{ median: NaN, mad: NaN }` — callers must guard.
 */
export function rollingMedianMAD(
  series: readonly (number | null | undefined)[],
  window: number,
): { median: number; mad: number; n: number } {
  const last = series.slice(-window);
  const a = compact(last);
  if (a.length < 3) return { median: NaN, mad: NaN, n: a.length };
  const m = median(a);
  const v = mad(a, m);
  return { median: m, mad: v, n: a.length };
}

/**
 * Rolling mean (first-moment) — used only for the HRV CV-rising rule, which
 * works in lnRMSSD space where mean and median are close. Returns NaN if
 * fewer than `window` finite samples are available.
 */
export function rollingMean(
  series: readonly (number | null | undefined)[],
  window: number,
): number {
  const last = series.slice(-window);
  const a = compact(last);
  if (a.length === 0) return NaN;
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

/** Sample standard deviation (n−1). Returns NaN if fewer than 2 samples. */
export function stdev(xs: readonly number[]): number {
  const a = clean(xs);
  if (a.length < 2) return NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  let acc = 0;
  for (const x of a) acc += (x - m) * (x - m);
  return Math.sqrt(acc / (a.length - 1));
}

/**
 * Coefficient of variation in lnRMSSD space, expressed as a unitless ratio
 * (σ / |μ|). Used by the HRV-CV rule (maladaptation marker per Plews 2014).
 */
export function coefficientOfVariation(xs: readonly number[]): number {
  const a = clean(xs);
  if (a.length < 2) return NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  if (Math.abs(m) < 1e-12) return NaN;
  return stdev(a) / Math.abs(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mann–Kendall + Theil–Sen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mann–Kendall trend test on a series. Returns the test statistic S, the
 * sample size n, and an approximate two-sided p-value via the normal
 * approximation (z = (S − sign(S)) / sqrt(Var(S))).
 *
 * Tie correction is included. Series shorter than 4 points returns p=1.
 */
export function mannKendall(series: readonly number[]): {
  S: number;
  n: number;
  p: number;
} {
  const a = clean(series);
  const n = a.length;
  if (n < 4) return { S: 0, n, p: 1 };

  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = a[j] - a[i];
      if (d > 0) S += 1;
      else if (d < 0) S -= 1;
    }
  }

  // Tie groups for variance correction.
  const counts = new Map<number, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let tieAdj = 0;
  for (const c of counts.values()) {
    if (c > 1) tieAdj += c * (c - 1) * (2 * c + 5);
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieAdj) / 18;

  let z = 0;
  if (varS > 0) {
    if (S > 0) z = (S - 1) / Math.sqrt(varS);
    else if (S < 0) z = (S + 1) / Math.sqrt(varS);
    else z = 0;
  }

  // Two-sided p from |z| via the standard-normal CDF approximation.
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { S, n, p };
}

/**
 * Theil–Sen slope estimator: median of all pairwise slopes (y_j − y_i)/(j − i).
 * Slope is per-step (i.e. per index unit). Multiply by 7 to get slope/week
 * for daily data.
 *
 * Returns NaN if fewer than 2 finite samples.
 */
export function theilSen(series: readonly number[]): number {
  const a = clean(series);
  const n = a.length;
  if (n < 2) return NaN;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((a[j] - a[i]) / (j - i));
    }
  }
  return median(slopes);
}

/**
 * Standard-normal CDF via Abramowitz & Stegun 26.2.17 — accurate to ~7e-8.
 * Used for the Mann–Kendall p-value approximation only.
 */
function normalCdf(z: number): number {
  // Using error function via Abramowitz & Stegun 7.1.26.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // erf approximation
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// ─────────────────────────────────────────────────────────────────────────────
// HRV-specific
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute lnRMSSD = ln(mean(RMSSD)) over a list of nightly RMSSD values
 * (in milliseconds). Per Plews 2014, the log-transform stabilises the
 * within-person variance and makes z-scoring valid.
 *
 * Requires at least 3 finite samples (Plews compliance threshold for a
 * representative weekly value). Returns null otherwise.
 */
export function lnRMSSD(hrv_ms: readonly (number | null | undefined)[]): number | null {
  const a = compact(hrv_ms);
  if (a.length < 3) return null;
  // Drop non-positive values (RMSSD is always > 0 in practice; defensive).
  const positive = a.filter((x) => x > 0);
  if (positive.length < 3) return null;
  const mean = positive.reduce((s, x) => s + x, 0) / positive.length;
  return Math.log(mean);
}

/**
 * Per-night lnRMSSD series: ln(rmssd_ms) for each finite, positive entry.
 * Used by the trend / CV rules. Returns NaN for null/zero/negative entries
 * so that callers can treat them as missing.
 */
export function lnRMSSDSeries(
  rmssd_ms: readonly (number | null | undefined)[],
): number[] {
  const out: number[] = [];
  for (const x of rmssd_ms) {
    if (typeof x === "number" && Number.isFinite(x) && x > 0) out.push(Math.log(x));
    else out.push(NaN);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence-gate helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count consecutive trailing values that satisfy `pred`.
 * Used by gates like "3-consec >+1.5σ same direction".
 */
export function trailingConsecutive<T>(
  series: readonly T[],
  pred: (x: T) => boolean,
): number {
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (pred(series[i])) n += 1;
    else break;
  }
  return n;
}

/**
 * Count how many of the last `window` values satisfy `pred`. Used for
 * "5/7 days" style gates.
 */
export function countLastN<T>(
  series: readonly T[],
  window: number,
  pred: (x: T) => boolean,
): { hits: number; total: number } {
  const last = series.slice(-window);
  let hits = 0;
  for (const x of last) if (pred(x)) hits += 1;
  return { hits, total: last.length };
}
