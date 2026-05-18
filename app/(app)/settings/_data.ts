import "server-only";

/**
 * Sync read helpers for the settings pages. Split out from `_actions.ts`
 * because Next.js treats every export from a `"use server"` module as a
 * server action — and server actions must be async + serialisable.
 */

import { readStateKv } from "@/lib/data/period-store";

export interface AutoProcessKv {
  enabled: boolean;
}

export interface CriticKv {
  enabled: boolean;
}

export function readAutoProcessGlobal(): boolean {
  const v = readStateKv<AutoProcessKv>("settings:auto_process");
  return !!v?.enabled;
}

export function readCriticEnabled(): boolean {
  const v = readStateKv<CriticKv>("settings:critic_model");
  return !!v?.enabled;
}

export function readAutoProcessForCluster(
  cluster: string,
): "inherit" | "on" | "off" {
  const v = readStateKv<AutoProcessKv>(`settings:auto_process:${cluster}`);
  if (v == null || typeof v !== "object") return "inherit";
  if (typeof v.enabled !== "boolean") return "inherit";
  return v.enabled ? "on" : "off";
}

/**
 * German relative-time formatter used by the per-cluster settings rows.
 * Returns strings like:
 *   "gerade eben"
 *   "vor 3 Min."
 *   "vor 4 Std."
 *   "vor 2 Tagen"
 *   "vor 6 Wochen"
 *   "noch nicht gelaufen"   (when iso is null)
 *
 * Anchored to the SSR render moment (`new Date()`). Pure / synchronous so
 * it can compose inline inside the server-rendered page.
 */
export function formatRelativeDe(iso: string | null): string {
  if (!iso) return "noch nicht gelaufen";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unbekannt";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "gerade eben";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} Std.`;
  const day = Math.floor(hr / 24);
  if (day < 14) return day === 1 ? "vor 1 Tag" : `vor ${day} Tagen`;
  const week = Math.floor(day / 7);
  if (week < 8) return week === 1 ? "vor 1 Woche" : `vor ${week} Wochen`;
  const month = Math.floor(day / 30);
  return month === 1 ? "vor 1 Monat" : `vor ${month} Monaten`;
}
