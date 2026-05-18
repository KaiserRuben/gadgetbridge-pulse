/**
 * Bridges the event bus to the JobCell layer. For every bus event we
 *   1. ask the cluster registry which cells the event invalidates
 *   2. flip those cells to status='pending' (markStale)
 *   3. if the cluster's auto_process setting is on, push a dispatch token
 *
 * Clusters that opt out of auto_process leave their cells in 'pending' for
 * the dashboard to surface as "needs reprocess" — the user enqueues
 * explicitly via POST /api/jobs/[cluster]/[key]/enqueue.
 *
 * Legacy-coexistence gate: while the v2/v3 orchestrator pipelines still run
 * the same LLM work on day_end / sleep_complete / workout_complete, the
 * cluster path would otherwise duplicate every call. LEGACY_HANDLES maps
 * (cluster, event-kind) → handled-by-legacy. Matched pairs are markStale'd
 * but never enqueued — the legacy path's pushInsight write flips the cell
 * back to 'complete'. Drop entries here as legacy producers are retired.
 */

import { bus, type EventKind, type PulseEvent } from "./bus.ts";
import { resolveStaleCells } from "../clusters/index.ts";
import { enqueue, markStale } from "../jobs/cell.ts";
import { readAutoProcessSetting } from "../jobs/settings.ts";
import { JobPriority } from "../jobs/types.ts";
import { log } from "../logger.ts";

const ALL_EVENT_KINDS: EventKind[] = [
  "sleep_complete",
  "workout_complete",
  "day_end",
  "manual",
  "meal_logged_pending",
  "meal_classified",
  "meal_edited",
];

/**
 * Cluster × event-kind pairs the legacy v2/v3 orchestrator still handles
 * inline. Drop entries as legacy producers retire. Same-cluster on a
 * different event (e.g. synthesis_v3 on workout_complete) is still
 * auto-processed — only the listed pairs are gated.
 */
const LEGACY_HANDLES: Record<string, EventKind[]> = {
  synthesis_v3: ["day_end", "manual"],
  morning_insight: ["day_end", "manual", "sleep_complete"],
  weekly_recap: ["day_end", "manual"],
};

function legacyHandles(cluster: string, ev: EventKind): boolean {
  const kinds = LEGACY_HANDLES[cluster];
  return kinds ? kinds.includes(ev) : false;
}

async function handle(ev: PulseEvent): Promise<void> {
  const cells = resolveStaleCells(ev);
  if (cells.length === 0) return;
  log.info(
    "jobs",
    `event=${ev.kind} period=${ev.periodKey} → stale ${cells.length} cell(s)`,
  );
  for (const cell of cells) {
    const reason = `event:${ev.kind}`;
    try {
      markStale(cell.cluster, cell.key, reason, cell.scope ?? "daily");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `markStale ${cell.cluster}/${cell.key}: ${msg}`);
      continue;
    }
    if (legacyHandles(cell.cluster, ev.kind)) {
      log.info(
        "jobs",
        `skip enqueue ${cell.cluster}/${cell.key} — legacy ${ev.kind} handles`,
      );
      continue;
    }
    let auto = false;
    try {
      auto = await readAutoProcessSetting(cell.cluster);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `readAutoProcessSetting ${cell.cluster}: ${msg}`);
    }
    if (!auto) continue;
    try {
      await enqueue({
        cluster: cell.cluster,
        key: cell.key,
        scope: cell.scope ?? "daily",
        priority: JobPriority.AutoProcess,
        reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("jobs", `enqueue ${cell.cluster}/${cell.key}: ${msg}`);
    }
  }
}

let _registered = false;

/**
 * Idempotent — calling twice from different boot paths only attaches the
 * handler set once. Registers across every EventKind so any future kind
 * also flows through the cell layer automatically (add the literal to
 * ALL_EVENT_KINDS and you're done).
 */
export function registerCellDispatcher(): void {
  if (_registered) return;
  _registered = true;
  for (const kind of ALL_EVENT_KINDS) {
    bus.on(kind, handle);
  }
}

export function _resetCellDispatcherForTests(): void {
  _registered = false;
}
