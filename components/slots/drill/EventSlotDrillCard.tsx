"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { SlotStatusPill } from "@/components/view/SlotStatusPill";
import { SlotRetryButton } from "@/components/view/SlotRetryButton";
import { AbstainNote } from "@/components/slots/_AbstainNote";
import { SourcesFooter } from "./SourcesFooter";
import type {
  EventSlotId,
  SlotEntry,
  SlotStatus,
} from "@/runner/v4/types.ts";

const PAYLOAD_STATUSES = new Set<SlotStatus>([
  "fresh",
  "aging",
  "stale",
  "degraded",
]);

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export interface EventSlotDrillCardProps {
  slot_id: EventSlotId;
  event_id: string;
  observation_id?: string;
  anchor: string;
  entry: SlotEntry<unknown>;
  title: string;
  eyebrow?: string;
  glow?: Parameters<typeof Card>[0]["glow"];
  Body: (props: { payload: unknown }) => ReactNode;
}

export function EventSlotDrillCard({
  slot_id,
  event_id,
  observation_id,
  anchor,
  entry,
  title,
  eyebrow,
  glow,
  Body,
}: EventSlotDrillCardProps) {
  const status = entry.status;
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === `#${anchor}`) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, [entry.status, anchor]);

  const hasPayload = entry.payload != null && PAYLOAD_STATUSES.has(status);

  return (
    <section ref={ref} id={anchor} className="scroll-mt-6">
      <Card glow={glow ?? null} className="flex flex-col gap-3 p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--color-text)]">
              {title}
            </h2>
            <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)]">
              {entry.computed_at
                ? `berechnet ${fmtTime(entry.computed_at)}`
                : `geplant ${fmtTime(entry.scheduled_for)}`}
              {entry.version ? ` · v${entry.version}` : null}
            </p>
          </div>
          <SlotStatusPill status={status} size="md" />
        </header>

        {status === "stale" && hasPayload ? (
          <p className="rounded-md bg-[var(--color-surface-soft)] px-3 py-1.5 text-[0.75rem] text-[var(--color-band-down)]">
            Veraltet — letzte gültige Berechnung wird angezeigt.
          </p>
        ) : null}
        {status === "degraded" && hasPayload ? (
          <p className="rounded-md bg-[var(--color-surface-soft)] px-3 py-1.5 text-[0.75rem] text-[var(--color-tier-s2)]">
            Unvollständig
            {entry.degraded_reason ? ` — ${entry.degraded_reason}` : "."}
          </p>
        ) : null}

        {hasPayload && entry.payload != null ? (
          <Body payload={entry.payload} />
        ) : status === "abstained" ? (
          <AbstainNote reason={entry.degraded_reason} />
        ) : status === "errored" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-band-down)]">
              Fehler: {entry.error?.message ?? "unbekannt"}
            </p>
            <SlotRetryButton
              slot_id={slot_id}
              event_id={event_id}
              observation_id={observation_id}
            />
          </div>
        ) : status === "scheduled" || status === "computing" ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <p className="text-[0.6875rem] text-[var(--color-text-muted)]">
              geplant für {fmtTime(entry.scheduled_for)}
            </p>
          </div>
        ) : status === "missed" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-text-muted)]">
              Nicht berechnet — Fenster verpasst.
            </p>
            <SlotRetryButton
              slot_id={slot_id}
              event_id={event_id}
              observation_id={observation_id}
            />
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Noch nicht berechnet.
          </p>
        )}

        <SourcesFooter entry={entry} />
      </Card>
    </section>
  );
}
