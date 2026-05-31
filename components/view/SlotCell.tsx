"use client";

import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { SlotStatusPill } from "./SlotStatusPill";
import { SlotRetryButton } from "./SlotRetryButton";
import type { ReactNode } from "react";
import type { SlotEntry, SlotId, SlotStatus } from "@/runner/v4/types.ts";

const PAYLOAD_STATUSES = new Set<SlotStatus>([
  "fresh",
  "aging",
  "stale",
  "degraded",
]);
const RETRY_STATUSES = new Set<SlotStatus>(["errored", "stale", "missed"]);
const LOADING_STATUSES = new Set<SlotStatus>(["scheduled", "computing"]);

/**
 * Generic shell for a fixed slot. Renders status, scheduled_for /
 * computed_at metadata, error message, and the per-slot Body when the
 * payload is present.
 *
 * Pass `Body` as the slot-specific renderer; it receives the typed payload
 * (caller is responsible for the cast since the entry's payload is generic).
 */
export interface SlotCellProps<P> {
  slot_id: SlotId;
  entry: SlotEntry<P> | null | undefined;
  title: string;
  eyebrow?: string;
  Body: (props: { payload: P }) => ReactNode;
  /** Show retry button when status is errored / stale / abstained. */
  retryable?: boolean;
  glow?: Parameters<typeof Card>[0]["glow"];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function SlotCell<P>({
  slot_id,
  entry,
  title,
  eyebrow,
  Body,
  retryable = true,
  glow,
}: SlotCellProps<P>) {
  const status = entry?.status ?? "scheduled";
  const computedAt = entry?.computed_at ?? null;
  const scheduledFor = entry?.scheduled_for ?? null;
  const hasPayload = entry?.payload != null && PAYLOAD_STATUSES.has(status);
  const errored = status === "errored";
  const showRetry = retryable && RETRY_STATUSES.has(status);

  return (
    <Card glow={glow ?? null} className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h3>
        </div>
        <SlotStatusPill status={status} />
      </header>

      {hasPayload && entry?.payload ? (
        <Body payload={entry.payload} />
      ) : LOADING_STATUSES.has(status) ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : status === "abstained" ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Daten zu dünn — ausgesetzt.
          {entry?.degraded_reason ? ` ${entry.degraded_reason}` : ""}
        </p>
      ) : errored ? (
        <p className="text-xs text-[var(--color-band-down)]">
          Fehler: {entry?.error?.message ?? "unbekannt"}
        </p>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">
          Noch nicht berechnet.
        </p>
      )}

      <footer className="flex items-center justify-between gap-2 text-[0.6875rem] text-[var(--color-text-muted)]">
        <span>
          {computedAt
            ? `berechnet ${fmtTime(computedAt)}`
            : `geplant ${fmtTime(scheduledFor)}`}
          {entry?.version ? ` · v${entry.version}` : null}
        </span>
        {showRetry ? <SlotRetryButton slot_id={slot_id} /> : null}
      </footer>
    </Card>
  );
}
