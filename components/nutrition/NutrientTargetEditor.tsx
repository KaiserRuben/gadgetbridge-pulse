"use client";

/**
 * Single-row editor for a nutrient target. Shows the auto_from formula
 * (read-only) and lets the user override with an explicit number. Each
 * change is persisted on blur via PATCH /api/nutrition/targets — no
 * "save all" button so every input commits in isolation. The "Standard"
 * action removes the override and reverts to default_target immediately.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import type { NutrientTarget } from "@/lib/nutrition/types";
import { cn } from "@/lib/cn";

export function NutrientTargetEditor({
  initial,
  className,
}: {
  initial: NutrientTarget;
  className?: string;
}) {
  const router = useRouter();
  const [row, setRow] = useState<NutrientTarget>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overridden = row.target != null && row.target !== row.default_target;
  const effective = row.target ?? row.default_target;

  async function persist(target: number | null): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/nutrition/targets`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: row.key, target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card variant="flat" className={className}>
      <CardBody className="p-3.5 flex items-center gap-3 flex-wrap md:flex-nowrap">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[0.875rem] font-medium truncate">{row.label}</span>
          {row.auto_from && (
            <span className="num-mono text-[0.625rem] text-subtle truncate">
              auto: {row.auto_from}
            </span>
          )}
          {error && (
            <span className="text-[0.625rem] text-[var(--color-band-down)] truncate">
              Fehler: {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Eyebrow className="!text-[0.625rem]">Ziel</Eyebrow>
        </div>

        <div className="flex items-baseline gap-1.5 shrink-0 w-32">
          <input
            type="number"
            min={0}
            step={row.unit === "ug" ? 0.5 : 1}
            value={effective ?? ""}
            placeholder={row.default_target?.toString() ?? "—"}
            disabled={saving}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setRow((r) => ({ ...r, target: v }));
            }}
            onBlur={() => {
              // Persist only when the visible value actually differs from
              // what came in via props — typing then deleting back to the
              // initial value shouldn't trigger a write.
              if ((row.target ?? null) === (initial.target ?? null)) return;
              persist(row.target ?? null);
            }}
            className={cn(
              "w-full num-mono text-right text-[0.9375rem] font-medium bg-[var(--color-bg-elevated)] border rounded-[var(--radius-xs)] px-2 py-1.5 focus:outline-none transition-colors",
              overridden
                ? "border-[var(--color-nutrition)]/60 text-[var(--color-nutrition)] focus:border-[var(--color-nutrition)]"
                : "border-[var(--color-border)] focus:border-[var(--color-border-strong)]",
            )}
          />
          <span className="text-caption text-subtle num-mono w-8">{row.unit}</span>
        </div>

        <button
          type="button"
          onClick={() => {
            setRow((r) => ({ ...r, target: null }));
            persist(null);
          }}
          disabled={!overridden || saving}
          className="inline-flex items-center gap-1 text-caption text-muted hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)] transition-colors px-2 py-1.5 shrink-0"
          aria-label="Auf Standard zurücksetzen"
        >
          <Glyph
            name="RotateCcw"
            size={12}
            className={saving ? "animate-spin" : undefined}
          />
          <span className="hidden md:inline">Standard</span>
        </button>
      </CardBody>
    </Card>
  );
}
