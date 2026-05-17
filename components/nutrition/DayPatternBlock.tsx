/**
 * Aggregate-only nutrition block, rendered at the bottom of /day/[date].
 *
 * Smart-hide rules (NUTRITION_PLAN.md §7):
 *   1. day_end has fired AND
 *   2. at least one meal is logged for the day.
 * Otherwise the block omits itself entirely — no empty state, no CTA.
 *
 * Pure server-renderable: takes a fully-resolved DayPatternBlock prop.
 */

import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { MacroStack } from "./MacroStack";
import type { DayPatternBlock as Data, NutritionTargets } from "@/lib/nutrition/types";
import { effectiveTarget } from "@/lib/nutrition/helpers";

export function DayPatternBlock({
  data,
  targets,
}: {
  data: Data;
  targets: NutritionTargets;
}) {
  // Smart-hide.
  if (!data.day_complete || data.meals_count === 0) return null;

  const kcalTarget = effectiveTarget(targets.rows.find((r) => r.key === "kcal")!);

  // Show 3 most-relevant nutrient deltas, biggest |delta|/target first.
  const deltaChips = targets.rows
    .filter((r) => effectiveTarget(r) != null)
    .map((r) => {
      const tgt = effectiveTarget(r)!;
      const actual =
        data.totals[r.key as keyof typeof data.totals] as number | undefined;
      if (typeof actual !== "number") return null;
      return {
        key: r.key,
        label: r.label,
        unit: r.unit,
        delta: Math.round(actual - tgt),
        ratio: tgt > 0 ? Math.abs(actual - tgt) / tgt : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);

  return (
    <section data-testid="day-nutrition-aggregate" className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Ernährung</Eyebrow>
          <h2 className="text-title">Tagesbild</h2>
        </div>
        <Link
          href={`/nutrition/${data.period_key}`}
          className="text-caption hover:text-[var(--color-text)] transition-colors"
        >
          Voller Tag →
        </Link>
      </header>

      <Card glow="nutrition">
        <CardBody className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
            <MacroStack
              protein_g={data.totals.protein_g}
              carbs_g={data.totals.carbs_g}
              fat_g={data.totals.fat_g}
              kcal={data.totals.kcal}
              kcalTarget={kcalTarget}
            />
            <div className="flex flex-wrap gap-1.5 self-end content-end justify-end">
              <span className="num-mono text-[0.625rem] uppercase tracking-[0.16em] text-subtle w-full text-right md:text-left">
                Δ Ziel
              </span>
              {deltaChips.map((d) => (
                <DeltaChip key={d.key} label={d.label} value={d.delta} unit={d.unit} />
              ))}
            </div>
          </div>

          {data.events.length > 0 && (
            <div className="flex flex-col gap-2.5 pt-3 border-t border-[var(--color-border)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="num-mono text-[0.625rem] uppercase tracking-[0.16em] text-subtle">
                  Ereignisse · {data.events.length}
                </span>
                <span className="num-mono text-caption text-subtle">
                  {data.meals_count} Einträge
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {data.events.map((ev, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="grid place-items-center size-7 rounded-lg bg-[hsl(346_40%_18%)] border border-[hsl(346_36%_28%)] text-[var(--color-nutrition)] shrink-0">
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
                      <span className="text-[0.875rem] leading-snug">
                        {ev.summary}
                      </span>
                      <span className="num-mono text-caption text-subtle">
                        {fmtClock(ev.started_at)} – {fmtClock(ev.ended_at)} ·{" "}
                        {ev.meal_ids.length}{" "}
                        {ev.meal_ids.length === 1 ? "Eintrag" : "Einträge"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.flags.length > 0 && (
            <div className="flex items-start gap-3 pt-3 border-t border-[var(--color-border)]">
              <span className="grid place-items-center size-7 rounded-lg bg-[hsl(28_60%_18%)] border border-[hsl(28_56%_28%)] text-[var(--color-tier-s2)] shrink-0">
                <Glyph name="AlertTriangle" size={14} />
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.875rem]">Hinweise</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {data.flags.map((f) => (
                    <Pill key={f} tone="s2" size="sm">
                      {flagLabel(f)}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

function DeltaChip({ label, value, unit }: { label: string; value: number; unit: string }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const tone =
    value > 0
      ? "bg-[hsl(195_50%_18%)] text-[var(--color-band-up)] ring-[hsl(195_46%_28%)]"
      : value < 0
      ? "bg-[hsl(38_50%_18%)] text-[var(--color-band-down)] ring-[hsl(38_46%_28%)]"
      : "bg-[hsl(220_18%_18%)] text-[var(--color-band-steady)] ring-[hsl(220_18%_28%)]";
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 px-2 h-7 rounded-[var(--radius-pill)] ring-1 ring-inset ${tone}`}
    >
      <span className="text-[0.6875rem] uppercase tracking-[0.16em] font-medium">{label}</span>
      <span className="num-mono text-[0.75rem]">
        {sign}
        {Math.abs(value)} {unit}
      </span>
    </span>
  );
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function flagLabel(f: string): string {
  if (f === "possible_unlogged_evening") return "Mögliche unprotokollierte Abend-Mahlzeit";
  if (f === "no_meals_logged") return "Keine Mahlzeiten erfasst";
  return f;
}

// ── Alias export ──────────────────────────────────────────────────────
//
// `DayNutritionAggregate` is the public name used by the day page wiring
// (see NUTRITION_PLAN §7). `DayPatternBlock` is the internal component
// name; both point at the same renderer so the day page can import the
// aggregate via its plan-aligned identifier without a second file.
export { DayPatternBlock as DayNutritionAggregate };
