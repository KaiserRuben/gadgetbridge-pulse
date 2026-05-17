import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { MealReviewForm } from "@/components/nutrition/MealReviewForm";
import { MealHeroPhoto } from "@/components/nutrition/MealHeroPhoto";
import { MealPhotoGallery } from "@/components/nutrition/MealPhotoGallery";
import { getMealById } from "@/lib/nutrition/data";
import { fmtDateTime } from "@/lib/nutrition/helpers";

export default async function MealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meal = getMealById(id);
  if (!meal) notFound();

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Mahlzeit</Eyebrow>
          <h1 className="text-hero">{kindLabel(meal.kind)}</h1>
          <span className="text-caption text-subtle num-mono">
            {fmtDateTime(meal.user_meal_at)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/nutrition/${meal.period_key}`}
            className="text-caption hover:text-[var(--color-text)] transition-colors"
          >
            ← Tag
          </Link>
        </div>
      </header>

      <FadeRise>
        <Card glow="nutrition" className="overflow-hidden">
          <div className="relative aspect-[16/9] md:aspect-[2/1] bg-[var(--color-surface-2)]">
            {meal.photos.length > 0 ? (
              <MealPhotoGallery
                mealId={meal.id}
                photos={meal.photos.map((p) => ({ ord: p.ord, kind: p.kind }))}
                altBase={meal.user_text ?? meal.components.map((c) => c.label).join(", ")}
                pending={meal.status === "pending"}
              />
            ) : (
              // Fallback for legacy rows that predate M010 — the gallery
              // component itself handles the no-photo / errored paths, but
              // this branch keeps the old MealHeroPhoto in case a meal row
              // still has photo_path set without a PULSE_MEAL_PHOTO entry.
              <MealHeroPhoto
                photoPath={meal.photo_path ? `/api/nutrition/photo/${meal.id}` : null}
                alt={meal.user_text ?? meal.components.map((c) => c.label).join(", ")}
                pending={meal.status === "pending"}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
            <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 flex-wrap">
              <Pill tone="nutrition" size="sm">
                {sourceLabel(meal.source)}
              </Pill>
              <Pill
                tone={
                  meal.status === "edited"
                    ? "up"
                    : meal.status === "pending"
                    ? "nutrition"
                    : meal.status === "failed"
                    ? "s1"
                    : "low"
                }
                size="sm"
              >
                {meal.status === "pending" && <span className="animate-pulse">●</span>}
                {statusLabel(meal.status)}
              </Pill>
            </div>
            <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-0.5 max-w-[60ch]">
                {meal.user_text && (
                  <p className="text-[0.9375rem] font-medium text-white drop-shadow leading-snug">
                    „{meal.user_text}"
                  </p>
                )}
                {meal.notes && (
                  <p className="text-caption text-white/80 drop-shadow">{meal.notes}</p>
                )}
              </div>
              {meal.status !== "pending" ? (
                <div className="flex items-baseline gap-3 num-mono text-caption text-white/90">
                  <span>
                    <span className="num text-[1.5rem] font-semibold text-white">
                      {Math.round(meal.totals.kcal)}
                    </span>{" "}
                    kcal
                  </span>
                  <span>{Math.round(meal.totals.protein_g)} P</span>
                  <span>{Math.round(meal.totals.carbs_g)} K</span>
                  <span>{Math.round(meal.totals.fat_g)} F</span>
                </div>
              ) : (
                <span className="num-mono text-caption text-white/80">
                  Komponenten erscheinen, sobald die VLM fertig ist.
                </span>
              )}
            </div>
          </div>
        </Card>
      </FadeRise>

      <Section
        eyebrow="Komponenten"
        title={`${meal.components.length} erkannt`}
        trailing={
          <span className="text-caption text-subtle text-right max-w-[24ch] leading-tight hidden sm:block">
            jede Anpassung wird in der Historie protokolliert
          </span>
        }
      >
        <MealReviewForm initial={meal.components} />
      </Section>

      <Section eyebrow="Historie" title="Revisionen">
        {meal.revisions.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-4 text-caption text-muted">
              Keine Änderungen seit der Klassifizierung.
            </CardBody>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {meal.revisions.map((r) => (
              <li key={r.id}>
                <Card variant="flat">
                  <CardBody className="p-3 flex items-center gap-3">
                    <span className="grid place-items-center size-8 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-subtle shrink-0">
                      <Glyph name={r.by === "vlm" ? "Sparkles" : "PenLine"} size={14} />
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-[0.8125rem]">{r.diff_summary}</span>
                      <span className="num-mono text-caption text-subtle">
                        {fmtDateTime(r.created_at)} · {r.by === "vlm" ? "VLM-Reklassifizierung" : "Benutzer"}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section eyebrow="Aktionen" title="Mahlzeit verwalten">
        <Card variant="soft">
          <CardBody className="p-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)] bg-[var(--color-surface-2)] border border-[var(--color-border)] text-caption hover:border-[var(--color-nutrition)]/60 transition-colors"
            >
              <Glyph name="Sparkles" size={14} className="text-[var(--color-nutrition)]" />
              Neu klassifizieren (VLM)
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)] bg-[var(--color-surface-2)] border border-[var(--color-border)] text-caption hover:border-[var(--color-border-strong)] transition-colors"
            >
              <Glyph name="PenLine" size={14} className="text-subtle" />
              Notiz hinzufügen
            </button>
            <span className="flex-1" />
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)] text-caption text-[var(--color-tier-s1)] hover:bg-[hsl(4_40%_18%)]/60 transition-colors"
            >
              <Glyph name="Trash2" size={14} />
              Löschen
            </button>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function kindLabel(k: ReturnType<typeof getMealById> extends infer M ? M extends { kind: infer K } ? K : never : never): string {
  switch (k) {
    case "breakfast": return "Frühstück";
    case "lunch":     return "Mittagessen";
    case "dinner":    return "Abendessen";
    case "snack":     return "Snack";
    case "drink":     return "Getränk";
    default:          return String(k);
  }
}

function statusLabel(s: string): string {
  return s === "classified" ? "klassifiziert"
       : s === "edited" ? "bearbeitet"
       : s === "pending" ? "wird verarbeitet"
       : s === "failed" ? "fehlgeschlagen"
       : s;
}

function sourceLabel(s: string): string {
  return s === "photo" ? "Foto"
       : s === "text" ? "Text"
       : s === "photo+text" ? "Foto + Text"
       : s === "manual" ? "manuell"
       : s;
}

