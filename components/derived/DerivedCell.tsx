"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { useMotionPrefs } from "@/components/motion/_lib";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { InProgressBadge } from "@/components/ui/in-progress-badge";
import { Pill } from "@/components/ui/pill";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { freshnessPill, hasUserEdit } from "@/lib/derived/cell-status";
import { clusterTone } from "@/lib/derived/cluster-tone";
import type { CellState } from "@/lib/derived/state";
import type { ProvenanceTag } from "@/runner/jobs/types";

import { ProvenanceChip } from "./ProvenanceChip";
import { ProvenanceRow } from "./ProvenanceRow";
import { useJobCell } from "./useJobCell";

export type { CellState } from "@/lib/derived/state";

/**
 * Optional 4th-arg context passed to the render callback. Lets consumer
 * cells compose the freshness pill / cached state into their own custom
 * eyebrows when needed. Existing call sites can ignore this argument —
 * the third argument (`ProvenanceTag[]`) stays back-compat with U1.
 */
export interface DerivedCellRenderContext {
  /**
   * The `<Pill>` describing freshness/cache state, ready to drop into an
   * eyebrow row. `null` when no pill applies (settled fresh > 5 min, or
   * the state owns its own badge — fetching/reprocessing/error).
   */
  statusPill: ReactNode | null;
  /** Server-reported `updated_at` for the current payload. */
  updatedAt: string | null;
  /** The cell's current state — handy for inline cache hints. */
  state: CellState;
}

export interface DerivedCellProps<T = unknown> {
  cluster: string;
  /** Renamed from `key` so it doesn't shadow React's reserved prop. */
  cellKey: string;
  scope?: "daily" | "weekly";
  /**
   * Render the payload. Three positional args plus an optional 4th
   * context object (additive — existing call sites compile unchanged).
   */
  render: (
    payload: T,
    state: CellState,
    provenance: ProvenanceTag[],
    ctx?: DerivedCellRenderContext,
  ) => ReactNode;
  /** What to show during the very first fetch (before any payload). */
  fallback?: ReactNode;
  /** Polling cadence while a job is in flight. */
  activeIntervalMs?: number;
  /** Polling cadence once the cell has settled. */
  idleIntervalMs?: number;
  /** Label override for the empty-state CTA button. */
  emptyCtaLabel?: string;
  /**
   * Provenance display mode (OQ-1).
   *  - `"chip"` (default): collapsed `<ProvenanceChip>` above the payload.
   *  - `"row"`: always-visible `<ProvenanceRow>` below the payload.
   *    Reserved for synthesis cells + meal detail.
   */
  provenanceDisplay?: "chip" | "row";
  /** Wrapper class on the outer motion.div. */
  className?: string;
}

/**
 * Server-driven derived UI primitive. Wraps `useJobCell` polling and the
 * five visible states a JobCell can be in:
 *
 *   fetching       → `fallback` or a default skeleton block.
 *   ready_fresh    → render + freshness pill ("gerade berechnet" when < 5min).
 *   ready_cached   → render + "aus Cache" pill (no in-progress overlay).
 *   reprocessing   → render the cached payload + the
 *                    `<InProgressBadge variant="reprocessing">` pinned inline.
 *   error          → cached payload + retry pill, OR `<EmptyStateCard
 *                    cause="failed">` if nothing to fall back on.
 *   never_computed → `<EmptyStateCard cause="preflight">` with the cluster's
 *                    German CTA from `lib/derived/cluster-copy.ts`.
 *
 * The shared layoutId (`cell:<cluster>:<cellKey>`) plus motion-prefs
 * crossfade makes state swaps feel like a fade-through rather than a
 * remount. `useMotionPrefs()` zeroes the duration under
 * `prefers-reduced-motion: reduce`.
 */
