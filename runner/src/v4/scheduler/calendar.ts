/**
 * Slot calendar + due-slot resolver.
 *
 * Given the current view-state for a period, plus the registry, determine:
 *   - which slots are due to fire right now (scheduled_for ≤ now and status
 *     in {scheduled, errored-with-retry-elapsed, missed-but-recoverable})
 *   - topologically ordered by depends_on (compute prerequisites first)
 *   - within a topological layer, ordered by registry.priority desc
 *
 * Also exposes `applyBump(view, event, now)` — when an external event lands
 * (sleep_complete, workout_complete, day_end), walk every slot's
 * bump_events; for matching entries either re-anchor `scheduled_for` (when
 * status === "scheduled") or schedule a forced recompute (when
 * recompute_on_bump=true).
 *
 * Pure functions only — no I/O. The daemon (Phase 2 task #23) calls these
 * to drive the worker.
 */

import {
  ALL_SLOTS,
  DAILY_SLOTS,
  WEEKLY_SLOTS,
  EVENT_SLOTS,
  type BumpEvent,
  type SlotRegistryEntry,
} from "../slots/_registry.ts";
import type { Scope, SlotEntry, SlotId, ViewState } from "../types.ts";

export interface DueItem {
  slot_id: SlotId;
  scope: Scope;
  period_key: string;
  /** Why this slot was picked: regular schedule, an event bump, or a manual retry. */
  reason: "scheduled" | "bump" | "retry";
  priority: number;
  registry: SlotRegistryEntry;
}

export interface BumpResult {
  /** Modified view (caller writes via applyMeta + applySlot diffs). */
  next: ViewState;
  /** Slots whose scheduled_for was changed. */
  rescheduled: SlotId[];
  /** Slots flagged for forced recompute. */
  to_recompute: SlotId[];
}

/**
 * Return slots that are due to fire right now, ordered by depends_on
 * topological order then registry.priority desc.
 *
 * Status decisions:
 *   - "scheduled"  → due when scheduled_for ≤ now
 *   - "errored"    → due when error.retry_after_ms has elapsed since
 *                    computed_at (worker stores retry timestamps in error)
 *   - "missed"     → due immediately (worker may decide to abstain)
 *   - everything else (computing, fresh, aging, stale, abstained, degraded)
 *     stays put — caller drains those via different paths (retry / TTL roll).
 */
export function pickDueSlots(view: ViewState, now: Date = new Date()): DueItem[] {
  const slotsForScope = view.scope === "daily" ? DAILY_SLOTS : WEEKLY_SLOTS;
  const ready: DueItem[] = [];

  for (const reg of slotsForScope) {
    const entry = (view.slots as unknown as Record<string, SlotEntry | undefined>)[reg.slot_id];
    if (!entry) continue;
    if (!isDue(entry, reg, now)) continue;
    ready.push({
      slot_id: reg.slot_id,
      scope: reg.scope,
      period_key: view.period_key,
      reason: entry.status === "errored" ? "retry" : "scheduled",
      priority: reg.priority,
      registry: reg,
    });
  }

  return topoSort(ready);
}

function isDue(entry: SlotEntry, reg: SlotRegistryEntry, now: Date): boolean {
  const scheduled = Date.parse(entry.scheduled_for);
  if (Number.isNaN(scheduled)) return false;
  if (scheduled > now.getTime()) return false;
  switch (entry.status) {
    case "scheduled":
    case "missed":
      return true;
    case "errored": {
      const retryAfter = entry.error?.retry_after_ms ?? null;
      if (retryAfter == null) return false;
      const computedAt = entry.computed_at ? Date.parse(entry.computed_at) : scheduled;
      return now.getTime() - computedAt >= retryAfter;
    }
    case "degraded":
    case "abstained":
      // Only re-run on bump or manual — pickDueSlots does not auto-loop these.
      return false;
    case "fresh":
    case "aging":
    case "stale":
    case "computing":
      return false;
  }
  void reg;
  return false;
}

/**
 * Topological sort by depends_on. Items not in `due` are treated as
 * resolved (we don't enqueue dependencies — they had their chance).
 * Stable secondary sort by priority desc within a layer.
 */
