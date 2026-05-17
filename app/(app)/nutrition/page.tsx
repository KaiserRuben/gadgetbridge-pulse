import "server-only";
import Link from "next/link";

// pulse.db is mutated continuously (uploads, classify results, edits). A
// statically-generated /nutrition would serve build-time HTML where photo_path
// can still be null — the page must re-render per request.
export const dynamic = "force-dynamic";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { IntakeRing } from "@/components/nutrition/IntakeRing";
import { MacroStack } from "@/components/nutrition/MacroStack";
import { MealCard } from "@/components/nutrition/MealCard";
import {
  effectiveTarget,
  getMealsForDate,
  getRecentMeals,
  getTargets,
  getTodayDate,
  getWeekStrip,
} from "@/lib/nutrition/data";
import { fmtClock, fmtDayLong } from "@/lib/nutrition/helpers";

const DOW_LABEL = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * /nutrition — landing surface. Sections, top-down:
 *   1. Header w/ "log meal" CTA (CTA is prominent but secondary to data).
 *   2. Today summary: IntakeRing + MacroStack + meal-count chips.
 *   3. 7-day strip: tiny bars + dot for meal count per day.
 *   4. Recent meals grid.
 */
export default function NutritionIndexPage() {
  const today = getTodayDate();
  const todayMeals = getMealsForDate(today);
  const todayTotals = todayMeals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.totals.kcal,
      protein_g: acc.protein_g + m.totals.protein_g,
      carbs_g: acc.carbs_g + m.totals.carbs_g,
      fat_g: acc.fat_g + m.totals.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const targets = getTargets();
  const kcalTarget = effectiveTarget(targets.rows.find((r) => r.key === "kcal")!);
  const proteinTarget = effectiveTarget(targets.rows.find((r) => r.key === "protein_g")!);
  const weekStrip = getWeekStrip(today, 7);
  const recent = getRecentMeals(8);

  // Strip scale: use the max kcal across the week, but at least the target
  // so a low-intake day doesn't visually stretch into "looks like full".
  const stripMax = Math.max(
    kcalTarget ?? 0,
    ...weekStrip.map((d) => d.totals.kcal),
    1,
  );

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>Ernährung</Eyebrow>
          <h1 className="text-hero">Was du heute gegessen hast</h1>
          <p className="text-body-sm text-muted max-w-[52ch]">
            Foto rein, Komponenten draußen. Nichts wird automatisch geglaubt — jede Mahlzeit
            ist ein Entwurf, bis du sie kurz prüfst.
          </p>
        </div>
        <Link
          href="/nutrition/log"
          className="self-start inline-flex items-center gap-2 px-4 h-11 rounded-[var(--radius-pill)] bg-[var(--color-nutrition)] text-[var(--color-bg)] font-medium hover:brightness-110 transition shadow-[0_8px_28px_-8px_hsl(346_48%_62%/0.55)]"
        >
          <Glyph name="Camera" size={16} />
          Mahlzeit erfassen
        </Link>
      </header>

      <FadeRise>
        <Card glow="nutrition">
          <CardBody className="p-5 lg:p-6 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
            <div className="grid place-items-center">
              <IntakeRing
                kcal={todayTotals.kcal}
                kcalTarget={kcalTarget}
                macros={todayTotals}
                size="md"
              />
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="nutrition" size="sm">
                  Heute · {fmtDayLong(today)}
                </Pill>
                <Pill tone="low" size="sm">
                  {todayMeals.length} Mahlzeit{todayMeals.length === 1 ? "" : "en"}
                </Pill>
                {todayMeals.some((m) => m.status === "pending") && (
                  <Pill tone="steady" size="sm">
                    <span className="animate-pulse">●</span> Klassifizierung läuft
                  </Pill>
                )}
              </div>
              <MacroStack
                protein_g={todayTotals.protein_g}
                carbs_g={todayTotals.carbs_g}
                fat_g={todayTotals.fat_g}
                kcal={todayTotals.kcal}
                kcalTarget={kcalTarget}
              />
              <div className="flex items-baseline gap-4 flex-wrap">
                {proteinTarget && (
                  <Snip
                    label="Eiweiß-Ziel"
                    value={`${Math.round(todayTotals.protein_g)} / ${proteinTarget} g`}
                    delta={Math.round(todayTotals.protein_g - proteinTarget)}
                  />
                )}
                <Snip
                  label="Letzte Mahlzeit"
                  value={
                    todayMeals.length
                      ? fmtClock(todayMeals[todayMeals.length - 1].user_meal_at)
                      : "—"
                  }
                />
                <Link
                  href={`/nutrition/${today}`}
                  className="ml-auto text-caption hover:text-[var(--color-text)] transition-colors"
                >
                  Tag im Detail →
                </Link>
              </div>
            </div>
          </CardBody>
        </Card>
      </FadeRise>

      <Section
        eyebrow="Letzte 7 Tage"
        title="Energieaufnahme"
        trailing={
          <Link
            href="/nutrition/trends"
            className="text-caption hover:text-[var(--color-text)] transition-colors"
          >
            Alle Trends →
          </Link>
        }
      >
        <Card>
          <CardBody className="p-5">
            <ol className="grid grid-cols-7 gap-2 items-end h-32">
              {weekStrip.map((d) => {
                const height = d.totals.kcal > 0 ? Math.max(6, (d.totals.kcal / stripMax) * 100) : 0;
                const overTarget = kcalTarget != null && d.totals.kcal > kcalTarget;
                const isToday = d.date === today;
                return (
                  <li key={d.date} className="flex flex-col items-center gap-1.5 h-full">
                    <Link
                      href={`/nutrition/${d.date}`}
                      className="flex flex-col items-stretch gap-1 flex-1 w-full justify-end group"
                    >
                      <span
                        className="num-mono text-[0.625rem] text-subtle text-center"
                        style={{ visibility: d.totals.kcal > 0 ? "visible" : "hidden" }}
                      >
                        {Math.round(d.totals.kcal)}
                      </span>
                      <span
                        className="w-full rounded-md transition-all duration-300 group-hover:brightness-125"
                        style={{
                          height: `${height}%`,
                          background: overTarget
                            ? "linear-gradient(180deg, var(--color-temp), var(--color-nutrition-2))"
                            : "linear-gradient(180deg, var(--color-nutrition), var(--color-nutrition-2))",
                          opacity: d.totals.kcal === 0 ? 0.2 : 1,
                        }}
                      />
                    </Link>
                    <span
                      className={
                        "text-[0.625rem] uppercase tracking-[0.16em] " +
                        (isToday ? "text-[var(--color-nutrition)] font-medium" : "text-subtle")
                      }
                    >
                      {DOW_LABEL[new Date(d.date + "T12:00:00Z").getUTCDay()]}
                    </span>
                    <span className="num-mono text-[0.5625rem] text-faint">
                      {d.meals_count} ●
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      </Section>

      <Section
        eyebrow="Letzte Mahlzeiten"
        title={`${recent.length} aufgenommen`}
        trailing={
          <Link
            href="/nutrition/log"
            className="text-caption hover:text-[var(--color-text)] transition-colors"
          >
            Neue erfassen →
          </Link>
        }
      >
        {recent.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-8 grid place-items-center gap-3 text-center">
              <span className="grid place-items-center size-12 rounded-2xl bg-[hsl(346_40%_18%)] border border-[hsl(346_36%_28%)] text-[var(--color-nutrition)]">
                <Glyph name="ImagePlus" size={20} />
              </span>
              <div className="flex flex-col gap-1 max-w-[40ch]">
                <span className="text-title">Noch keine Mahlzeit erfasst</span>
                <span className="text-caption text-muted">
                  Foto, Text oder beides — der Klassifizierer macht aus dem Foto Komponenten,
                  die du anschließend gegenchecken kannst.
                </span>
              </div>
              <Link
                href="/nutrition/log"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-pill)] bg-[var(--color-nutrition)] text-[var(--color-bg)] font-medium hover:brightness-110"
              >
                <Glyph name="Camera" size={14} />
                Erste Mahlzeit erfassen
              </Link>
            </CardBody>
          </Card>
        ) : (
          <Stagger
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3"
            step={0.04}
          >
            {recent.map((m) => (
              <StaggerItem key={m.id}>
                <MealCard meal={m} layout="tile" />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </Section>

      <footer className="flex items-center gap-3 text-caption text-subtle border-t border-[var(--color-border)] pt-4 mt-2">
        <Link
          href="/nutrition/trends"
          className="hover:text-[var(--color-text)] transition-colors"
        >
          Trends
        </Link>
        <span className="text-faint">·</span>
        <Link
          href="/nutrition/targets"
          className="hover:text-[var(--color-text)] transition-colors"
        >
          Ziele
        </Link>
        <span className="text-faint">·</span>
        <span>Ernährungs-Cluster läuft asynchron auf dem Mac.</span>
      </footer>
    </div>
  );
}

function Snip({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[0.9375rem] font-semibold">{value}</span>
        {delta != null && (
          <span
            className={
              "num-mono text-[0.6875rem] " +
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
}

