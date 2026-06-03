"use client";

import { AnimatePresence, motion } from "motion/react";

import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { SlotStatusPill } from "./SlotStatusPill";
import { SlotRetryButton } from "./SlotRetryButton";
import { friendlySlotError } from "@/components/slots/_friendly-error";
import { renderCompactBody } from "@/components/slots/_body-registry";
import { useMotionPrefs } from "@/components/motion/_lib";
import { cn } from "@/lib/cn";
import type { SlotEntry, SlotId, SlotStatus } from "@/runner/v4/types.ts";

const PAYLOAD_STATUSES = new Set<SlotStatus>([
  "fresh",
  "aging",
  "stale",
  "degraded",
]);
const RETRY_STATUSES = new Set<SlotStatus>(["errored", "stale", "missed"]);

type Phase = "payload" | "computing" | "scheduled" | "errored" | "abstained";

/**
 * One node of the day timeline. Renders a slot's content keyed to its
 * lifecycle status. The cardinal rule: a `scheduled` slot is a *promise*, not
 * a loading state — only `computing` shows skeleton shimmer. State changes
 * cross-fade so a slot landing over SSE feels like an arrival, not a flash.
 */
export interface SlotCellProps<P> {
  slot_id: SlotId;
  entry: SlotEntry<P> | null | undefined;
  title: string;
  eyebrow?: string;
  /** One-line description of what this slot will say, shown while scheduled. */
  purpose?: string;
  /** Is this the slot for the current time-of-day? Drives glow + emphasis. */
  isNow?: boolean;
  /** Render larger (the day_synthesis terminus). */
  isTerminal?: boolean;
  /** Domain accent; lights the glow when this is the now-slot with content. */
  domain?: Parameters<typeof Card>[0]["glow"];
  /** Show retry button when status is errored / stale / missed. */
  retryable?: boolean;
  /** Explicit glow override (back-compat for callers like the week page). */
  glow?: Parameters<typeof Card>[0]["glow"];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function phaseOf(status: SlotStatus, hasPayload: boolean): Phase {
  if (hasPayload) return "payload";
  if (status === "computing") return "computing";
  if (status === "errored") return "errored";
  if (status === "abstained") return "abstained";
  return "scheduled"; // scheduled | missed | (no entry)
}

export function SlotCell<P>({
  slot_id,
  entry,
  title,
  eyebrow,
  purpose,
  isNow = false,
  isTerminal = false,
  domain,
  retryable = true,
  glow,
}: SlotCellProps<P>) {
  const prefs = useMotionPrefs();
  const status = entry?.status ?? "scheduled";
  const computedAt = entry?.computed_at ?? null;
  const scheduledFor = entry?.scheduled_for ?? null;
  const hasPayload = entry?.payload != null && PAYLOAD_STATUSES.has(status);
  const showRetry = retryable && RETRY_STATUSES.has(status);
  const phase = phaseOf(status, hasPayload);

  const resolvedGlow = glow ?? (isNow && hasPayload ? domain ?? null : null);

  return (
    <Card
      glow={resolvedGlow}
      // box-shadow utilities lose to `.surface { box-shadow }` (same layer);
      // set the pop shadow inline so the terminus actually lifts.
      style={
        isTerminal
          ? { boxShadow: "var(--shadow-pop)", borderColor: "var(--color-border-strong)" }
          : undefined
      }
      className={cn(
        "flex flex-col gap-3 p-4 transition-[border-color,box-shadow] duration-300",
        isTerminal && "p-5",
        isNow && !isTerminal && "border-[var(--color-border-strong)]",
      )}
    >
      {isTerminal ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[var(--color-sleep)] to-transparent opacity-70"
        />
      ) : null}
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h3
            className={cn(
              "truncate font-semibold text-[var(--color-text)]",
              isTerminal ? "text-[1.1875rem] tracking-[-0.01em]" : "text-sm",
            )}
          >
            {title}
          </h3>
        </div>
        <SlotStatusPill status={status} />
      </header>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: prefs.reduce ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefs.crossfadeDur, ease: [0.16, 1, 0.3, 1] }}
        >
          {phase === "payload" && entry?.payload ? (
            renderCompactBody(slot_id, entry.payload)
          ) : phase === "computing" ? (
            <ComputingBody />
          ) : phase === "errored" ? (
            <ErroredBody message={entry?.error?.message} />
          ) : phase === "abstained" ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Daten zu dünn — ausgesetzt.
              {entry?.degraded_reason ? ` ${entry.degraded_reason}` : ""}
            </p>
          ) : (
            <ScheduledBody
              status={status}
              purpose={purpose}
              scheduledFor={scheduledFor}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <footer className="flex items-center justify-between gap-2 pt-0.5 text-[0.6875rem] text-[var(--color-text-subtle)]">
        <span className="num-mono">
          {computedAt ? `berechnet ${fmtTime(computedAt)}` : null}
          {computedAt && entry?.version ? ` · v${entry.version}` : null}
        </span>
        {showRetry ? <SlotRetryButton slot_id={slot_id} label="Neu" /> : null}
      </footer>
    </Card>
  );
}

/** The ONLY place skeleton shimmer is allowed: an active compute. */
function ComputingBody() {
  return (
    <div className="space-y-2">
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-1/2" />
      <p className="pt-1 text-[0.6875rem] text-[var(--color-text-subtle)]">
        läuft …
      </p>
    </div>
  );
}

/** A promise, not a loader: what this slot will say + when it appears. */
function ScheduledBody({
  status,
  purpose,
  scheduledFor,
}: {
  status: SlotStatus;
  purpose?: string;
  scheduledFor: string | null;
}) {
  const late = status === "missed";
  const when = fmtTime(scheduledFor);
  return (
    <div className="flex min-h-[3rem] flex-col justify-center gap-2.5">
      <p className="text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">
        {purpose ?? "Wird automatisch berechnet."}
      </p>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[0.6875rem] text-[var(--color-text-subtle)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-band-low)]" />
        {late ? `erwartet ~${when}` : `erscheint ~${when}`}
      </span>
    </div>
  );
}

/** Errors as a contained, tinted callout — readable, with details + retry. */
function ErroredBody({ message }: { message?: string }) {
  const { summary, raw } = friendlySlotError(message);
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-tier-s1)]/30 bg-[var(--color-tier-s1)]/10 p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-tier-s1)]" />
        <p className="text-[0.8125rem] leading-relaxed text-[var(--color-text-strong)]">
          {summary}
        </p>
      </div>
      <details className="pl-3.5 text-[0.6875rem] text-[var(--color-text-subtle)]">
        <summary className="cursor-pointer select-none">Details</summary>
        <pre className="mt-1 whitespace-pre-wrap text-[0.6875rem]">{raw}</pre>
      </details>
    </div>
  );
}