function topoSort(due: DueItem[]): DueItem[] {
  if (due.length <= 1) return due;
  const dueIds = new Set(due.map((d) => d.slot_id));
  const remaining = [...due];
  const out: DueItem[] = [];
  const placed = new Set<SlotId>();
  // Loop bounded by remaining.length — guards against cyclic deps (won't
  // happen with the current registry but it's cheap insurance).
  for (let safety = 0; safety < due.length + 1 && remaining.length > 0; safety++) {
    const layer = remaining.filter((d) =>
      d.registry.depends_on.every((dep) => !dueIds.has(dep) || placed.has(dep)),
    );
    if (layer.length === 0) {
      // Cycle — append remaining in priority order to make forward progress.
      remaining.sort((a, b) => b.priority - a.priority);
      out.push(...remaining);
      return out;
    }
    layer.sort((a, b) => b.priority - a.priority);
    for (const item of layer) {
      out.push(item);
      placed.add(item.slot_id);
    }
    for (const item of layer) {
      const idx = remaining.indexOf(item);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }
  return out;
}

/**
 * Apply an external event bump to a view. Returns a new ViewState with
 * scheduled_for updates and a list of slots that should be force-recomputed.
 *
 * Caller is expected to write the result back via the writer (using one
 * SlotDiff per touched slot). This function is pure — does not write itself.
 */
export function applyBump(
  view: ViewState,
  event: BumpEvent,
  eventAt: Date = new Date(),
): BumpResult {
  const next = JSON.parse(JSON.stringify(view)) as ViewState;
  const rescheduled: SlotId[] = [];
  const toRecompute: SlotId[] = [];

  for (const reg of ALL_SLOTS) {
    const bump = reg.bump_events.find((b) => b.event === event);
    if (!bump) continue;
    const target = (next.slots as unknown as Record<string, SlotEntry | undefined>)[reg.slot_id];
    if (!target) continue;
    const newSchedule = new Date(eventAt.getTime() + bump.offset_ms).toISOString();
    // If slot is still 'scheduled', re-anchor scheduled_for. If it was
    // already fresh/aging/stale and recompute_on_bump, schedule a forced
    // re-run.
    const isWaiting = target.status === "scheduled" || target.status === "missed" ||
      target.status === "errored";
    if (isWaiting) {
      target.scheduled_for = newSchedule;
      rescheduled.push(reg.slot_id);
    } else if (bump.recompute_on_bump) {
      target.scheduled_for = newSchedule;
      target.status = "scheduled";
      rescheduled.push(reg.slot_id);
      toRecompute.push(reg.slot_id);
    }
  }

  return { next, rescheduled, to_recompute: toRecompute };
}

/**
 * Status decay: tick existing slots forward. Promotes fresh→aging→stale,
 * and scheduled→missed once scheduled_for + ttl is past without a compute.
 *
 * Pure — produces a new ViewState; caller writes diffs.
 */
export function decayStatuses(view: ViewState, now: Date = new Date()): ViewState {
  const next = JSON.parse(JSON.stringify(view)) as ViewState;
  const nowMs = now.getTime();

  const sweep = (slot: SlotEntry, reg: SlotRegistryEntry): void => {
    const scheduledMs = Date.parse(slot.scheduled_for);
    const ttl = reg.ttl_ms;
    if (slot.status === "scheduled" && Number.isFinite(scheduledMs) && nowMs > scheduledMs + ttl) {
      slot.status = "missed";
      return;
    }
    if (slot.status === "fresh" || slot.status === "aging") {
      const computedMs = slot.computed_at ? Date.parse(slot.computed_at) : NaN;
      if (Number.isFinite(computedMs)) {
        const age = nowMs - computedMs;
        if (age >= ttl) {
          slot.status = "stale";
        } else if (age >= ttl / 3) {
          slot.status = "aging";
        }
      }
    }
  };

  const slotsByScope = next.scope === "daily" ? DAILY_SLOTS : WEEKLY_SLOTS;
  for (const reg of slotsByScope) {
    const slot = (next.slots as unknown as Record<string, SlotEntry | undefined>)[reg.slot_id];
    if (slot) sweep(slot, reg);
  }
  // Event slot lists also decay.
  for (const reg of EVENT_SLOTS) {
    const list = (next.events as unknown as Record<string, SlotEntry[]>)[reg.slot_id] ?? [];
    for (const entry of list) sweep(entry, reg);
  }
  return next;
}
