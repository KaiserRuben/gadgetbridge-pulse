"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FadeRise } from "@/components/motion/fade-rise";
import { MicroHeatmap, type HeatmapRow } from "@/components/nutrition/MicroHeatmap";
import { effectiveTarget } from "@/lib/nutrition/helpers";
import type { NutritionFacts, Meal, NutritionTargets } from "@/lib/nutrition/types";
import { cn } from "@/lib/cn";

type Window = 14 | 30 | 90;
const DOW_LABEL = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export interface TrendsViewProps {
  today: string;
  meals: Meal[];
  weekStrip: Array<{ date: string; totals: NutritionFacts; meals_count: number }>;
  targets: NutritionTargets;
}

/**
 * /nutrition/trends client view. Data fetched server-side and injected.
 */
export default function TrendsView({ today, meals, weekStrip, targets }: TrendsViewProps) {
  const [window, setWindow] = useState<Window>(14);
  const MEALS = meals;
  const TARGETS = targets;

  // Build a [today-N+1 .. today] window. We synthesise daily totals by
  // bucketing meals on their period_key — days with no meals show as a
  // muted gap so the eye reads continuity, not noise.
  const days = useMemo(() => {
    const [y, m, d] = today.split("-").map(Number);
    const start = Date.UTC(y, m - 1, d);
    const list: Array<{ date: string; totals: NutritionFacts; meals: Meal[] }> = [];
    for (let i = window - 1; i >= 0; i--) {
      const dt = new Date(start - i * 86_400_000);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
      const dayMeals = MEALS.filter((m) => m.period_key === key);
      const totals = dayMeals.reduce(
        (acc, m) => addFacts(acc, m.totals),
        EMPTY,
      );
      list.push({ date: key, totals, meals: dayMeals });
    }
    return list;
  }, [today, window]);

  const kcalTarget = effectiveTarget(TARGETS.rows.find((r) => r.key === "kcal")!);
  const maxKcal = Math.max(
    kcalTarget ?? 0,
    ...days.map((d) => d.totals.kcal),
    1,
  );

  // Build heatmap from the last 7 days no matter what window is selected
  // (week × nutrient is the most legible layout; a 90-day grid wouldn't
  // fit and a 14-day grid would still wrap awkwardly).
  // weekStrip injected via props
  const microRows: HeatmapRow[] = TARGETS.rows
    .filter((r) => r.group === "micro")
    .slice(0, 9)
    .map((r) => ({
      key: r.key,
      label: r.label,
      cells: weekStrip.map((d) => {
        const tgt = effectiveTarget(r);
        const actual = (d.totals[r.key as keyof NutritionFacts] as number | undefined) ?? 0;
        if (!tgt || tgt <= 0) return { ratio: null };
        if (d.meals_count === 0) return { ratio: null };
        return { ratio: actual / tgt };
      }),
    }));
  const heatmapCols = weekStrip.map((d) =>
    DOW_LABEL[new Date(d.date + "T12:00:00Z").getUTCDay()],
  );

  // Time-of-day scatter: x = local hour (0..24), y = meal kcal, size = grams total.
  const scatter = MEALS.map((m) => {
    const dt = new Date(m.user_meal_at);
    const hour = dt.getHours() + dt.getMinutes() / 60;
    const grams = m.components.reduce((s, c) => s + c.grams, 0);
    return { id: m.id, hour, kcal: m.totals.kcal, grams, kind: m.kind };
  });
  const scatterMax = Math.max(1, ...scatter.map((s) => s.kcal));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Trends"
        title="Wo bewegst du dich"
        sub="Gleitende Fenster. Lücken sind Lücken — keine Mahlzeit, kein Wert. Bewusst keine Glättung über Tagesgrenzen hinweg."
        trailing={
          <div className="inline-flex items-center gap-1 p-0.5 rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
            {([14, 30, 90] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindow(w)}
                className={cn(
                  "px-3 h-8 rounded-[var(--radius-pill)] text-caption num-mono transition-colors",
                  window === w
                    ? "bg-[var(--color-nutrition)] text-[var(--color-bg)] font-medium"
                    : "text-muted hover:text-[var(--color-text)]",
                )}
              >
                {w} d
              </button>
            ))}
          </div>
        }
      />

      <FadeRise>
        <Section eyebrow={`${window} Tage`} title="Makro-Stack">
          <Card>
            <CardBody className="p-5">
              <MacroBars days={days} maxKcal={maxKcal} kcalTarget={kcalTarget} />
            </CardBody>
          </Card>
        </Section>
      </FadeRise>

      <Section
        eyebrow="Letzte 7 Tage"
        title="Mikronährstoff-Heatmap"
        trailing={
          <Link
            href="/nutrition/targets"
            className="text-caption hover:text-[var(--color-text)] transition-colors"
          >
            Ziele bearbeiten →
          </Link>
        }
      >
        <Card>
          <CardBody className="p-5">
            <MicroHeatmap columns={heatmapCols} rows={microRows} />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Uhrzeit" title="Wann isst du">
        <Card>
          <CardBody className="p-5 flex flex-col gap-3">
            <ScatterChart
              points={scatter}
              max={scatterMax}
            />
            <div className="flex items-center gap-3 flex-wrap text-caption text-subtle">
              <LegendDot label="Frühstück" color="var(--color-nutrition)" />
              <LegendDot label="Mittag/Abend" color="var(--color-nutrition-2)" />
              <LegendDot label="Snack" color="var(--color-temp)" />
              <LegendDot label="Getränk" color="var(--color-spo2)" />
            </div>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function MacroBars({
  days,
  maxKcal,
  kcalTarget,
}: {
  days: Array<{ date: string; totals: NutritionFacts; meals: Meal[] }>;
  maxKcal: number;
  kcalTarget: number | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full">
        <div className="grid gap-[3px] items-end h-44" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((d) => {
            const p = d.totals.protein_g * 4;
            const c = d.totals.carbs_g * 4;
            const f = d.totals.fat_g * 9;
            const total = p + c + f;
            const total_kcal = d.totals.kcal;
            const heightPct = total_kcal > 0 ? (total_kcal / maxKcal) * 100 : 0;
            const pPct = total > 0 ? (p / total) * heightPct : 0;
            const cPct = total > 0 ? (c / total) * heightPct : 0;
            const fPct = total > 0 ? (f / total) * heightPct : 0;
            return (
              <Link
                key={d.date}
                href={`/nutrition/${d.date}`}
                className="relative h-full flex flex-col-reverse rounded-sm overflow-hidden hover:brightness-125 transition"
                title={`${d.date} · ${Math.round(total_kcal)} kcal · ${d.meals.length} Mahlzeiten`}
              >
                {d.meals.length === 0 ? (
                  <span
                    className="block w-full opacity-30 rounded-sm"
                    style={{ height: "4%", background: "var(--color-border)" }}
                  />
                ) : (
                  <>
                    <span className="block w-full" style={{ height: `${pPct}%`, background: "var(--color-nutrition)" }} />
                    <span className="block w-full" style={{ height: `${cPct}%`, background: "var(--color-nutrition-2)" }} />
                    <span className="block w-full" style={{ height: `${fPct}%`, background: "var(--color-temp)" }} />
                  </>
                )}
              </Link>
            );
          })}
        </div>
        {kcalTarget != null && (
          <span
            className="absolute left-0 right-0 border-t border-dashed border-[var(--color-nutrition)]/60 pointer-events-none"
            style={{ bottom: `${(kcalTarget / maxKcal) * 100}%` }}
          >
            <span className="absolute right-0 -top-4 num-mono text-[0.6875rem] text-[var(--color-nutrition)]/80">
              Ziel {kcalTarget}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-caption text-subtle">
        <LegendDot label="Eiweiß" color="var(--color-nutrition)" />
        <LegendDot label="Kohlenhydrate" color="var(--color-nutrition-2)" />
        <LegendDot label="Fett" color="var(--color-temp)" />
        <span className="ml-auto num-mono">{days.length} Tage</span>
      </div>
    </div>
  );
}

function ScatterChart({
  points,
  max,
}: {
  points: Array<{ id: string; hour: number; kcal: number; grams: number; kind: Meal["kind"] }>;
  max: number;
}) {
  const colorFor = (k: Meal["kind"]) =>
    k === "breakfast"
      ? "var(--color-nutrition)"
      : k === "snack"
      ? "var(--color-temp)"
      : k === "drink"
      ? "var(--color-spo2)"
      : "var(--color-nutrition-2)";

  return (
    <div className="relative w-full h-56 rounded-[var(--radius-chip)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-hidden">
      {/* horizontal gridlines */}
      {[0.25, 0.5, 0.75].map((y) => (
        <span
          key={y}
          className="absolute left-0 right-0 border-t border-[var(--color-border)]/40 border-dashed"
          style={{ top: `${y * 100}%` }}
        />
      ))}
      {/* hour ticks */}
      <div className="absolute inset-x-0 bottom-0 h-5 flex items-center justify-between px-2 text-[0.625rem] num-mono text-subtle pointer-events-none">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}</span>
        ))}
      </div>
      {points.map((p) => {
        const x = (p.hour / 24) * 100;
        const y = 100 - (p.kcal / max) * 90 - 5; // 5..95
        const size = Math.max(8, Math.min(22, p.grams / 18));
        return (
          <Link
            key={p.id}
            href={`/nutrition/meal/${p.id}`}
            className="absolute rounded-full grid place-items-center hover:ring-2 hover:ring-[var(--color-nutrition)]/40 transition"
            style={{
              left: `calc(${x}% - ${size / 2}px)`,
              top: `calc(${y}% - ${size / 2}px)`,
              width: size,
              height: size,
              background: colorFor(p.kind),
              opacity: 0.85,
              boxShadow: "var(--shadow-card)",
            }}
            title={`${p.kind} · ${Math.round(p.kcal)} kcal @ ${p.hour.toFixed(1)}h`}
          />
        );
      })}
      <span className="absolute top-2 right-2 text-[0.625rem] num-mono text-faint pointer-events-none">
        max {Math.round(max)} kcal
      </span>
    </div>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

const EMPTY: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function addFacts(a: NutritionFacts, b: NutritionFacts): NutritionFacts {
  const keys: Array<keyof NutritionFacts> = [
    "kcal","protein_g","carbs_g","fat_g","fiber_g","sugar_g","saturated_fat_g",
    "sodium_mg","iron_mg","calcium_mg","magnesium_mg","zinc_mg",
    "vit_c_mg","vit_d_ug","vit_b12_ug","folate_ug","omega3_g",
  ];
  const out: NutritionFacts = { ...EMPTY };
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (typeof av === "number" || typeof bv === "number") {
      (out as unknown as Record<string, number>)[k] = (av ?? 0) + (bv ?? 0);
    }
  }
  return out;
}
