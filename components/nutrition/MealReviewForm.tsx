"use client";

/**
 * Editable components list with live nutrition recompute. Per the
 * NUTRITION_PLAN.md edit rules:
 *   - Add/remove/adjust grams freely.
 *   - Each component owns its frozen `nutrition.per100g` so changing the
 *     grams scales totals deterministically — no surprise drift.
 *   - We never auto-redo classification; the parent surfaces a separate
 *     "redo with VLM" affordance.
 *   - This component is client-only and stateful; on save it would POST
 *     to /api/nutrition/meal/[id] (not wired in this design pass).
 */

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { MacroStack } from "./MacroStack";
import type { MealComponent, NutritionFacts, NutritionSnapshot } from "@/lib/nutrition/types";
import { cn } from "@/lib/cn";

type EditableComponent = MealComponent & { _dirty?: boolean };

export function MealReviewForm({
  initial,
  className,
}: {
  initial: MealComponent[];
  className?: string;
}) {
  const [comps, setComps] = useState<EditableComponent[]>(initial);
  const [showAdd, setShowAdd] = useState(false);

  const totals = useMemo(() => sumTotals(comps), [comps]);

  const update = (id: string, patch: Partial<MealComponent>) => {
    setComps((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next: EditableComponent = { ...c, ...patch, _dirty: true };
        if (patch.grams != null) {
          next.nutrition = scaleSnapshot(c.nutrition, patch.grams);
        }
        return next;
      }),
    );
  };

  const remove = (id: string) => {
    setComps((prev) => prev.filter((c) => c.id !== id));
  };

  const add = (label: string, food_key: string) => {
    if (!label.trim()) return;
    const id = `cmp_new_${Date.now()}`;
    const grams = 100;
    const placeholderPer100: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    setComps((prev) => [
      ...prev,
      {
        id,
        ord: prev.length + 1,
        food_key: food_key || `manual:${label.toLowerCase().replace(/\s+/g, "_")}`,
        label,
        grams,
        confidence: null,
        source: "user_add",
        nutrition: { per100g: placeholderPer100, totals: placeholderPer100 },
        _dirty: true,
      },
    ]);
    setShowAdd(false);
  };

  const dirty = comps.some((c) => c._dirty) || comps.length !== initial.length;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Card variant="flat">
        <CardBody className="p-4 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Live-Summe</Eyebrow>
            <span className="text-caption num-mono text-subtle">
              {comps.length} Komponenten
            </span>
          </div>
          <MacroStack
            protein_g={totals.protein_g}
            carbs_g={totals.carbs_g}
            fat_g={totals.fat_g}
            kcal={totals.kcal}
          />
        </CardBody>
      </Card>

      <ul className="flex flex-col gap-2">
        {comps.map((c) => (
          <li key={c.id}>
            <ComponentEditor
              c={c}
              onChange={(patch) => update(c.id, patch)}
              onRemove={() => remove(c.id)}
            />
          </li>
        ))}
      </ul>

      {showAdd ? (
        <AddRow onAdd={add} onCancel={() => setShowAdd(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="self-start inline-flex items-center gap-2 text-caption text-muted hover:text-[var(--color-text)] transition-colors px-3 py-2 rounded-[var(--radius-chip)] border border-dashed border-[var(--color-border-strong)] hover:border-[var(--color-nutrition)]/40"
        >
          <Glyph name="Plus" size={14} />
          Komponente hinzufügen
        </button>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setComps(initial)}
          className="text-caption text-muted hover:text-[var(--color-text)] disabled:opacity-40 disabled:hover:text-[var(--color-text-muted)] transition-colors px-3 py-2"
        >
          Zurücksetzen
        </button>
        <button
          type="button"
          disabled={!dirty}
          className="inline-flex items-center gap-2 text-caption font-medium px-3 py-2 rounded-[var(--radius-chip)] bg-[var(--color-nutrition)] text-[var(--color-bg)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Glyph name="CheckCircle" size={14} />
          Speichern
        </button>
      </div>
    </div>
  );
}

function ComponentEditor({
  c,
  onChange,
  onRemove,
}: {
  c: EditableComponent;
  onChange: (patch: Partial<MealComponent>) => void;
  onRemove: () => void;
}) {
  const lowConf = (c.confidence ?? 1) < 0.5;
  return (
    <Card variant="flat">
      <CardBody className="p-3 flex flex-col gap-2.5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={c.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="w-full bg-transparent text-[0.9375rem] font-medium focus:outline-none placeholder:text-faint"
              placeholder="Komponente"
            />
            <div className="flex items-center gap-2 mt-1">
              <span className="num-mono text-caption text-subtle truncate">{c.food_key}</span>
              {c.source === "user_text" && (
                <Pill tone="steady" size="sm">aus Text</Pill>
              )}
              {c.source === "user_add" && (
                <Pill tone="up" size="sm">manuell</Pill>
              )}
              {lowConf && c.confidence != null && (
                <Pill tone="s2" size="sm">prüfen</Pill>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="text-faint hover:text-[var(--color-tier-s1)] transition-colors p-1"
            aria-label="Entfernen"
          >
            <Glyph name="Trash2" size={14} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={500}
            step={5}
            value={Math.min(500, c.grams)}
            onChange={(e) => onChange({ grams: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-nutrition)]"
          />
          <div className="flex items-baseline gap-1 w-24">
            <input
              type="number"
              min={0}
              step={1}
              value={Math.round(c.grams)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v >= 0) onChange({ grams: v });
              }}
              className="w-full num-mono text-right text-[0.9375rem] font-medium bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-xs)] px-2 py-1 focus:outline-none focus:border-[var(--color-nutrition)]"
            />
            <span className="text-caption text-subtle num-mono">g</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-[var(--color-border)]/60">
          <div className="flex items-center gap-3 num-mono text-caption text-muted">
            <span>
              <span className="text-[var(--color-text)] font-semibold num">{Math.round(c.nutrition.totals.kcal)}</span> kcal
            </span>
            <span>{Math.round(c.nutrition.totals.protein_g)} P</span>
            <span>{Math.round(c.nutrition.totals.carbs_g)} K</span>
            <span>{Math.round(c.nutrition.totals.fat_g)} F</span>
          </div>
          {c.confidence != null && (
            <ConfidenceBar value={c.confidence} />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function AddRow({
  onAdd,
  onCancel,
}: {
  onAdd: (label: string, food_key: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  return (
    <Card variant="flat">
      <CardBody className="p-3 flex items-center gap-2">
        <Glyph name="Plus" size={14} className="text-[var(--color-nutrition)] shrink-0" />
        <input
          autoFocus
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd(label, "");
            if (e.key === "Escape") onCancel();
          }}
          placeholder="z. B. „Banane“ – Suche kommt aus Food-DB"
          className="flex-1 bg-transparent text-[0.875rem] focus:outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-caption text-muted hover:text-[var(--color-text)] px-2 py-1"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => onAdd(label, "")}
          className="text-caption font-medium px-2 py-1 rounded-[var(--radius-chip)] bg-[var(--color-nutrition)] text-[var(--color-bg)] hover:brightness-110"
        >
          Hinzufügen
        </button>
      </CardBody>
    </Card>
  );
}

function scaleSnapshot(snap: NutritionSnapshot, grams: number): NutritionSnapshot {
  const factor = grams / 100;
  const out: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const [k, v] of Object.entries(snap.per100g)) {
    if (typeof v === "number") (out as unknown as Record<string, number>)[k] = Math.round(v * factor * 10) / 10;
  }
  return { per100g: snap.per100g, totals: out };
}

function sumTotals(comps: MealComponent[]): NutritionFacts {
  const out: NutritionFacts = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const keys: Array<keyof NutritionFacts> = [
    "kcal","protein_g","carbs_g","fat_g","fiber_g","sugar_g","saturated_fat_g",
    "sodium_mg","iron_mg","calcium_mg","magnesium_mg","zinc_mg",
    "vit_c_mg","vit_d_ug","vit_b12_ug","folate_ug","omega3_g",
  ];
  for (const k of keys) {
    let total = 0;
    let any = false;
    for (const c of comps) {
      const v = c.nutrition.totals[k];
      if (typeof v === "number") {
        total += v;
        any = true;
      }
    }
    if (any) (out as unknown as Record<string, number>)[k] = Math.round(total * 10) / 10;
  }
  return out;
}
