/**
 * Tests for Phase U4 information architecture. Covers the deterministic
 * core of the nav reorder + the cluster registry preview helpers. React
 * + DOM render is left to the dashboard build; this suite asserts the
 * data the UI is sliced from.
 *
 * Imports cross the dashboard ↔ runner boundary via relative paths to
 * match the vitest alias setup that other dashboard-side tests use.
 */

import { describe, expect, it } from "vitest";

import {
  NAV_DESKTOP_SECTIONS,
  NAV_PRIMARY_MOBILE,
  NAV_SHEET_MOBILE,
  type NavItem,
  type NavSection,
} from "../../../lib/constants.ts";
import { CLUSTER_COPY } from "../../../lib/derived/cluster-copy.ts";

function allItems(sections: readonly NavSection[]): NavItem[] {
  return sections.flatMap((s) => [...s.items]);
}

function findItem(
  sections: readonly NavSection[],
  href: string,
): NavItem | undefined {
  return allItems(sections).find((i) => i.href === href);
}

describe("Phase U4: desktop sidebar", () => {
  it("exposes every fast-access surface", () => {
    // Fast-access requirement: Home, Coach, Training, Ernährung, Woche
    // must all be reachable from the sidebar's top section.
    const all = allItems(NAV_DESKTOP_SECTIONS);
    const labels = all.map((i) => i.label);
    expect(labels).toContain("Home");
    expect(labels).toContain("Coach");
    expect(labels).toContain("Training");
    expect(labels).toContain("Ernährung");
    expect(labels).toContain("Woche");
  });

  it("places fast-access surfaces in the top (label=null) section", () => {
    const top = NAV_DESKTOP_SECTIONS[0];
    expect(top.label).toBeNull();
    const order = top.items.map((i) => i.label);
    expect(order).toEqual([
      "Home",
      "Coach",
      "Training",
      "Ernährung",
      "Woche",
    ]);
  });

  it("keeps Coach as the sidebar label (OQ-3)", () => {
    const coach = findItem(NAV_DESKTOP_SECTIONS, "/coach");
    expect(coach).toBeDefined();
    expect(coach?.label).toBe("Coach");
  });

  it("groups secondary surfaces under 'Weitere' + a temporary 'Legacy' block", () => {
    // UI rework: collapsed Domänen + Werkzeuge into a flat 'Weitere' block;
    // the per-domain v3 pages stay reachable under 'Legacy' while the v4
    // slots stabilise (dropped once Phase 4 lands).
    const labels = NAV_DESKTOP_SECTIONS.map((s) => s.label);
    expect(labels).toEqual([null, "Weitere", "Legacy"]);
  });

  it("keeps Bewegung (v3) pointing at /activity in the Legacy block", () => {
    const legacy = NAV_DESKTOP_SECTIONS.find((s) => s.label === "Legacy");
    const bewegung = legacy!.items.find((i) => i.label === "Bewegung (v3)");
    expect(bewegung?.href).toBe("/activity");
  });

  it("does not duplicate Schlaf/Ernährung between top + Weitere", () => {
    const weitere = NAV_DESKTOP_SECTIONS.find((s) => s.label === "Weitere");
    const labels = weitere!.items.map((i) => i.label);
    expect(labels).not.toContain("Schlaf");
    expect(labels).not.toContain("Ernährung");
  });

  it("includes Workouts in Weitere", () => {
    const weitere = NAV_DESKTOP_SECTIONS.find((s) => s.label === "Weitere");
    const labels = weitere!.items.map((i) => i.label);
    expect(labels).toContain("Workouts");
  });

  it("renders every nav href as a unique URL", () => {
    const hrefs = allItems(NAV_DESKTOP_SECTIONS).map((i) => i.href);
    const dedup = new Set(hrefs);
    expect(dedup.size).toBe(hrefs.length);
  });
});

describe("Phase U4: mobile bottom-nav", () => {
  it("promotes Ernährung into the primary slots", () => {
    const labels = NAV_PRIMARY_MOBILE.map((i) => i.label);
    expect(labels).toContain("Ernährung");
  });

  it("exposes the five fast-access surfaces in order", () => {
    const labels = NAV_PRIMARY_MOBILE.map((i) => i.label);
    expect(labels).toEqual([
      "Home",
      "Training",
      "Coach",
      "Ernährung",
      "Woche",
    ]);
  });

  it("uses 5 primary slots", () => {
    expect(NAV_PRIMARY_MOBILE.length).toBe(5);
  });

  it("keeps a More-sheet entry for /settings", () => {
    const labels = NAV_SHEET_MOBILE.map((i) => i.label);
    expect(labels).toContain("Einstellungen");
  });

  it("doesn't duplicate any primary slot inside the sheet", () => {
    const primaryHrefs = new Set(NAV_PRIMARY_MOBILE.map((i) => i.href));
    const sheetHrefs = NAV_SHEET_MOBILE.map((i) => i.href);
    for (const h of sheetHrefs) {
      expect(primaryHrefs.has(h)).toBe(false);
    }
  });
});

describe("Phase U4: cluster registry preview helpers", () => {
  it("CLUSTER_COPY entries used by the preview render as German labels", () => {
    // The settings preview pulls display names from CLUSTER_COPY[*].label;
    // U4 hard-locks four label strings while the rest of the registry can
    // ship over time. Lock the four anchors so the preview cannot regress
    // to engineering-style cluster IDs.
    expect(CLUSTER_COPY.synthesis_v3.label).toBe("Tages-Analyse");
    expect(CLUSTER_COPY.morning_insight.label).toBe("Morgen-Briefing");
    expect(CLUSTER_COPY.weekly_recap.label).toBe("Wochen-Recap");
    expect(CLUSTER_COPY.anomaly_explain.label).toBe("Anomalie-Erklärung");
  });

  it("OQ-5 default-ON clusters carry autoProcessDefault=true", () => {
    expect(CLUSTER_COPY.synthesis_v3.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.morning_insight.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.weekly_recap.autoProcessDefault).toBe(true);
    expect(CLUSTER_COPY.anomaly_explain.autoProcessDefault).toBe(true);
  });

  it("non-anchor LLM-heavy clusters default OFF", () => {
    // Insight clusters that haven't graduated past prototype stay opt-in;
    // the preview surfaces them but the runtime resolver respects the
    // OQ-5 conservative default.
    expect(CLUSTER_COPY.sleep_insight.autoProcessDefault).toBe(false);
    expect(CLUSTER_COPY.recovery_insight.autoProcessDefault).toBe(false);
    expect(CLUSTER_COPY.activity_insight.autoProcessDefault).toBe(false);
  });
});
