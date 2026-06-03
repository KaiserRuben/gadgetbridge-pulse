"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { IconBadge } from "@/components/ui/icon-badge";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NutrientTargetEditor } from "@/components/nutrition/NutrientTargetEditor";
import type { NutritionTargets } from "@/lib/nutrition/types";

interface FoodCacheStatsProp {
  seed: number;
  llm: number;
  newest_captured_at: string | null;
}

/**
 * /nutrition/targets client view. Targets are loaded server-side and passed
 * via props so user-saved overrides reflect on first paint.
 *
 * Debug block at the bottom is gated behind a `<details>` (collapsed by
 * default) — anyone who needs to clear the food-db cache during pipeline
 * tuning can do so without surfacing the action to casual users.
 */
export default function TargetsView({
  targets,
  foodCacheStats,
}: {
  targets: NutritionTargets;
  foodCacheStats: FoodCacheStatsProp;
}) {
  const router = useRouter();
  const [resetCounter, setResetCounter] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const macros = targets.rows.filter((r) => r.group === "macro");
  const micros = targets.rows.filter((r) => r.group === "micro");

  async function resetAllTargets(): Promise<void> {
    if (clearing) return;
    const overrides = targets.rows.filter((r) => r.target != null).length;
    if (overrides === 0) {
      // Local-only re-render so any unsaved typing snaps back to props.
      setResetCounter((c) => c + 1);
      return;
    }
    const ok = window.confirm(
      `Wirklich ${overrides} Überschreibung(en) verwerfen und auf RDA-Standards zurücksetzen?`,
    );
    if (!ok) return;
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch(`/api/nutrition/targets`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResetCounter((c) => c + 1);
      router.refresh();
    } catch (err) {
      setClearError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  async function clearCache(): Promise<void> {
    if (clearing) return;
    const ok = window.confirm(
      `Wirklich ${foodCacheStats.llm} LLM-Einträge aus dem Food-Cache löschen?`,
    );
    if (!ok) return;
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch(`/api/nutrition/food-cache`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setClearError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Ernährung"
        title="Deine Ziele"
        sub={
          <>
            Generisches RDA als Standard. Wo eine Formel hinterlegt ist
            <code className="num-mono text-[0.75rem] mx-1">auto_from</code>
            berechnet der Coach den Bedarf aus deinem Zustand. Override für jeden Wert
            möglich, hat Vorrang.
          </>
        }
        trailing={
          <button
            type="button"
            onClick={resetAllTargets}
            disabled={clearing}
            className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)] border border-[var(--color-border)] bg-[var(--color-surface)] text-caption hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Glyph
              name="RotateCcw"
              size={14}
              className={clearing ? "animate-spin" : undefined}
            />
            Alle Standards
          </button>
        }
      />

      <Section eyebrow="Makros" title={`${macros.length} Werte`}>
        <Stagger className="flex flex-col gap-2" step={0.03}>
          {macros.map((r) => (
            <StaggerItem key={`${r.key}-${resetCounter}`}>
              <NutrientTargetEditor initial={r} />
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      <Section
        eyebrow="Mikros"
        title={`${micros.length} Werte`}
        trailing={
          <span className="text-caption text-subtle">RDA m = männlich · Erwachsener</span>
        }
      >
        <Stagger className="flex flex-col gap-2" step={0.02}>
          {micros.map((r) => (
            <StaggerItem key={`${r.key}-${resetCounter}`}>
              <NutrientTargetEditor initial={r} />
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      <Section eyebrow="Hinweise" title="Wie der Coach Ziele liest">
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <IconBadge icon="Target" tone="nutrition" size="sm" />
              <div className="flex flex-col gap-1">
                <span className="text-body-sm font-medium">Override hat Vorrang</span>
                <span className="text-caption text-muted max-w-[60ch]">
                  Setzt du explizit einen Wert (z. B. 140 g Eiweiß), nutzt der Coach diesen
                  und ignoriert die Formel. Leeres Feld = Formel oder Standard.
                </span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <IconBadge icon="Activity" tone="activity" size="sm" />
              <div className="flex flex-col gap-1">
                <span className="text-body-sm font-medium">Formeln referenzieren deinen Zustand</span>
                <span className="text-caption text-muted max-w-[60ch]">
                  z. B. <code className="num-mono">1.6 * weight_kg</code> – Ziel passt sich
                  Gewichtsänderungen an. Trainings-Tage erhöhen den Kalorienbedarf via
                  <code className="num-mono mx-1">active_kcal</code>.
                </span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <IconBadge icon="AlertTriangle" tone="neutral" size="sm" />
              <div className="flex flex-col gap-1">
                <span className="text-body-sm font-medium">Coach gibt keine klinischen Empfehlungen</span>
                <span className="text-caption text-muted max-w-[60ch]">
                  Defizite werden als Muster über mehrere Tage gemeldet — nie als "du brauchst".
                  Einzeltag-Abweichung allein triggert keinen Hinweis.
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>

      <details className="text-caption text-muted">
        <summary className="cursor-pointer inline-flex items-center gap-2 hover:text-[var(--color-text)] transition-colors">
          <Glyph name="Settings" size={12} />
          Debug
        </summary>
        <Card variant="soft" className="mt-3">
          <CardBody className="p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1 max-w-[50ch]">
                <span className="text-body-sm font-medium text-[var(--color-text)]">
                  Food-DB-Cache leeren
                </span>
                <span className="text-caption text-muted">
                  Entfernt alle LLM-gesourcten Per-100g-Werte aus
                  <code className="num-mono mx-1">food-db/cache.json</code>. Beim nächsten Treffer
                  wird das Modell erneut befragt. Statische Seed-Einträge bleiben unangetastet.
                </span>
              </div>
              <button
                type="button"
                disabled={clearing || foodCacheStats.llm === 0}
                onClick={clearCache}
                className="inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)] bg-[var(--color-surface-2)] border border-[var(--color-border)] text-caption hover:border-[var(--color-tier-s1)]/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Glyph
                  name={clearing ? "RotateCcw" : "Trash2"}
                  size={14}
                  className={clearing ? "animate-spin text-[var(--color-tier-s1)]" : "text-[var(--color-tier-s1)]"}
                />
                {clearing ? "Leere…" : "Cache leeren"}
              </button>
            </div>
            {clearError && (
              <span className="text-caption text-[var(--color-band-down)]">
                Fehler: {clearError}
              </span>
            )}
            <div className="flex items-center gap-3 flex-wrap pt-3 border-t border-[var(--color-border)]">
              <Pill tone="low" size="sm">Seed</Pill>
              <span className="text-caption">
                {foodCacheStats.seed} Einträge aus USDA-Snapshot
              </span>
              <span className="text-faint">·</span>
              <Pill tone="nutrition" size="sm">LLM-Cache</Pill>
              <span className="text-caption">
                {foodCacheStats.llm} Einträge
                {foodCacheStats.newest_captured_at &&
                  ` · letzte Aktualisierung ${fmtRelative(foodCacheStats.newest_captured_at)}`}
              </span>
              <Link
                href="/labs"
                className="ml-auto text-caption hover:text-[var(--color-text)] transition-colors"
              >
                Labs →
              </Link>
            </div>
          </CardBody>
        </Card>
      </details>
    </div>
  );
}

function fmtRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "?";
  const diff = Date.now() - then;
  if (diff < 60_000) return "gerade eben";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `vor ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} d`;
}
