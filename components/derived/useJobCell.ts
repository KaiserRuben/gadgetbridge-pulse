"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildCellUrl,
  buildEnqueueUrl,
  type CellApiResponse,
  type CellSnapshot,
  foldResponse,
  initialSnapshot,
  isActive,
} from "@/lib/derived/state";

export interface UseJobCellOptions {
  cluster: string;
  cellKey: string;
  scope?: "daily" | "weekly";
  /** Poll interval while fetching/reprocessing. Default 2000ms. */
  activeIntervalMs?: number;
  /** Poll interval once settled. Default 30000ms. */
  idleIntervalMs?: number;
}

export interface UseJobCellResult<T = unknown> extends CellSnapshot<T> {
  /** POST /api/jobs/.../enqueue then optimistically flip to fetching. */
  requestEnqueue: () => Promise<void>;
  /** Force an immediate refresh outside the poll cadence. */
  refresh: () => Promise<void>;
}

/**
 * Polling hook for one server-side JobCell. Wraps fetch/poll cadence,
 * cached-delivery folding, and the user-requested enqueue action. The
 * pure folding logic lives in `lib/derived/state` so it stays unit-
 * testable independently of React.
 */
export function useJobCell<T = unknown>({
  cluster,
  cellKey,
  scope = "daily",
  activeIntervalMs = 2000,
  idleIntervalMs = 30_000,
}: UseJobCellOptions): UseJobCellResult<T> {
  const [snap, setSnap] = useState<CellSnapshot<T>>(() => initialSnapshot<T>());
  // Ref mirror so the polling callback always reads the latest state
  // without re-binding the timeout on every snapshot change.
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const url = buildCellUrl(cluster, cellKey, scope);
  const enqueueUrl = buildEnqueueUrl(cluster, cellKey, scope);

  const fetchOnce = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(url, { cache: "no-store", signal: ac.signal });
      if (!res.ok) throw new Error(`cell fetch ${res.status}`);
      const body = (await res.json()) as CellApiResponse<T>;
      if (!mountedRef.current) return;
      setSnap((prev) => foldResponse(prev, body));
    } catch (err) {
      if (ac.signal.aborted) return;
      if (!mountedRef.current) return;
      // Network failure shouldn't blow away cached delivery — just leave
      // the snapshot alone and let the next tick try again. The user-
      // visible error states are server-driven.
      // eslint-disable-next-line no-console
      console.warn("[useJobCell] poll failed", err);
    }
  }, [url]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = isActive(snapRef.current.state)
      ? activeIntervalMs
      : idleIntervalMs;
    timerRef.current = setTimeout(async () => {
      await fetchOnce();
      if (mountedRef.current) schedule();
    }, delay);
  }, [fetchOnce, activeIntervalMs, idleIntervalMs]);

  // Initial fetch + poll loop.
  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      await fetchOnce();
      if (mountedRef.current) schedule();
    })();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchOnce, schedule]);

  const requestEnqueue = useCallback(async (): Promise<void> => {
    // Flip to fetching immediately so the next render shows the
    // skeleton/spinner instead of the stale CTA.
    setSnap((prev) => ({
      ...prev,
      state: prev.payload != null ? "reprocessing" : "fetching",
      errorText: null,
    }));
    try {
      const res = await fetch(enqueueUrl, { method: "POST" });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn("[useJobCell] enqueue failed", res.status);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[useJobCell] enqueue threw", err);
    }
    // Pull the new server state right away.
    await fetchOnce();
  }, [enqueueUrl, fetchOnce]);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchOnce();
  }, [fetchOnce]);

  return { ...snap, requestEnqueue, refresh };
}
