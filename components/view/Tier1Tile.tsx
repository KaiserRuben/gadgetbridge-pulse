"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Glyph } from "@/components/ui/glyph";
import { useViewState } from "@/lib/view-state/context";
import { cn } from "@/lib/cn";

/**
 * Always-fresh deterministic KPI strip — the at-a-glance layer under the hero.
 * Six tier1 KPIs grouped into three domains (sleep / autonomic / activity)
 * with tinted headers and dividers, so the eye reads structure instead of a
 * flat table. Each group is the drill-down door into its detail page for the
 * active day. Values tick on mount; missing readings read as "noch keine"
 * rather than a bare em-dash.
 */
export function Tier1Tile() {
  const { view, period_key } = useViewState();
  const t1 = view?.tier1;
  const k = t1?.kpis_today ?? null;
  const hasComputed = t1?.computed_at != null;

  return (
    <Card variant="soft" className="overflow-hidden p-0">
      <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Group label="Schlaf" tone="var(--color-sleep)" href={`/sleep/${period_key}`}>
          <Metric label="TST" value={k?.tst_min} fmt="hm" />
          <Metric label="Effizienz" value={k?.sleep_eff_pct} unit="%" />
        </Group>
        <Group label="Autonom" tone="var(--color-hrv)" href={`/recovery/${period_key}`}>
          <Metric label="RMSSD" value={k?.rmssd_ms} unit="ms" />
          <Metric label="RHR" value={k?.rhr_sleep_bpm} unit="bpm" />
        </Group>
        <Group label="Aktivität" tone="var(--color-activity)" href={`/activity/${period_key}`}>
          <Metric label="Schritte" value={k?.steps} hasComputed={hasComputed} />
          <Metric label="Aktiv" value={k?.active_kcal} unit="kcal" hasComputed={hasComputed} />
        </Group>
      </div>
    </Card>
  );
}

function Group({
  label,
  tone,
  href,
  children,
}: {
  label: string;
  tone: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2.5 p-4 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className="flex items-center gap-1.5 eyebrow">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
        {label}
        <Glyph
          name="ChevronRight"
          size={12}
          className="ml-auto text-[var(--color-text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-text-subtle)]"
        />
      </span>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </Link>
  );
}

function Metric({
  label,
  value,
  unit,
  fmt,
  hasComputed = true,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  fmt?: "hm";
  /** When false, a 0 reading is treated as "not yet measured". */
  hasComputed?: boolean;
}) {
  const missing =
    value == null || !Number.isFinite(value) || (value === 0 && !hasComputed);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.625rem] uppercase tracking-[0.1em] text-[var(--color-text-subtle)]">
        {label}
      </span>
      {missing ? (
        <span className="text-[0.9375rem] text-[var(--color-text-faint)]">noch keine</span>
      ) : (
        <span className="flex items-baseline gap-1">
          <MetricValue value={value as number} fmt={fmt} />
          {unit ? <span className="text-[0.6875rem] text-[var(--color-text-subtle)]">{unit}</span> : null}
        </span>
      )}
    </div>
  );
}

function MetricValue({ value, fmt }: { value: number; fmt?: "hm" }) {
  if (fmt === "hm") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    return (
      <span className={cn("num text-[1.375rem] font-semibold leading-none text-[var(--color-text)]")}>
        {h}
        <span className="text-[0.8125rem] text-[var(--color-text-subtle)]">h </span>
        {m.toString().padStart(2, "0")}
      </span>
    );
  }
  return (
    <NumberTicker
      value={Math.round(value)}
      className="num text-[1.375rem] font-semibold leading-none text-[var(--color-text)]"
    />
  );
}
