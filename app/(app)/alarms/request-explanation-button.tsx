"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Glyph } from "@/components/ui/glyph";

export function RequestExplanationButton({
  periodKey,
  eventId,
  observationId,
}: {
  periodKey: string;
  eventId: string;
  observationId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-caption text-subtle">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const res = await fetch(
                `/api/view/${periodKey}/event/anomaly_explain`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    event_id: eventId,
                    observation_id: observationId,
                  }),
                },
              );
              const body = (await res.json().catch(() => ({}))) as {
                ok?: boolean;
                already_scheduled?: boolean;
                error?: string;
              };
              if (res.ok && body.ok) {
                setMsg(body.already_scheduled ? "Bereits geplant" : "Geplant");
                router.refresh();
              } else {
                setMsg(`Fehler: ${body.error ?? res.status}`);
              }
            } catch (err) {
              setMsg(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
            }
          })
        }
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-caption text-[var(--color-bg)] bg-[var(--color-text)] disabled:opacity-50"
      >
        <Glyph name="Sparkles" size={12} />
        {pending ? "Sende…" : "Erklärung anfordern"}
      </button>
    </div>
  );
}
