import { describe, expect, it } from "vitest";

import { applyBump, decayStatuses, pickDueSlots } from "../calendar.ts";
import { buildInitialDaily } from "../../view-state/builder.ts";
import type { SlotEntry, ViewStateDaily } from "../../types.ts";

const NOW = new Date("2026-05-27T08:30:00+02:00");

function freshDaily(): ViewStateDaily {
  return buildInitialDaily("2026-05-27", new Date("2026-05-27T00:00:00+02:00"));
}

describe("pickDueSlots", () => {
  it("returns nothing when all slots scheduled in the future", () => {
    const view = freshDaily();
    // All scheduled_for are 08:00..23:00 local on 2026-05-27.
    const early = new Date("2026-05-27T05:00:00+02:00");
    expect(pickDueSlots(view, early)).toHaveLength(0);
  });

  it("returns night_review + morning_briefing when both due", () => {
    const view = freshDaily();
    // 09:30 local → night_review (09:00) and morning_briefing (08:00) both past.
    const at = new Date("2026-05-27T09:30:00+02:00");
    const due = pickDueSlots(view, at);
    const ids = due.map((d) => d.slot_id);
    expect(ids).toContain("night_review");
    expect(ids).toContain("morning_briefing");
    // night_review must come before morning_briefing (depends_on order).
    expect(ids.indexOf("night_review")).toBeLessThan(ids.indexOf("morning_briefing"));
  });

  it("skips fresh slots", () => {
    const view = freshDaily();
    const target = view.slots.night_review;
    target.status = "fresh";
    target.computed_at = NOW.toISOString();
    const due = pickDueSlots(view, new Date("2026-05-27T09:30:00+02:00"));
    expect(due.find((d) => d.slot_id === "night_review")).toBeUndefined();
  });
});

describe("applyBump", () => {
  it("re-anchors scheduled night_review on sleep_complete", () => {
    const view = freshDaily();
    const wake = new Date("2026-05-27T06:35:00+02:00");
    const { next, rescheduled } = applyBump(view, "sleep_complete", wake);
    expect(rescheduled).toContain("night_review");
    if (next.scope !== "daily") throw new Error("expected daily");
    expect(next.slots.night_review.scheduled_for).toBe(wake.toISOString());
  });

  it("forces recompute when night_review already fresh and bump=recompute_on_bump", () => {
    const view = freshDaily();
    view.slots.night_review.status = "fresh";
    view.slots.night_review.computed_at = "2026-05-27T07:30:00+02:00";
    const wake = new Date("2026-05-27T08:15:00+02:00");
    const { next, to_recompute } = applyBump(view, "sleep_complete", wake);
    expect(to_recompute).toContain("night_review");
    if (next.scope !== "daily") throw new Error("expected daily");
    expect(next.slots.night_review.status).toBe("scheduled");
  });

  it("does not touch morning_briefing on sleep_complete if recompute_on_bump=false and not waiting", () => {
    const view = freshDaily();
    view.slots.morning_briefing.status = "fresh";
    view.slots.morning_briefing.computed_at = "2026-05-27T08:05:00+02:00";
    const wake = new Date("2026-05-27T08:30:00+02:00");
    const { rescheduled } = applyBump(view, "sleep_complete", wake);
    expect(rescheduled).not.toContain("morning_briefing");
  });
});

describe("decayStatuses", () => {
  it("marks scheduled slots past scheduled_for+ttl as missed", () => {
    const view = freshDaily();
    // morning_briefing scheduled for 08:00 with 6h ttl → missed after 14:00.
    const next = decayStatuses(view, new Date("2026-05-27T16:00:00+02:00"));
    if (next.scope !== "daily") throw new Error("expected daily");
    expect((next.slots.morning_briefing as SlotEntry).status).toBe("missed");
  });

  it("promotes fresh → aging at ttl/3", () => {
    const view = freshDaily();
    const slot = view.slots.morning_briefing;
    slot.status = "fresh";
    slot.computed_at = "2026-05-27T08:00:00+02:00";
    // ttl=6h, ttl/3=2h → 10:01 should flip aging.
    const next = decayStatuses(view, new Date("2026-05-27T10:01:00+02:00"));
    if (next.scope !== "daily") throw new Error("expected daily");
    expect((next.slots.morning_briefing as SlotEntry).status).toBe("aging");
  });
});
