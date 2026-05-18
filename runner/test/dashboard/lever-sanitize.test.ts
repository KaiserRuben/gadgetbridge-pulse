import { describe, expect, it } from "vitest";

import {
  humanizeLeverId,
  sanitizeLeverProse,
} from "../../../lib/dashboard/lever-to-insight.ts";

describe("humanizeLeverId", () => {
  it("maps known engineering names to German labels", () => {
    expect(humanizeLeverId("rhr_drift")).toBe("Ruhepuls-Drift");
    expect(humanizeLeverId("hrv_recovery")).toBe("HRV-Erholung");
    expect(humanizeLeverId("stress_high")).toBe("Hochstress");
  });

  it("falls back to underscore-to-title-case for unknown IDs", () => {
    expect(humanizeLeverId("foo_bar_baz")).toBe("Foo Bar Baz");
  });
});

describe("sanitizeLeverProse", () => {
  it("strips engineering field_name: value lines", () => {
    expect(sanitizeLeverProse("trend_direction: flat")).toBeNull();
    expect(sanitizeLeverProse("rhr_drift: 6")).toBeNull();
  });

  it("returns prose unchanged when no engineering noise", () => {
    const input = "Ruhepuls bleibt nahe 62 bpm — keine Drift erkennbar.";
    expect(sanitizeLeverProse(input)).toBe(input);
  });

  it("strips mixed engineering + prose, keeps prose", () => {
    const input = "trend_direction: flat\nRuhepuls bleibt stabil bei rund 62 bpm.";
    expect(sanitizeLeverProse(input)).toBe(
      "Ruhepuls bleibt stabil bei rund 62 bpm.",
    );
  });

  it("returns null when residue is too short (<4 words)", () => {
    expect(sanitizeLeverProse("ok")).toBeNull();
    expect(sanitizeLeverProse("flat ok")).toBeNull();
  });

  it("returns null on empty / null / undefined input", () => {
    expect(sanitizeLeverProse(null)).toBeNull();
    expect(sanitizeLeverProse(undefined)).toBeNull();
    expect(sanitizeLeverProse("")).toBeNull();
    expect(sanitizeLeverProse("   ")).toBeNull();
  });
});
