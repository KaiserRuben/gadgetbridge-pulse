/**
 * Pure CellState derivation — the same mapping the
 * /api/jobs/[cluster]/[key] route already does on the server, restated
 * here so the client hook can reason about transitions consistently and
 * the logic is unit-testable without spinning up Next.
 *
 * Server enum:   never_computed | reprocessing | ready_cached | ready_fresh | error
 * Client enum:   add "fetching" for the first round-trip before any
 *                response lands. We also re-derive "reprocessing" from
 *                a cached-payload + new "never_computed" response so the
 *                user keeps seeing the previous body while we wait.
 */

import type { ProvenanceTag } from "@/runner/jobs/types";

export type CellState =
  | "fetching"
  | "ready_cached"
  | "ready_fresh"
  | "reprocessing"
  | "error"
  | "never_computed";

/** Shape returned by the /api/jobs/[cluster]/[key] GET route. */
export interface CellApiResponse<T = unknown> {
  state: "never_computed" | "reprocessing" | "ready_cached" | "ready_fresh" | "error";
  payload: T | null;
  provenance: ProvenanceTag[];
  started_at: string | null;
  error_text: string | null;
  updated_at: string;
}

/** Internal client snapshot — what useJobCell exposes to consumers. */
export interface CellSnapshot<T = unknown> {
  state: CellState;
  /** Payload from the latest non-error response. Survives reprocessing. */
  payload: T | null;
  /** Provenance tied to the surfaced payload. */
  provenance: ProvenanceTag[];
  /** Server-reported started_at, or null. */
  startedAt: string | null;
  /** Server-reported terminal error text. */
  errorText: string | null;
  /** Last successful response ISO. */
  updatedAt: string | null;
}

export function initialSnapshot<T>(): CellSnapshot<T> {
  return {
    state: "fetching",
    payload: null,
    provenance: [],
    startedAt: null,
    errorText: null,
    updatedAt: null,
  };
}

/**
 * Fold a fresh server response into the previous client snapshot. The key
 * invariants:
 *
 *  - A payload, once seen, is *never* dropped while we keep polling. If the
 *    server transitions to never_computed/reprocessing/error, we keep the
 *    cached body and just flip the surfaced state so the cell can render
 *    its "Cached delivery" + "Working on a new one ✨" overlay.
 *  - A fresh ready_fresh response always replaces both payload and
 *    provenance with the new values.
 *  - The "error" state only collapses the payload when there was no prior
 *    one — preserving cached delivery on transient failures.
 */
export function foldResponse<T>(
  prev: CellSnapshot<T>,
  res: CellApiResponse<T>,
): CellSnapshot<T> {
  const cachedPayload = prev.payload;
  const cachedProvenance = prev.provenance;

  switch (res.state) {
    case "ready_fresh":
      return {
        state: "ready_fresh",
        payload: res.payload,
        provenance: res.provenance ?? [],
        startedAt: res.started_at,
        errorText: null,
        updatedAt: res.updated_at,
      };
    case "ready_cached":
      // Server says: row exists with a payload but bundle is pending.
      // Treat as "reprocessing" only when there's an in-flight lease — the
      // server already encodes that distinction.
      return {
        state: "ready_cached",
        payload: res.payload ?? cachedPayload,
        provenance:
          res.provenance && res.provenance.length > 0
            ? res.provenance
            : cachedProvenance,
        startedAt: res.started_at,
        errorText: null,
        updatedAt: res.updated_at,
      };
    case "reprocessing":
      return {
        state: "reprocessing",
        payload: res.payload ?? cachedPayload,
        provenance:
          res.provenance && res.provenance.length > 0
            ? res.provenance
            : cachedProvenance,
        startedAt: res.started_at,
        errorText: null,
        updatedAt: res.updated_at,
      };
    case "error":
      return {
        state: "error",
        // Preserve cached body if the server has cleared the payload on
        // failure; otherwise show what the server returned.
        payload: res.payload ?? cachedPayload,
        provenance:
          res.provenance && res.provenance.length > 0
            ? res.provenance
            : cachedProvenance,
        startedAt: res.started_at,
        errorText: res.error_text,
        updatedAt: res.updated_at,
      };
    case "never_computed":
    default:
      // If we already have a cached payload from a prior request, keep
      // showing it and surface a reprocessing badge. Otherwise it's the
      // empty CTA state.
      if (cachedPayload != null) {
        return {
          state: "reprocessing",
          payload: cachedPayload,
          provenance: cachedProvenance,
          startedAt: res.started_at,
          errorText: null,
          updatedAt: res.updated_at,
        };
      }
      return {
        state: "never_computed",
        payload: null,
        provenance: [],
        startedAt: res.started_at,
        errorText: null,
        updatedAt: res.updated_at,
      };
  }
}

/**
 * True when the cell is still in flight (poll fast) versus settled
 * (poll slow / idle).
 */
export function isActive(state: CellState): boolean {
  return state === "fetching" || state === "reprocessing";
}

/** Builds the GET URL for a cell. Encodes cluster + key for safety. */
export function buildCellUrl(
  cluster: string,
  key: string,
  scope: "daily" | "weekly" = "daily",
): string {
  return `/api/jobs/${encodeURIComponent(cluster)}/${encodeURIComponent(key)}?scope=${scope}`;
}

/** Builds the POST enqueue URL for a cell. */
export function buildEnqueueUrl(
  cluster: string,
  key: string,
  scope: "daily" | "weekly" = "daily",
): string {
  return `/api/jobs/${encodeURIComponent(cluster)}/${encodeURIComponent(key)}/enqueue?scope=${scope}`;
}