export function DerivedCell<T = unknown>(props: DerivedCellProps<T>) {
  const {
    cluster,
    cellKey,
    scope = "daily",
    render,
    fallback,
    activeIntervalMs,
    idleIntervalMs,
    emptyCtaLabel,
    provenanceDisplay = "chip",
    className,
  } = props;

  const cell = useJobCell<T>({
    cluster,
    cellKey,
    scope,
    activeIntervalMs,
    idleIntervalMs,
  });
  const prefs = useMotionPrefs();

  const layoutId = `cell:${cluster}:${cellKey}`;
  const motionKey = `${cell.state}:${cell.updatedAt ?? "init"}`;

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={motionKey}
          layoutId={layoutId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefs.crossfadeDur, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-3"
        >
          <CellInner
            cluster={cluster}
            state={cell.state}
            payload={cell.payload}
            provenance={cell.provenance}
            errorText={cell.errorText}
            updatedAt={cell.updatedAt}
            render={render}
            fallback={fallback}
            emptyCtaLabel={emptyCtaLabel}
            provenanceDisplay={provenanceDisplay}
            requestEnqueue={cell.requestEnqueue}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface InnerProps<T> {
  cluster: string;
  state: CellState;
  payload: T | null;
  provenance: ProvenanceTag[];
  errorText: string | null;
  updatedAt: string | null;
  render: (
    payload: T,
    state: CellState,
    provenance: ProvenanceTag[],
    ctx?: DerivedCellRenderContext,
  ) => ReactNode;
  fallback?: ReactNode;
  emptyCtaLabel?: string;
  provenanceDisplay: "chip" | "row";
  requestEnqueue: () => Promise<void>;
}

function CellInner<T>({
  cluster,
  state,
  payload,
  provenance,
  errorText,
  updatedAt,
  render,
  fallback,
  emptyCtaLabel,
  provenanceDisplay,
  requestEnqueue,
}: InnerProps<T>) {
  // ── States with a payload to surface ──────────────────────────────────
  if (
    payload != null &&
    (state === "ready_fresh" ||
      state === "ready_cached" ||
      state === "reprocessing" ||
      state === "error")
  ) {
    const tone = clusterTone(cluster);
    const freshPill = <FreshnessPillView state={state} updatedAt={updatedAt} />;
    const rowOnly =
      provenanceDisplay === "row" && provenance.length > 0;
    const showUserEditedPill =
      provenanceDisplay === "row" && hasUserEdit(provenance);
    const showProvenanceChip = provenanceDisplay === "chip" && provenance.length > 0;

    const renderCtx: DerivedCellRenderContext = {
      statusPill: freshPill,
      updatedAt,
      state,
    };

    return (
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap empty:hidden">
          {showProvenanceChip && <ProvenanceChip tags={provenance} />}
          {freshPill}
          {showUserEditedPill && (
            <Pill tone="up" size="sm">
              Bearbeitet
            </Pill>
          )}
          {state === "reprocessing" && (
            <InProgressBadge
              variant="reprocessing"
              placement="inline"
              tone={tone === "neutral" ? "auto" : tone}
            />
          )}
          {state === "error" && (
            <>
              <Pill tone="s1" size="sm">
                Letzte Aktualisierung fehlgeschlagen
              </Pill>
              <button
                type="button"
                onClick={() => void requestEnqueue()}
                className="text-[0.6875rem] underline decoration-dotted text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Erneut versuchen
              </button>
            </>
          )}
        </div>
        {render(payload, state, provenance, renderCtx)}
        {rowOnly && <ProvenanceRow tags={provenance} />}
      </div>
    );
  }

  // ── States with no payload yet ─────────────────────────────────────────
  if (state === "fetching" || state === "ready_cached" || state === "reprocessing") {
    return <>{fallback ?? <DefaultSkeleton />}</>;
  }

  // When the JobCell is `never_computed` but the page server-loaded a payload
  // from disk (legacy file path), surface that. Keeps cold-start dashboards
  // useful while the JobCell migration is still in flight — without this the
  // cell shows an "Anfordern" CTA even though the data is right there.
  if (state === "never_computed" && fallback) {
    return <>{fallback}</>;
  }

  if (state === "error") {
    return (
      <EmptyStateCard
        cause="failed"
        cluster={cluster}
        reason={errorText ?? undefined}
        cta={{
          label: "Erneut versuchen",
          onClick: () => void requestEnqueue(),
        }}
      />
    );
  }

  // never_computed (no fallback)
  return (
    <EmptyStateCard
      cause="preflight"
      cluster={cluster}
      cta={{
        label: emptyCtaLabel ?? "Anfordern",
        onClick: () => void requestEnqueue(),
      }}
    />
  );
}

/**
 * Renders the freshness/cache pill. Self-tickling on a 30s interval while
 * `ready_fresh` so the "gerade berechnet" tag retires automatically as we
 * cross the 5-minute window without needing a full re-fold.
 */
function FreshnessPillView({
  state,
  updatedAt,
}: {
  state: CellState;
  updatedAt: string | null;
}): ReactNode {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (state !== "ready_fresh") return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [state]);
  const pill = freshnessPill(state, updatedAt, now);
  if (!pill) return null;
  return (
    <Pill tone={pill.tone} size="sm">
      {pill.label}
    </Pill>
  );
}

function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <Skeleton height="1.25rem" width="40%" />
      <SkeletonText lines={3} />
    </div>
  );
}
