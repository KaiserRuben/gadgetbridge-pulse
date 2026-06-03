import type { ViewStateDaily } from "@/runner/v4/types.ts";

/**
 * Accessors for the tier1 `detail` block — the per-domain same-day values +
 * 14-day series the drill pages render. Keys are namespaced `<domain>.<metric>`
 * (e.g. "sleep.tst_min", "stress.stress_mean"). All tolerate a null view /
 * missing detail (pre-`detail` docs) by returning null / empty.
 */

export function detailToday(view: ViewStateDaily | null, id: string): number | null {
  const v = view?.tier1?.detail?.today?.[id];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 14-day values for a metric (oldest→newest); nulls kept for gap days. */
export function detailSeries(
  view: ViewStateDaily | null,
  id: string,
): Array<number | null> {
  const pts = view?.tier1?.detail?.series_14d?.[id];
  if (!Array.isArray(pts)) return [];
  return pts.map((p) =>
    typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null,
  );
}

/** Date keys aligned to {@link detailSeries}. */
export function detailDates(view: ViewStateDaily | null, id: string): string[] {
  return view?.tier1?.detail?.series_14d?.[id]?.map((p) => p.date) ?? [];
}
