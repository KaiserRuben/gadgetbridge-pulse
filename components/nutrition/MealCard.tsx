"use client";

/**
 * Compact meal card: 16:9 photo + summary line. Used in the recent-meals
 * grid on /nutrition and the day timeline on /nutrition/[date].
 *
 * Photo falls back to a tinted glyph block when the path 404s so the
 * layout stays intact during the placeholder-route gap (placeholder route
 * handler ships in a later phase).
 */

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import type { Meal } from "@/lib/nutrition/types";
import { mealPhotoUrl } from "@/lib/nutrition/helpers";
import { cn } from "@/lib/cn";

export function MealCard({
  meal,
  layout = "tile",
  className,
}: {
  meal: Meal;
  layout?: "tile" | "row";
  className?: string;
}) {
  if (layout === "row") return <MealRow meal={meal} className={className} />;
  return <MealTile meal={meal} className={className} />;
}

function MealTile({ meal, className }: { meal: Meal; className?: string }) {
  const pending = meal.status === "pending";
  return (
    <Link href={`/nutrition/meal/${meal.id}`} className={cn("block group", className)}>
      <Card hoverable className="overflow-hidden h-full">
        <MealPhoto meal={meal} ratio="aspect-[4/3]" />
        <div className="p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.8125rem] font-medium truncate">
              {kindLabel(meal.kind)}
            </span>
            <span className="num-mono text-caption shrink-0">
              {fmtClock(meal.user_meal_at)}
            </span>
          </div>
          {pending ? (
            <div className="flex flex-col gap-1.5">
              <div className="h-3.5 w-16 rounded-md skeleton" />
              <div className="h-2.5 w-28 rounded-md skeleton" />
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="num text-[1rem] font-semibold">
                  {Math.round(meal.totals.kcal)}
                </span>
                <span className="text-subtle text-[0.625rem] num-mono">kcal</span>
              </div>
              <span className="num-mono text-caption text-muted">
                {Math.round(meal.totals.protein_g)} P · {Math.round(meal.totals.carbs_g)} K · {Math.round(meal.totals.fat_g)} F
              </span>
            </div>
          )}
          {meal.user_text && (
            <p className="text-caption text-muted leading-snug line-clamp-2">
              „{meal.user_text}"
            </p>
          )}
          {pending && (
            <Pill tone="nutrition" size="sm">
              <span className="animate-pulse">●</span> Wird klassifiziert
            </Pill>
          )}
        </div>
      </Card>
    </Link>
  );
}

function MealRow({ meal, className }: { meal: Meal; className?: string }) {
  const pending = meal.status === "pending";
  const noPhoto = meal.photo_path == null;
  return (
    <Link href={`/nutrition/meal/${meal.id}`} className={cn("block group", className)}>
      <Card hoverable>
        <div className="flex items-stretch gap-3 p-3">
          <div className="size-16 shrink-0 rounded-[var(--radius-chip)] overflow-hidden relative">
            <MealPhoto meal={meal} ratio="absolute inset-0" rounded="rounded-[var(--radius-chip)]" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-0 justify-center">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.875rem] font-medium truncate">
                {kindLabel(meal.kind)}
                {noPhoto && (
                  <span className="num-mono text-[0.625rem] uppercase tracking-[0.16em] text-subtle ml-2">
                    nur Text
                  </span>
                )}
              </span>
              <span className="num-mono text-caption shrink-0">{fmtClock(meal.user_meal_at)}</span>
            </div>
            {pending ? (
              <div className="flex items-center gap-2">
                <Pill tone="nutrition" size="sm">
                  <span className="animate-pulse">●</span> Wird klassifiziert
                </Pill>
                <div className="h-2.5 w-32 rounded-md skeleton" />
              </div>
            ) : (
              <div className="flex items-baseline gap-3 text-caption">
                <span className="num">
                  <span className="font-semibold text-[var(--color-text)]">
                    {Math.round(meal.totals.kcal)}
                  </span>{" "}
                  <span className="num-mono text-subtle">kcal</span>
                </span>
                <span className="num-mono text-muted">
                  {Math.round(meal.totals.protein_g)} P · {Math.round(meal.totals.carbs_g)} K · {Math.round(meal.totals.fat_g)} F
                </span>
              </div>
            )}
            {meal.user_text && (
              <p className="text-caption text-muted leading-snug line-clamp-1">
                „{meal.user_text}"
              </p>
            )}
            {!pending && meal.components.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {meal.components.slice(0, 3).map((c) => (
                  <span
                    key={c.id}
                    className="num-mono text-[0.625rem] px-1.5 py-0.5 rounded-[var(--radius-chip)] bg-[var(--color-surface-2)] border border-[var(--color-border)] text-muted"
                  >
                    {c.label} · {Math.round(c.grams)} g
                  </span>
                ))}
                {meal.components.length > 3 && (
                  <span className="text-caption text-subtle">+{meal.components.length - 3}</span>
                )}
              </div>
            )}
          </div>
          <Glyph name="ChevronRight" size={14} className="text-faint self-center" />
        </div>
      </Card>
    </Link>
  );
}

function MealPhoto({
  meal,
  ratio,
  rounded,
}: {
  meal: Meal;
  ratio: string;
  rounded?: string;
}) {
  const [errored, setErrored] = useState(false);
  const url = mealPhotoUrl(meal);
  const pending = meal.status === "pending";
  const minConf = meal.components.length
    ? Math.min(...meal.components.map((c) => c.confidence ?? 1))
    : 1;

  // Pending photo: render a shimmer over the gradient so the card has
  // visible motion while the VLM is busy.
  if (pending && url) {
    return (
      <div
        className={cn(
          ratio,
          rounded,
          "relative overflow-hidden bg-[var(--color-surface-2)]",
        )}
      >
        <div className="absolute inset-0 skeleton opacity-80" />
        <div className="absolute inset-0 grid place-items-center">
          <Glyph
            name="Sparkles"
            size={22}
            className="text-[var(--color-nutrition)] animate-pulse"
          />
        </div>
      </div>
    );
  }

  if (!url || errored) {
    return (
      <div
        className={cn(
          ratio,
          rounded,
          "relative grid place-items-center overflow-hidden",
        )}
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 30% 20%, color-mix(in srgb, var(--color-nutrition) 40%, var(--color-bg)), color-mix(in srgb, var(--color-nutrition-2) 24%, var(--color-bg)))",
        }}
      >
        <Glyph
          name={meal.user_text && meal.components.length > 0 && !meal.photo_path ? "PenLine" : kindGlyph(meal.kind)}
          size={28}
          className="text-[var(--color-nutrition)] opacity-70"
        />
      </div>
    );
  }
  return (
    <div className={cn(ratio, rounded, "relative overflow-hidden bg-[var(--color-surface-2)]")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${kindLabel(meal.kind)} · ${meal.user_text ?? meal.components.map((c) => c.label).join(", ")}`}
        loading="lazy"
        onError={() => setErrored(true)}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
      {minConf < 0.5 && (
        <div className="absolute top-2 left-2">
          <Pill tone="s2" size="sm">unsicher</Pill>
        </div>
      )}
    </div>
  );
}

function kindGlyph(k: Meal["kind"]): GlyphName {
  if (k === "breakfast") return "Sunrise";
  if (k === "drink") return "Wine";
  if (k === "snack") return "Croissant";
  return "Utensils";
}

function kindLabel(k: Meal["kind"]): string {
  return k === "breakfast"
    ? "Frühstück"
    : k === "lunch"
    ? "Mittag"
    : k === "dinner"
    ? "Abendessen"
    : k === "snack"
    ? "Snack"
    : "Getränk";
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
