"use client";

/**
 * Action footer on the meal detail page. Three buttons:
 *   - "Neu klassifizieren" → POST /reclassify, refresh the route so the
 *     pending state renders.
 *   - "Notiz hinzufügen/bearbeiten" → inline textarea + PATCH /api/meal/[id].
 *   - "Löschen" → DELETE + redirect back to the day.
 *
 * Errors render in-row; nothing throws to the route. Each action disables
 * the other two while in-flight so a double-click can't race.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { Glyph } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";

type Busy = null | "reclassify" | "notes" | "delete";

export function MealActions({
  mealId,
  periodKey,
  currentNotes,
  status,
}: {
  mealId: string;
  periodKey: string;
  currentNotes: string | null;
  status: "pending" | "classified" | "edited" | "failed";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(currentNotes ?? "");

  const isPending = status === "pending";

  async function reclassify(): Promise<void> {
    if (busy) return;
    setBusy("reclassify");
    setError(null);
    try {
      const res = await fetch(`/api/nutrition/meal/${mealId}/reclassify`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.reason ?? body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveNotes(): Promise<void> {
    if (busy) return;
    setBusy("notes");
    setError(null);
    try {
      const trimmed = notesValue.trim();
      const res = await fetch(`/api/nutrition/meal/${mealId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: trimmed === "" ? null : trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setNotesOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteMeal(): Promise<void> {
    if (busy) return;
    const confirmed = window.confirm(
      "Diese Mahlzeit endgültig löschen? Die Historie geht verloren.",
    );
    if (!confirmed) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/nutrition/meal/${mealId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Redirect to the day view — meal no longer exists.
      router.push(`/nutrition/${periodKey}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <Card variant="soft">
      <CardBody className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || isPending}
            onClick={reclassify}
            className={cn(
              "inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)]",
              "bg-[var(--color-surface-2)] border border-[var(--color-border)]",
              "text-caption hover:border-[var(--color-nutrition)]/60 transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Glyph
              name={busy === "reclassify" ? "RotateCcw" : "Sparkles"}
              size={14}
              className={cn(
                "text-[var(--color-nutrition)]",
                busy === "reclassify" && "animate-spin",
              )}
            />
            {busy === "reclassify"
              ? "Reset…"
              : isPending
              ? "Klassifizierung läuft"
              : "Neu klassifizieren"}
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setNotesOpen((v) => !v);
              setError(null);
            }}
            className={cn(
              "inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)]",
              "bg-[var(--color-surface-2)] border border-[var(--color-border)]",
              "text-caption hover:border-[var(--color-border-strong)] transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Glyph name="PenLine" size={14} className="text-subtle" />
            {currentNotes ? "Notiz bearbeiten" : "Notiz hinzufügen"}
          </button>

          <span className="flex-1" />

          <button
            type="button"
            disabled={busy !== null}
            onClick={deleteMeal}
            className={cn(
              "inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-chip)]",
              "text-caption text-[var(--color-tier-s1)]",
              "hover:bg-[color-mix(in_srgb,var(--color-tier-s1)_14%,transparent)] transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Glyph
              name={busy === "delete" ? "RotateCcw" : "Trash2"}
              size={14}
              className={cn(busy === "delete" && "animate-spin")}
            />
            {busy === "delete" ? "Löschen…" : "Löschen"}
          </button>
        </div>

        {notesOpen && (
          <div className="flex flex-col gap-2 pt-2 border-t border-[var(--color-border)]">
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Kontext zur Mahlzeit (optional)…"
              className={cn(
                "w-full resize-y rounded-[var(--radius-chip)] px-3 py-2",
                "bg-[var(--color-surface-2)] border border-[var(--color-border)]",
                "text-[0.8125rem] leading-snug",
                "focus:outline-none focus:border-[var(--color-nutrition)]/60",
              )}
              disabled={busy === "notes"}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-subtle num-mono">
                {notesValue.length} / 2000
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy === "notes"}
                  onClick={() => {
                    setNotesOpen(false);
                    setNotesValue(currentNotes ?? "");
                    setError(null);
                  }}
                  className="text-caption text-muted hover:text-[var(--color-text)] transition-colors px-3 py-1.5"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={busy === "notes" || notesValue === (currentNotes ?? "")}
                  onClick={saveNotes}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-chip)]",
                    "bg-[var(--color-nutrition)] text-[var(--color-bg)] text-caption font-medium",
                    "hover:brightness-110 transition",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                  )}
                >
                  <Glyph
                    name={busy === "notes" ? "RotateCcw" : "CheckCircle"}
                    size={14}
                    className={cn(busy === "notes" && "animate-spin")}
                  />
                  {busy === "notes" ? "Speichert…" : "Speichern"}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <span className="text-caption text-[var(--color-band-down)]">
            Fehler: {error}
          </span>
        )}
      </CardBody>
    </Card>
  );
}
