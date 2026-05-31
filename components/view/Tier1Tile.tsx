"use client";

import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { useViewState } from "@/lib/view-state/context";

/**
 * Always-fresh deterministic KPI strip. Pulls from view.tier1.kpis_today.
 * Renders six tiles: TST, sleep eff %, RMSSD, RHR (sleep), steps, active kcal.
 */
export function Tier1Tile() {
  const { view } = useViewState();
  const t1 = view?.tier1;
  const k = t1?.kpis_today ?? null;

  return (
    <Card variant="soft" className="p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="TST" value={fmtMin(k?.tst_min)} unit="min" />
        <Stat label="Effizienz" value={fmt(k?.sleep_eff_pct)} unit="%" />
        <Stat label="RMSSD" value={fmt(k?.rmssd_ms)} unit="ms" />
        <Stat label="RHR" value={fmt(k?.rhr_sleep_bpm)} unit="bpm" />
        <Stat label="Schritte" value={fmt(k?.steps)} />
        <Stat label="Aktiv kcal" value={fmt(k?.active_kcal)} />
      </div>
    </Card>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("de-DE");
}

function fmtMin(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return `${h}h ${m.toString().padStart(2, "0")}`;
}
