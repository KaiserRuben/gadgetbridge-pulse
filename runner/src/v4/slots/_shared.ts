/**
 * Shared types + helpers for v4 slot packagers.
 *
 * Every slot's `buildPackage(ctx)` receives the same context shape and
 * returns a `SlotPackage<D>` with three sections:
 *
 *   meta    — period_key, generated_at, tz, slot_version
 *   tier1   — snapshot of the deterministic block at package time
 *   prior   — payloads of slots this one depends_on (or null if missing)
 *   domain  — slot-specific structured input (D parameter)
 *
 * The prompt scans `pkg` for numbers via grounding; everything visible to
 * the model must live somewhere inside the returned package.
 */

import type Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { SlotId, Tier1, ViewState } from "../types.ts";
import { ViewStateReader } from "../view-state/reader.ts";

/**
 * Context passed into every slot's `buildPackage`. Constructed by the
 * worker.
 */
export interface SlotBuildContext {
  /** Period key being computed (`YYYY-MM-DD` daily, `YYYY-Www` weekly). */
  period_key: string;
  /** `daily` or `weekly`. */
  scope: "daily" | "weekly";
  /** IANA timezone. */
  tz: string;
  /** Live DB handle (read-only, Gadgetbridge.db). */
  db: Database.Database;
  /** Insights root — historical facts for prior days. */
  insights_root: string;
  /** $PULSE_VIEW_ROOT — Pi view docs (or local copy via Syncthing). */
  view_root: string;
  /**
   * If set, prior-slot reads fetch via HTTP from the Pi instead of disk.
   * Mac slot builders set this so they see the authoritative view-state;
   * Pi-side builders leave it null and read their local view tree.
   */
  pi_base_url?: string;
  /** Current tier1 block (from view-state). */
  tier1: Tier1;
  /** Wall-clock the package is being built at. */
  now: Date;
}

/**
 * Reference to a prior slot's payload. Null payload means slot has not
 * computed yet — slots must declare degraded status if a hard dep is null.
 */
export interface PriorSlotPayload<P = unknown> {
  slot_id: SlotId;
  status: string;
  computed_at: string | null;
  payload: P | null;
}

export interface SlotPackageMeta {
  period_key: string;
  generated_at: string;
  tz: string;
  package_version: string;        // e.g. "night-review-package/v1"
}

export interface SlotPackage<D = Record<string, unknown>> {
  meta: SlotPackageMeta;
  tier1_snapshot: Tier1;
  prior: Record<string, PriorSlotPayload>;
  domain: D;
}

// ── Facts read helpers (Mac-side, read insights tree) ──────────────────────

export function readFactsForDate(
  insights_root: string,
  date: string,
): Record<string, unknown> | null {
  const p = path.join(insights_root, "daily", date, "_facts.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function shiftDateKey(key: string, daysBack: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - daysBack * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ── Prior slot reader (reads view-state, lifts payload) ─────────────────────

/**
 * Load a prior slot's payload for the current period. Reader is async; the
 * shared writer/reader contract handles parsing + schema_version check.
 */
export async function loadPriorSlot<P = unknown>(
  ctx: SlotBuildContext,
  slot_id: SlotId,
): Promise<PriorSlotPayload<P>> {
  const reader = new ViewStateReader({
    view_root: ctx.view_root,
    pi_base_url: ctx.pi_base_url,
  });
  const view = await reader.read(ctx.scope, ctx.period_key);
  if (!view) {
    return { slot_id, status: "missing", computed_at: null, payload: null };
  }
  const entry = pickSlotEntry<P>(view, slot_id);
  if (!entry) {
    return { slot_id, status: "missing", computed_at: null, payload: null };
  }
  return {
    slot_id,
    status: entry.status,
    computed_at: entry.computed_at,
    payload: entry.payload,
  };
}

interface ReadEntry<P> {
  status: string;
  computed_at: string | null;
  payload: P | null;
}

function pickSlotEntry<P>(view: ViewState, slot_id: SlotId): ReadEntry<P> | null {
  if (slot_id === "post_workout" || slot_id === "anomaly_explain") {
    const list = view.events[slot_id];
    if (!list || list.length === 0) return null;
    // Most recent by computed_at
    const sorted = [...list].sort((a, b) =>
      (b.computed_at ?? "").localeCompare(a.computed_at ?? ""),
    );
    return sorted[0] as unknown as ReadEntry<P>;
  }
  const slots = view.slots as unknown as Record<string, ReadEntry<P> | undefined>;
  return slots[slot_id] ?? null;
}

// ── Hashing (facts_hash field for InputsUsed) ──────────────────────────────

/**
 * Hash an object to a stable short string for InputsUsed.facts_hash.
 * Not crypto — purely cache key. djb2 over JSON.stringify.
 */
export function shortHash(obj: unknown): string {
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
