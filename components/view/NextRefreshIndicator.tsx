"use client";

import { useEffect, useState } from "react";

import { useViewState } from "@/lib/view-state/context";

/**
 * Tiny "next slot fires at…" hint. Re-renders every 30s so the relative
 * time stays current without the rest of the dashboard flickering.
 */
export function NextRefreshIndicator({ className }: { className?: string }) {
  const { view } = useViewState();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = view?.meta?.next_refresh_at;
  if (!next) return null;

  const target = new Date(next);
  if (Number.isNaN(target.getTime())) return null;
  const deltaMs = target.getTime() - Date.now();

  return (
    <span className={className}>
      Nächste Auffrischung {formatRelative(deltaMs, target)}
    </span>
  );
}

function formatRelative(deltaMs: number, target: Date): string {
  if (deltaMs <= 0) return "gleich";
  const min = Math.round(deltaMs / 60_000);
  if (min < 60) return `in ${min} min`;
  return `um ${target.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}
