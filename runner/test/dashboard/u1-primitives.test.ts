/**
 * Tests for Phase U1 dashboard primitives. These cover the deterministic
 * core: the confidence tier ladder + the cluster-copy registry. The React
 * components themselves require a DOM, which we don't pull into the runner
 * vitest config — UI smoke is covered by typecheck + build.
 *
 * Imports cross the dashboard ↔ runner boundary via relative paths because
 * vitest's config uses esbuild and doesn't enforce tsconfig include.
 */

import { describe, expect, it } from "vitest";

import {
  confidenceTier,
  type ConfidenceTier,
} from "../../../lib/confidence.ts";
import {
  CLUSTER_COPY,
  getClusterCopy,
} from "../../../lib/derived/cluster-copy.ts";

describe("confidenceTier", () => {
  it("returns 'up' for value >= 0.7", () => {
    expect(confidenceTier(0.85)).toBe<ConfidenceTier>("up");
    expect(confidenceTier(0.7)).toBe<ConfidenceTier>("up");
    expect(confidenceTier(1)).toBe<ConfidenceTier>("up");
  });

  it("returns 'steady' for 0.5 <= value < 0.7", () => {
    expect(confidenceTier(0.6)).toBe<ConfidenceTier>("steady");
    expect(confidenceTier(0.5)).toBe<ConfidenceTier>("steady");
    // 0.699 should still be steady, not up
    expect(confidenceTier(0.6999)).toBe<ConfidenceTier>("steady");
  });

  it("returns 'down' for value < 0.5", () => {
    expect(confidenceTier(0.3)).toBe<ConfidenceTier>("down");
    expect(confidenceTier(0)).toBe<ConfidenceTier>("down");
    expect(confidenceTier(0.4999)).toBe<ConfidenceTier>("down");
  });
});

describe("getClusterCopy", () => {
  it("returns the registered entry for synthesis_v3", () => {
    const copy = getClusterCopy("synthesis_v3");
    expect(copy).not.toBeNull();
    expect(copy?.label).toBe("Tages-Analyse");
    expect(copy?.emptyCta).toBe("Tages-Insight anfordern");
  });

  it("returns null for an unknown cluster", () => {
    expect(getClusterCopy("totally_made_up")).toBeNull();
    expect(getClusterCopy("")).toBeNull();
  });

  it("has every registered cluster fully populated", () => {
    for (const [cluster, copy] of Object.entries(CLUSTER_COPY)) {
      expect(copy.label, `${cluster}.label`).toBeTruthy();
      expect(copy.description, `${cluster}.description`).toBeTruthy();
      expect(copy.emptyCta, `${cluster}.emptyCta`).toBeTruthy();
      expect(copy.abstainFallback, `${cluster}.abstainFallback`).toBeTruthy();
      expect(typeof copy.autoProcessDefault, `${cluster}.autoProcessDefault`)
        .toBe("boolean");
    }
  });
});

describe("cluster-copy auto_process defaults (OQ-5)", () => {
  it("defaults synthesis_v3 / morning_insight / weekly_recap / anomaly_explain to ON", () => {
    expect(CLUSTER_COPY.synthesis_v3.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.morning_insight.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.weekly_recap.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.anomaly_explain.autoProcessDefault).toBe(true);
  });

  it("defaults future per-domain clusters to OFF", () => {
    expect(CLUSTER_COPY.sleep_insight.autoProcessDefault).toBe(false);
    expect(CLUSTER_COPY.recovery_insight.autoProcessDefault).toBe(false);
    expect(CLUSTER_COPY.activity_insight.autoProcessDefault).toBe(false);
  });
});
