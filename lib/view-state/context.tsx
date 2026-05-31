"use client";

/**
 * Client-side ViewState provider.
 *
 * Receives an initial snapshot from the server, then subscribes to
 * /api/view/<period_key>/sse for live updates. Re-renders consumers
 * via React context.
 *
 * Reconnect: if the SSE connection drops, EventSource reconnects on
 * its own with a 3s backoff. Heartbeat events from the server keep
 * proxies awake.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { Scope, SlotId, ViewState } from "@/runner/v4/types.ts";

interface ViewStateContextValue {
  period_key: string;
  scope: Scope;
  view: ViewState | null;
  /** True while the SSE stream is open. */
  connected: boolean;
  /** Last error from the SSE stream, if any. */
  error: string | null;
  /**
   * POST the retry endpoint for a slot. Returns the new view version.
   * Throws on non-200.
   */
  retrySlot: (slot_id: SlotId) => Promise<number>;
}

const ViewStateContext = createContext<ViewStateContextValue | null>(null);

export interface ViewStateProviderProps {
  period_key: string;
  scope: Scope;
  /** SSR-rendered initial view, if available. */
  initial: ViewState | null;
  children: ReactNode;
}

export function ViewStateProvider({
  period_key,
  scope,
  initial,
  children,
}: ViewStateProviderProps) {
  const [view, setView] = useState<ViewState | null>(initial);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/view/${period_key}/sse`;
    const es = new EventSource(url, { withCredentials: false });
    ref.current = es;

    const onOpen = (): void => {
      setConnected(true);
      setError(null);
    };
    const onView = (evt: MessageEvent<string>): void => {
      try {
        const next = JSON.parse(evt.data) as ViewState;
        setView(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    const onEmpty = (): void => {
      // file not yet written; keep `view` as whatever the SSR snapshot was
    };
    const onError = (): void => {
      setConnected(false);
    };

    es.addEventListener("open", onOpen);
    es.addEventListener("view", onView as EventListener);
    es.addEventListener("empty", onEmpty);
    es.addEventListener("error", onError);

    return () => {
      es.removeEventListener("open", onOpen);
      es.removeEventListener("view", onView as EventListener);
      es.removeEventListener("empty", onEmpty);
      es.removeEventListener("error", onError);
      es.close();
      ref.current = null;
    };
  }, [period_key]);

  const value = useMemo<ViewStateContextValue>(
    () => ({
      period_key,
      scope,
      view,
      connected,
      error,
      retrySlot: async (slot_id: SlotId) => {
        const r = await fetch(`/api/view/${period_key}/retry/${slot_id}`, {
          method: "POST",
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `retry failed (${r.status})`);
        }
        const body = (await r.json()) as { version: number };
        return body.version;
      },
    }),
    [period_key, scope, view, connected, error],
  );

  return (
    <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>
  );
}

export function useViewState(): ViewStateContextValue {
  const ctx = useContext(ViewStateContext);
  if (!ctx) {
    throw new Error("useViewState() used outside <ViewStateProvider>");
  }
  return ctx;
}
