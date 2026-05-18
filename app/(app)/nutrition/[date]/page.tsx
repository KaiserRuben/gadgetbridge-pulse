import "server-only";
import Link from "next/link";

export const dynamic = "force-dynamic";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { IntakeRing } from "@/components/nutrition/IntakeRing";
import { MealCard } from "@/components/nutrition/MealCard";
import {
  effectiveTarget,
  getDayPattern,
  getMealsForDate,
  getTargets,
} from "@/lib/nutrition/data";
import { fmtClock, fmtDayHeading } from "@/lib/nutrition/helpers";
import type { NutrientTarget } from "@/lib/nutrition/types";
import type { NutritionFacts } from "@/lib/nutrition/types";
import { cn } from "@/lib/cn";

/**
 * /nutrition/[date] — timeline of meals + macro totals + micronutrient
 * mini-bars + day_pattern prose section.
 *
 * The micronutrient block is the workhorse of "what was I deficient in
 * today" — every nutrient with a target gets a thin bar from 0..target,
 * coloured by ratio.
 */
export default async function NutritionDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <NotADate />;

  const meals = getMealsForDate(date);
  const totals = meals.reduce(
    (acc, m) => addFacts(acc, m.totals),
    EMPTY_FACTS,
  );
  const targets = getTargets();
  const kcalTarget = effectiveTarget(targets.rows.find((r) => r.key === "kcal")!);
  const pattern = getDayPattern(date);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Ernährung · Tag</Eyebrow>
          <h1 className="text-[1.25rem] sm:text-[1.5rem] md:text-[1.625rem] font-semibold tracking-[-0.02em]">
            {fmtDayHeading(date)}
          </h1>
          <span className="text-caption text-subtle num-mono">{date}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/nutrition"
            className="text-caption hover:text-[var(--color-text)] transition-colors"
          >
            ← Übersicht
          </Link>
          <Link
            href="/nutrition/log"
            className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-pill)] bg-[var(--color-nutrition)] text-[var(--color-bg)] text-caption font-medium hover:brightness-110"
          >
            <Glyph name="Camera" size={14} />
            Mahlzeit
          </Link>
        </div>
      </header>

      <FadeRise>
        <Card glow="nutrition">
          <CardBody className="p-5 lg:p-6 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
            <IntakeRing
              kcal={totals.kcal}
              kcalTarget={kcalTarget}
              macros={totals}
              size="md"
            />
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="nutrition" size="sm">
                  {meals.length} Mahlzeit{meals.length === 1 ? "" : "en"}
                </Pill>
                {pattern.day_complete ? (
                  <Pill tone="up" size="sm">Tag abgeschlossen</Pill>
                ) : (
                  <Pill tone="steady" size="sm">Wird heute Nacht berechnet</Pill>
                )}
                {pattern.events.length > 1 && (
                  <Pill tone="low" size="sm">
                    {pattern.events.length} Ereignisse
                  </Pill>
                )}
              </div>
              <MacroSplitGrid totals={totals} targetRows={targets.rows} />
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Verlauf" title="Mahlzeiten im Tag">
        {meals.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-6 text-center text-caption text-muted">
              Keine Mahlzeiten an diesem Tag erfasst.
            </CardBody>
          </Card>
        ) : (
          <Timeline meals={meals} pattern={pattern} />
        )}
      </Section>

      <Section eyebrow="Mikronährstoffe" title="Heute vs Ziel">
        <Card>
          <CardBody className="p-5">
            <MicroBars totals={totals} targetRows={targets.rows} />
          </CardBody>
        </Card>
      </Section>

      {pattern.events.length > 0 && pattern.day_complete && (
        <Section eyebrow="Muster" title="Tagesbild">
          <Card variant="flat">
            <CardBody className="p-5 flex flex-col gap-2">
              {pattern.events.map((ev, i) => (
                <div key={i} className="flex items-start gap-3 py-1.5">
                  <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[hsl(346_40%_18%)] border border-[hsl(346_36%_28%)] text-[var(--color-nutrition)]">
                    <Glyph
                      name={
                        ev.kind === "drink_round"
                          ? "Wine"
                          : ev.kind === "snacking"
                          ? "Croissant"
                          : ev.kind === "multi_course"
                          ? "Utensils"
                          : "Sunrise"
                      }
                      size={14}
                    />
                  </span>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[0.875rem]">{ev.summary}</span>
                    <span className="num-mono text-caption text-subtle">
                      {fmtClock(ev.started_at)} – {fmtClock(ev.ended_at)} · {ev.meal_ids.length} Eintrag
                      {ev.meal_ids.length === 1 ? "" : "/Einträge"}
                    </span>
                  </div>
                </div>
              ))}
              {pattern.flags.length > 0 && (
                <div className="flex items-start gap-3 py-1.5 pt-3 border-t border-[var(--color-border)]">
                  <span className="grid place-items-center size-8 shrink-0 rounded-xl bg-[hsl(28_60%_18%)] border border-[hsl(28_56%_28%)] text-[var(--color-tier-s2)]">
                    <Glyph name="AlertTriangle" size={14} />
                  </span>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <span className="text-[0.875rem]">Hinweise des Tages-Clusters</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {pattern.flags.map((f) => (
                        <Pill key={f} tone="s2" size="sm">
                          {dayFlagLabel(f)}
                        </Pill>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}

function Timeline({
  meals,
  pattern,
}: {
  meals: ReturnType<typeof getMealsForDate>;
  pattern: ReturnType<typeof getDayPattern>;
}) {
  // Build a lookup of meal_id → cluster (multi_course | snacking | drink_round)
  // with its position so we can draw a left-side bracket connector across
  // the grouped items. Singleton events get no decoration.
  type Cluster = {
    kind: "multi_course" | "snacking" | "drink_round";
    size: number;
    label: string;
    summary: string;
  };
  const clusterByMeal = new Map<
    string,
    { cluster: Cluster; position: "start" | "middle" | "end" }
  >();
  for (const ev of pattern.events) {
    if (ev.meal_ids.length < 2) continue;
    if (
      ev.kind !== "multi_course" &&
      ev.kind !== "snacking" &&
      ev.kind !== "drink_round"
    ) {
      continue;
    }
    const label =
      ev.kind === "multi_course"
        ? "Mehrgang"
        : ev.kind === "drink_round"
        ? "Getränke-Runde"
        : "Grazing-Fenster";
    const cluster: Cluster = {
      kind: ev.kind,
      size: ev.meal_ids.length,
      label,
      summary: ev.summary,
    };
    ev.meal_ids.forEach((mealId, idx) => {
      clusterByMeal.set(mealId, {
        cluster,
        position:
          idx === 0
            ? "start"
            : idx === ev.meal_ids.length - 1
            ? "end"
            : "middle",
      });
    });
  }

  return (
    <Stagger className="flex flex-col gap-2" step={0.04}>
      {meals.map((m) => {
        const entry = clusterByMeal.get(m.id);
        return (
          <StaggerItem key={m.id}>
            {entry ? (
              <ClusterRow
                meal={m}
                cluster={entry.cluster}
                position={entry.position}
              />
            ) : (
              <div className="grid grid-cols-[18px_1fr] gap-2 items-stretch">
                <span />
                <MealCard meal={m} layout="row" />
              </div>
            )}
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

function ClusterRow({
  meal,
  cluster,
  position,
}: {
  meal: ReturnType<typeof getMealsForDate>[number];
  cluster: {
    kind: "multi_course" | "snacking" | "drink_round";
    size: number;
    label: string;
    summary: string;
  };
  position: "start" | "middle" | "end";
}) {
  return (
    <div className="grid grid-cols-[18px_1fr] gap-2 items-stretch">
      <div className="relative">
        {/* Vertical bracket spine — full row height, trimmed at start/end */}
        <span
          className="absolute left-1/2 -translate-x-1/2 w-px bg-[var(--color-nutrition)]/45"
          style={{
            top: position === "start" ? "50%" : 0,
            bottom: position === "end" ? "50%" : 0,
          }}
        />
        {/* Horizontal stub from spine into the card */}
        <span
          className="absolute left-1/2 right-[-8px] h-px bg-[var(--color-nutrition)]/45"
          style={{ top: "50%" }}
        />
        {/* Node dot */}
        <span
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
            position === "middle"
              ? "size-1.5 bg-[var(--color-nutrition)]/70"
              : "size-2 bg-[var(--color-nutrition)] ring-2 ring-[var(--color-bg)]",
          )}
        />
      </div>
      <div className="flex flex-col gap-1">
        {position === "start" && (
          <div className="flex items-center gap-2 pl-1">
            <span className="inline-flex items-center gap-1.5 px-2 h-5 rounded-[var(--radius-pill)] bg-[hsl(346_40%_18%)] ring-1 ring-inset ring-[hsl(346_36%_28%)] text-[0.625rem] uppercase tracking-[0.16em] text-[var(--color-nutrition)] font-medium">
              <Glyph
                name={
                  cluster.kind === "drink_round"
                    ? "Wine"
                    : cluster.kind === "snacking"
                    ? "Croissant"
                    : "Utensils"
                }
                size={10}
              />
              {cluster.label} · {cluster.size}
            </span>
            <span className="text-caption text-subtle truncate">
              {cluster.summary}
            </span>
          </div>
        )}
        <MealCard meal={meal} layout="row" />
      </div>
    </div>
  );
}

function MacroSplitGrid({
  totals,
  targetRows,
}: {
  totals: NutritionFacts;
  targetRows: NutrientTarget[];
}) {
  const macros: Array<{ key: keyof NutritionFacts; label: string; unit: string; targetKey: string }> = [
    { key: "kcal", label: "Energie", unit: "kcal", targetKey: "kcal" },
    { key: "protein_g", label: "Eiweiß", unit: "g", targetKey: "protein_g" },
    { key: "carbs_g", label: "Kohlenhydrate", unit: "g", targetKey: "carbs_g" },
    { key: "fat_g", label: "Fett", unit: "g", targetKey: "fat_g" },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {macros.map((m) => {
        const target = effectiveTarget(
          targetRows.find((r) => r.key === m.targetKey)!,
        );
        const actual = (totals[m.key] as number | undefined) ?? 0;
        const delta = target != null ? Math.round(actual - target) : null;
        return (
          <div key={m.key} className="flex flex-col gap-1">
            <Eyebrow>{m.label}</Eyebrow>
            <div className="flex items-baseline gap-1">
              <span className="num text-[1.5rem] font-semibold tracking-[-0.02em]">
                {Math.round(actual)}
              </span>
              <span className="text-subtle text-[0.625rem] num-mono">{m.unit}</span>
            </div>
            <div className="flex items-center gap-1.5 text-caption">
              {target != null && (
                <span className="num-mono text-subtle">/ {target}</span>
              )}
              {delta != null && (
                <span
                  className={
                    "num-mono " +
                    (delta > 0
                      ? "text-[var(--color-band-up)]"
                      : delta < 0
                      ? "text-[var(--color-band-down)]"
                      : "text-subtle")
                  }
                >
                  {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                  {Math.abs(delta)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MicroBars({
  totals,
  targetRows,
}: {
  totals: NutritionFacts;
  targetRows: NutrientTarget[];
}) {
  const rows = targetRows.filter((r) => r.group === "micro");
  return (
    <ol className="grid grid-cols-1 md:grid-cols-2 gap-3 gap-x-8">
      {rows.map((r) => {
        const target = effectiveTarget(r);
        const actual = (totals[r.key as keyof NutritionFacts] as number | undefined) ?? 0;
        const ratio = target && target > 0 ? actual / target : 0;
        const pct = Math.max(0, Math.min(120, Math.round(ratio * 100)));
        const over = ratio >= 1;
        return (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.8125rem] truncate">{r.label}</span>
              <span className="num-mono text-caption text-subtle">
                <span className="text-[var(--color-text)] font-medium num">
                  {round1(actual)}
                </span>{" "}
                / {target} {r.unit}
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden border border-[var(--color-border)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                style={{
                  width: `${Math.min(100, pct)}%`,
                  background: over
                    ? "linear-gradient(90deg, var(--color-nutrition), var(--color-nutrition-2))"
                    : ratio >= 0.5
                    ? "linear-gradient(90deg, hsl(346 36% 36%), var(--color-nutrition))"
                    : "var(--color-band-down)",
                }}
              />
              {over && pct > 100 && (
                <div
                  className="absolute inset-y-0 right-0 rounded-full"
                  style={{
                    width: `${pct - 100}%`,
                    background: "var(--color-nutrition-2)",
                    opacity: 0.6,
                  }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}


function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dayFlagLabel(f: string): string {
  if (f === "possible_unlogged_evening") return "Mögliche unprotokollierte Abend-Mahlzeit";
  if (f === "no_meals_logged") return "Keine Mahlzeiten erfasst";
  return f;
}

const EMPTY_FACTS: NutritionFacts = {
  kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
};

function addFacts(a: NutritionFacts, b: NutritionFacts): NutritionFacts {
  const keys: Array<keyof NutritionFacts> = [
    "kcal","protein_g","carbs_g","fat_g","fiber_g","sugar_g","saturated_fat_g",
    "sodium_mg","iron_mg","calcium_mg","magnesium_mg","zinc_mg",
    "vit_c_mg","vit_d_ug","vit_b12_ug","folate_ug","omega3_g",
  ];
  const out: NutritionFacts = { ...EMPTY_FACTS };
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (typeof av === "number" || typeof bv === "number") {
      (out as unknown as Record<string, number>)[k] = (av ?? 0) + (bv ?? 0);
    }
  }
  return out;
}

function NotADate() {
  return (
    <Card>
      <CardBody className="p-8">
        <h1 className="text-hero">Kein gültiges Datum</h1>
        <p className="text-body text-muted">
          Format erwartet: <code className="num-mono">YYYY-MM-DD</code>.
        </p>
      </CardBody>
    </Card>
  );
}
