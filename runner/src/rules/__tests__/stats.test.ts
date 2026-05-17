/**
 * Unit tests for the pure statistical helpers in `../stats.ts`.
 *
 * These are the foundation of every rule decision; if any of these are
 * wrong, every downstream rule is wrong. Keep coverage strict.
 */

import { describe, it, expect } from "vitest";

import {
  median,
  mad,
  zRobust,
  rollingMedianMAD,
  rollingMean,
  stdev,
  coefficientOfVariation,
  mannKendall,
  theilSen,
  lnRMSSD,
  lnRMSSDSeries,
  trailingConsecutive,
  countLastN,
  compact,
} from "../stats.ts";

// ─────────────────────────────────────────────────────────────────────────────
// median
// ─────────────────────────────────────────────────────────────────────────────

describe("median", () => {
  it("returns the middle value for odd-length arrays", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for even-length arrays", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("returns NaN for empty input", () => {
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("ignores non-finite values", () => {
    expect(median([1, NaN, 3, Infinity])).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mad
// ─────────────────────────────────────────────────────────────────────────────

describe("mad", () => {
  it("returns 0 when all values equal the median", () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });

  it("scales raw MAD by 1.4826 (≈ σ for normal data)", () => {
    // [1,2,3,4,5] → median 3, deviations [2,1,0,1,2] → median 1 → 1.4826.
    expect(mad([1, 2, 3, 4, 5])).toBeCloseTo(1.4826, 4);
  });

  it("accepts a precomputed median", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(mad(xs, 3)).toBeCloseTo(1.4826, 4);
  });

  it("returns NaN for empty input", () => {
    expect(Number.isNaN(mad([]))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// zRobust
// ─────────────────────────────────────────────────────────────────────────────

describe("zRobust", () => {
  it("computes (x - med) / mad", () => {
    expect(zRobust(10, 5, 2)).toBe(2.5);
    expect(zRobust(2, 5, 2)).toBe(-1.5);
  });

  it("returns 0 when MAD is 0 (sentinel for safety)", () => {
    // Constant baseline → no signal-to-noise → don't fire alarms.
    expect(zRobust(10, 5, 0)).toBe(0);
  });

  it("returns 0 when MAD is NaN (empty baseline)", () => {
    expect(zRobust(10, 5, NaN)).toBe(0);
  });

  it("returns 0 when median is non-finite", () => {
    expect(zRobust(10, NaN, 2)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rollingMedianMAD
// ─────────────────────────────────────────────────────────────────────────────

describe("rollingMedianMAD", () => {
  it("computes over the last N finite values", () => {
    const series = [100, 100, 100, 1, 2, 3, 4, 5];
    const r = rollingMedianMAD(series, 5);
    expect(r.median).toBe(3);
    expect(r.n).toBe(5);
    expect(r.mad).toBeCloseTo(1.4826, 4);
  });

  it("returns NaN when fewer than 3 finite values in window", () => {
    // [null, null, 1, 2] with window=3 → trailing slice [null, 1, 2] → 2 finite → NaN.
    const r = rollingMedianMAD([null, null, 1, 2], 3);
    expect(Number.isNaN(r.median)).toBe(true);
    expect(r.n).toBe(2);

    const r2 = rollingMedianMAD([null, null, 1], 3);
    expect(Number.isNaN(r2.median)).toBe(true);
    expect(Number.isNaN(r2.mad)).toBe(true);
  });

  it("ignores nulls in the trailing window", () => {
    const r = rollingMedianMAD([null, 1, null, 2, 3], 5);
    expect(r.n).toBe(3);
    expect(r.median).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rollingMean / stdev / cv
// ─────────────────────────────────────────────────────────────────────────────

describe("rollingMean", () => {
  it("computes mean over last N finite values", () => {
    expect(rollingMean([10, 20, 30, 40], 2)).toBe(35);
  });
  it("returns NaN when no finite values in window", () => {
    expect(Number.isNaN(rollingMean([null, null], 2))).toBe(true);
  });
});

describe("stdev", () => {
  it("returns sample stdev (n-1 denominator)", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
  it("returns NaN for <2 samples", () => {
    expect(Number.isNaN(stdev([5]))).toBe(true);
  });
});

describe("coefficientOfVariation", () => {
  it("returns σ / |μ|", () => {
    const v = coefficientOfVariation([10, 12, 14]);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.3);
  });
  it("returns NaN when mean is ~0", () => {
    expect(Number.isNaN(coefficientOfVariation([-1, 0, 1]))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mann-Kendall + Theil-Sen
// ─────────────────────────────────────────────────────────────────────────────

describe("mannKendall", () => {
  it("monotonic increasing series gives p<0.05", () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.S).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(0.05);
  });

  it("monotonic decreasing series gives p<0.05 with negative S", () => {
    const r = mannKendall([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(r.S).toBeLessThan(0);
    expect(r.p).toBeLessThan(0.05);
  });

  it("flat series gives S=0 and p≈1", () => {
    const r = mannKendall([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(r.S).toBe(0);
    // Floating-point: erf approximation gives ≈1, not exactly 1.
    expect(r.p).toBeCloseTo(1, 6);
  });

  it("series shorter than 4 returns p=1", () => {
    const r = mannKendall([1, 2, 3]);
    expect(r.p).toBe(1);
  });
});

describe("theilSen", () => {
  it("returns exact slope for a linear series", () => {
    // y = 2x + 7 → slopes all 2.
    expect(theilSen([7, 9, 11, 13, 15, 17])).toBe(2);
  });

  it("is robust to a single outlier", () => {
    // 0..5 baseline slope 1, but one big outlier should not move the median.
    const slope = theilSen([0, 1, 2, 3, 100, 5]);
    expect(slope).toBeGreaterThan(0.5);
    expect(slope).toBeLessThan(2.5);
  });

  it("returns NaN for <2 samples", () => {
    expect(Number.isNaN(theilSen([5]))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lnRMSSD
// ─────────────────────────────────────────────────────────────────────────────

describe("lnRMSSD", () => {
  it("returns ln(mean) when ≥3 positive samples", () => {
    const v = lnRMSSD([40, 50, 60]);
    expect(v).toBeCloseTo(Math.log(50), 5);
  });

  it("returns null with fewer than 3 finite samples", () => {
    expect(lnRMSSD([40, 50])).toBeNull();
    expect(lnRMSSD([])).toBeNull();
    expect(lnRMSSD([null, null, 50])).toBeNull();
  });

  it("filters out non-positive values", () => {
    expect(lnRMSSD([0, -5, 50])).toBeNull();
  });
});

describe("lnRMSSDSeries", () => {
  it("returns ln per entry, NaN for null/zero", () => {
    const s = lnRMSSDSeries([40, null, 0, 50]);
    expect(s).toHaveLength(4);
    expect(s[0]).toBeCloseTo(Math.log(40), 5);
    expect(Number.isNaN(s[1])).toBe(true);
    expect(Number.isNaN(s[2])).toBe(true);
    expect(s[3]).toBeCloseTo(Math.log(50), 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// trailingConsecutive / countLastN / compact
// ─────────────────────────────────────────────────────────────────────────────

describe("trailingConsecutive", () => {
  it("counts trailing values matching pred", () => {
    expect(trailingConsecutive([1, 0, 1, 1, 1], (x) => x === 1)).toBe(3);
    expect(trailingConsecutive([1, 1, 1, 0], (x) => x === 1)).toBe(0);
    expect(trailingConsecutive([], (x) => x === 1)).toBe(0);
  });
});

describe("countLastN", () => {
  it("counts hits in last N values", () => {
    const r = countLastN([1, 2, 3, 4, 5, 6, 7], 3, (x) => x > 4);
    expect(r.hits).toBe(3);
    expect(r.total).toBe(3);
  });
  it("handles short series (total < window)", () => {
    const r = countLastN([1, 2], 5, (x) => x > 0);
    expect(r.total).toBe(2);
    expect(r.hits).toBe(2);
  });
});

describe("compact", () => {
  it("drops nulls/undefined/non-finite", () => {
    expect(compact([1, null, 2, undefined, NaN, 3, Infinity])).toEqual([1, 2, 3]);
  });
});
