"use client";

import { useState, useTransition } from "react";
import { Glyph } from "@/components/ui/glyph";
import { clearAllAlarms } from "./actions";

export function ClearAllButton({ monthKey, count }: { monthKey: string; count: number }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-caption text-subtle">{msg}</span>}
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-caption ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          disabled={pending}
        >
          <Glyph name="CheckCircle" size={12} />
          Alle erledigen
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-caption ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-surface-2)]"
            disabled={pending}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() =>
              start(async () => {
                const res = await clearAllAlarms(monthKey);
                if (res.ok) {
                  setMsg(`${res.dismissed} erledigt.`);
                } else {
                  setMsg(`Fehler: ${res.error}`);
                }
                setConfirm(false);
              })
            }
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-caption text-[var(--color-bg)] bg-[var(--color-text)] disabled:opacity-50"
            disabled={pending}
          >
            <Glyph name="CheckCircle" size={12} />
            Bestätigen ({count})
          </button>
        </>
      )}
    </div>
  );
}
