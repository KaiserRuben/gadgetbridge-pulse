"use client";

const BAND_DOT: Record<string, string> = {
  above_usual: "bg-[var(--color-band-up)]",
  steady: "bg-[var(--color-band-steady)]",
  below_usual: "bg-[var(--color-band-down)]",
};

const BAND_LABEL: Record<string, string> = {
  above_usual: "über üblich",
  steady: "stabil",
  below_usual: "unter üblich",
};

export interface DrillKpi {
  label: string;
  value: number | string | null;
  band: string;
  reasoning: string;
}

export function DrillKpiRow({ kpi }: { kpi: DrillKpi }) {
  const dot = BAND_DOT[kpi.band] ?? "bg-[var(--color-border)]";
  const bandLabel = BAND_LABEL[kpi.band] ?? kpi.band;
  const value =
    kpi.value === null
      ? "—"
      : typeof kpi.value === "number"
        ? Math.round(kpi.value).toString()
        : kpi.value;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-[var(--color-surface-soft)] px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-[var(--color-text)]">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
          {kpi.label}
        </span>
        <span className="num font-medium">
          {value}
          <span className="ml-1 text-[0.6875rem] text-[var(--color-text-muted)]">
            · {bandLabel}
          </span>
        </span>
      </div>
      {kpi.reasoning ? (
        <p className="text-[0.6875rem] italic text-[var(--color-text-muted)]">
          {kpi.reasoning}
        </p>
      ) : null}
    </div>
  );
}
