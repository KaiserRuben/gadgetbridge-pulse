/**
 * v4 scheduler daemon.
 *
 * Single-tick orchestration:
 *   1. Build tier1 for the current period (deterministic, no LLM).
 *   2. POST Tier1Diff to Pi (CAS-checked).
 *   3. Read latest view (after our tier1 write) for current expected_version.
 *   4. Decay slot statuses (fresh → aging → stale; scheduled → missed).
 *   5. Pick due fixed slots in topological order; for each, dispatch → SlotDiff → outbox.
 *   6. Scan event slots — pick `scheduled` entries past scheduled_for and dispatch
 *      until the shared per-tick budget (MAX_SLOTS_PER_TICK) is exhausted.
 *   7. Drain outbox queue for any earlier failures.
 *
 * Tick cadence: every 60s by default. Caller (CLI / docker) wires the
 * interval timer + signal handlers.
 *
 * Event-bump path (chokidar / manual):
 *   `applyBumpEvent(event, scope, key, payload)` reads view, re-anchors
 *   fixed slots via `applyBump`, and (for workout_complete with a valid
 *   payload) immediately dispatches a post_workout event slot keyed by
 *   the workout's start_iso. Subsequent re-fires upsert by event_id.
 */

import type Database from "better-sqlite3";

import { ViewStateReader } from "../view-state/reader.ts";
import { Outbox } from "../transport/outbox.ts";
import { buildTier1 as defaultBuildTier1 } from "../tier1/refresher.ts";
import type { Tier1 } from "../types.ts";
import { dispatchSlot } from "../worker/dispatch.ts";
import type { SlotEventRef } from "../worker/slot-handlers.ts";
import { applyBump, decayStatuses, pickDueSlots } from "./calendar.ts";
import { getSlotEntry } from "../slots/_registry.ts";
import type {
  AnyDiff,
} from "../transport/outbox.ts";
import type { OllamaResult } from "../../ollama.ts";
import type {
  BumpEvent,
} from "../slots/_registry.ts";
import type { PostWorkoutEventRef } from "../slots/post-workout/package.ts";
import type {
  EventSlotId,
  MetaDiff,
  PostWorkoutSlotEntry,
  AnomalyExplainSlotEntry,
  Scope,
  SlotDiff,
  SlotEntry,
  Tier1Diff,
  ViewState,
} from "../types.ts";

const TZ_DEFAULT = "Europe/Berlin";
const MAX_SLOTS_PER_TICK = 4;
const TIER1_TTL_MS = 5 * 60 * 1000;

export interface DaemonOptions {
  db: Database.Database;
  insights_root: string;
  view_root: string;
  outbox: Outbox;
  /**
   * If set, the daemon's reader fetches view state from the Pi over HTTP
   * (so Mac CAS uses Pi's authoritative version, not a stale local copy).
   * Disk mode otherwise — used by tests + the Pi-resident daemon.
   */
  pi_base_url?: string;
  tz?: string;
  /** Caller-injected LLM dispatcher (tests). */
  invoker?: (system: string, user: string) => Promise<OllamaResult>;
  /** Override now() for tests. */
  now?: () => Date;
  /** Period resolver: returns the daily period_key to run for. */
  resolvePeriodKey?: (now: Date, tz: string) => string;
  /** Test seam: override the tier1 builder (defaults to real buildTier1). */
  buildTier1?: (period_key: string, now: Date) => Promise<Tier1>;
}

export interface TickReport {
  period_key: string;
  tier1_submitted: boolean;
  tier1_version_after: number | null;
  slots_dispatched: string[];
  slots_succeeded: string[];
  slots_errored: string[];
  event_slots_dispatched: string[];
  event_slots_succeeded: string[];
  event_slots_errored: string[];
  outbox_drained: number;
  outbox_failures: number;
  ms_total: number;
  notes: string[];
}

export class SchedulerDaemon {
  private readonly db: Database.Database;
  private readonly insightsRoot: string;
  private readonly viewRoot: string;
  private readonly outbox: Outbox;
  private readonly reader: ViewStateReader;
  private readonly piBaseUrl: string | null;
  private readonly tz: string;
  private readonly invoker?: (system: string, user: string) => Promise<OllamaResult>;
  private readonly now: () => Date;
  private readonly resolvePeriodKey: (now: Date, tz: string) => string;
  private readonly tier1Builder: (period_key: string, now: Date) => Promise<Tier1>;
  private lastTier1At: Date | null = null;

  constructor(opts: DaemonOptions) {
    this.db = opts.db;
    this.insightsRoot = opts.insights_root;
    this.viewRoot = opts.view_root;
    this.outbox = opts.outbox;
    this.piBaseUrl = opts.pi_base_url ?? null;
    this.reader = new ViewStateReader({
      view_root: opts.view_root,
      pi_base_url: opts.pi_base_url,
    });
    this.tz = opts.tz ?? TZ_DEFAULT;
    this.invoker = opts.invoker;
    this.now = opts.now ?? (() => new Date());
    this.resolvePeriodKey = opts.resolvePeriodKey ?? defaultPeriodKey;
    this.tier1Builder = opts.buildTier1 ?? ((periodKey, now) =>
      defaultBuildTier1({
        period_key: periodKey,
        db: this.db,
        insights_root: this.insightsRoot,
        tz: this.tz,
        now,
      }));
  }

  /** One full pass — tier1 + due slots + queue drain. Returns a report. */
  async tick(): Promise<TickReport> {
    const t0 = Date.now();
    const now = this.now();
    const periodKey = this.resolvePeriodKey(now, this.tz);
    const report: TickReport = {
      period_key: periodKey,
      tier1_submitted: false,
      tier1_version_after: null,
      slots_dispatched: [],
      slots_succeeded: [],
      slots_errored: [],
      event_slots_dispatched: [],
      event_slots_succeeded: [],
      event_slots_errored: [],
      outbox_drained: 0,
      outbox_failures: 0,
      ms_total: 0,
      notes: [],
    };

    // 1. Drain any previously queued outbox items first.
    const drain = await this.outbox.drainQueue();
    report.outbox_drained = drain.replayed;
    report.outbox_failures = drain.remaining;
    if (drain.remaining > 0) report.notes.push(`${drain.remaining} items still queued`);

    // 2. Tier1 (skip if computed within last TIER1_TTL_MS — tier1 changes
    // every 60s nominally but the Pi accepts incremental writes; the gate
    // is just to avoid hammering on short ticks).
    const refreshTier1 =
      this.lastTier1At === null ||
      now.getTime() - this.lastTier1At.getTime() >= TIER1_TTL_MS;
    let viewAfterTier1: ViewState | null = null;
    if (refreshTier1) {
      try {
        const tier1 = await this.tier1Builder(periodKey, now);
        const existingView = await this.reader.read("daily", periodKey);
        const expected = existingView?.version ?? 0;
        const diff: Tier1Diff = {
          scope: "daily",
          period_key: periodKey,
          tier1,
          expected_version: expected,
        };
        const result = await this.outbox.submit({ kind: "tier1", diff });
        if (result.ok) {
          report.tier1_submitted = true;
          report.tier1_version_after = result.current_version;
          this.lastTier1At = now;
        } else if (result.status === 409) {
          report.notes.push(`tier1 CAS conflict (current=${result.current_version})`);
        } else {
          report.notes.push(`tier1 submit failed: ${result.error}`);
        }
      } catch (err) {
        report.notes.push(`tier1 build failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      report.notes.push("tier1 skipped (within TTL)");
    }

    // 3. Re-read view post-tier1 for CAS base.
    viewAfterTier1 = await this.reader.read("daily", periodKey);
    if (!viewAfterTier1) {
      report.notes.push("view not present after tier1 — skipping slot dispatch");
      report.ms_total = Date.now() - t0;
      return report;
    }

    // 4. Decay statuses. We don't write the decay back — it's a read-side
    // hint for pickDueSlots. The actual status flip lands on next compute.
    const decayed = decayStatuses(viewAfterTier1, now);

    // 5. Pick due slots.
    const due = pickDueSlots(decayed, now);
    const toRun = due.slice(0, MAX_SLOTS_PER_TICK);
    let expectedVersion = viewAfterTier1.version;
    const tier1 = decayed.tier1;
    let budgetRemaining = MAX_SLOTS_PER_TICK;

    for (const item of toRun) {
      report.slots_dispatched.push(item.slot_id);
      budgetRemaining--;
      const reg = getSlotEntry(item.slot_id);
      const existing = (viewAfterTier1.slots as unknown as Record<string, SlotEntry | undefined>)[
        item.slot_id
      ];
      const scheduledFor = existing?.scheduled_for ?? now.toISOString();

      try {
        const result = await dispatchSlot({
          slot_id: item.slot_id,
          ctx: {
            period_key: periodKey,
            scope: reg.scope,
            tz: this.tz,
            db: this.db,
            insights_root: this.insightsRoot,
            view_root: this.viewRoot,
            pi_base_url: this.piBaseUrl ?? undefined,
            tier1,
            now,
          },
          expected_view_version: expectedVersion,
          existing: existing ?? null,
          ttl_ms: reg.ttl_ms,
          scheduled_for: scheduledFor,
          model: reg.model,
          invoker: this.invoker,
        });
        const submit = await this.outbox.submit({ kind: "slot", diff: result.diff });
        if (submit.ok) {
          if (result.diff.entry.status === "errored") report.slots_errored.push(item.slot_id);
          else report.slots_succeeded.push(item.slot_id);
          if (submit.current_version != null) expectedVersion = submit.current_version;
        } else if (submit.status === 409) {
          report.notes.push(`slot ${item.slot_id} CAS conflict (current=${submit.current_version})`);
          if (submit.current_version != null) expectedVersion = submit.current_version;
        } else {
          report.slots_errored.push(item.slot_id);
          report.notes.push(`slot ${item.slot_id} submit failed: ${submit.error}`);
        }
      } catch (err) {
        report.slots_errored.push(item.slot_id);
        report.notes.push(
          `slot ${item.slot_id} dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 6. Event slots — scan for `scheduled` entries with scheduled_for ≤ now.
    expectedVersion = await this.processDueEventSlots({
      view: viewAfterTier1,
      tier1,
      periodKey,
      now,
      expectedVersion,
      budgetRemaining,
      report,
    });

    report.ms_total = Date.now() - t0;
    return report;
  }

  /**
   * Bump scheduled_for on fixed slots matching `event` and submit re-anchoring
   * SlotDiffs. For `workout_complete` with a valid payload, also dispatches a
   * post_workout event slot immediately (upsert by event_id).
   */
  async applyBumpEvent(
    event: BumpEvent,
    scope: Scope,
    periodKey: string,
    payload?: Record<string, unknown>,
  ): Promise<string[]> {
    const view = await this.reader.read(scope, periodKey);
    if (!view) return [];
    const now = this.now();
    const { next, rescheduled } = applyBump(view, event, now);

    let expectedVersion = view.version;
    const touched: string[] = [];
    for (const slot_id of rescheduled) {
      const entry = (next.slots as unknown as Record<string, SlotEntry | undefined>)[slot_id];
      if (!entry) continue;
      const diff: SlotDiff = {
        scope,
        period_key: periodKey,
        slot_id,
        entry,
        expected_version: expectedVersion,
      };
      const result = await this.outbox.submit({ kind: "slot", diff });
      if (result.ok && result.current_version != null) {
        expectedVersion = result.current_version;
        touched.push(slot_id);
      } else if (result.status === 409 && result.current_version != null) {
        expectedVersion = result.current_version;
      }
    }

    if (event === "workout_complete" && payload) {
      const eventRef = workoutEventRef(payload);
      if (eventRef) {
        const refreshed = await this.reader.read(scope, periodKey);
        const baseView = refreshed ?? next;
        const dispatched = await this.dispatchEventSlot({
          slot_id: "post_workout",
          view: baseView,
          periodKey,
          eventRef: { post_workout: eventRef },
          expectedVersion: refreshed ? baseView.version : expectedVersion,
          tier1: baseView.tier1,
          now,
        });
        if (dispatched.dispatched) touched.push("post_workout");
      }
    }

    return touched;
  }

  // ── Event slot helpers ─────────────────────────────────────────────────

  private findEventEntry(
    view: ViewState,
    slot_id: EventSlotId,
    event_id: string,
  ): PostWorkoutSlotEntry | AnomalyExplainSlotEntry | null {
    const list = view.events[slot_id] as Array<PostWorkoutSlotEntry | AnomalyExplainSlotEntry>;
    return list.find((e) => e.event_id === event_id) ?? null;
  }

  private isFreshEnough(entry: SlotEntry): boolean {
    return (
      entry.status === "fresh" ||
      entry.status === "aging" ||
      entry.status === "computing"
    );
  }

  /**
   * Dispatch one event slot end-to-end: build package, invoke LLM, submit
   * the diff. Skips when a non-stale matching entry already exists.
   * Returns whether the dispatch ran + the latest expectedVersion the
   * caller should use for follow-on writes.
   */
  private async dispatchEventSlot(args: {
    slot_id: EventSlotId;
    view: ViewState;
    periodKey: string;
    eventRef: SlotEventRef;
    expectedVersion: number;
    tier1: Tier1;
    now: Date;
  }): Promise<{ dispatched: boolean; expectedVersion: number; status: SlotEntry["status"] | null }> {
    const { slot_id, view, periodKey, eventRef, tier1, now } = args;
    let expectedVersion = args.expectedVersion;
    const ref = eventRef[slot_id];
    if (!ref) return { dispatched: false, expectedVersion, status: null };
    const eventId = ref.event_id;
    const existing = this.findEventEntry(view, slot_id, eventId);
    if (existing && this.isFreshEnough(existing)) {
      return { dispatched: false, expectedVersion, status: existing.status };
    }
    const reg = getSlotEntry(slot_id);
    const scheduledFor = existing?.scheduled_for ?? now.toISOString();

    const result = await dispatchSlot({
      slot_id,
      ctx: {
        period_key: periodKey,
        scope: reg.scope,
        tz: this.tz,
        db: this.db,
        insights_root: this.insightsRoot,
        view_root: this.viewRoot,
        pi_base_url: this.piBaseUrl ?? undefined,
        tier1,
        now,
      },
      event: eventRef,
      expected_view_version: expectedVersion,
      existing: existing ?? null,
      ttl_ms: reg.ttl_ms,
      scheduled_for: scheduledFor,
      model: reg.model,
      invoker: this.invoker,
    });

    const submit = await this.outbox.submit({ kind: "slot", diff: result.diff });
    if (submit.ok) {
      if (submit.current_version != null) expectedVersion = submit.current_version;
      return { dispatched: true, expectedVersion, status: result.diff.entry.status };
    }
    if (submit.status === 409 && submit.current_version != null) {
      expectedVersion = submit.current_version;
    }
    return { dispatched: false, expectedVersion, status: result.diff.entry.status };
  }

  private async processDueEventSlots(args: {
    view: ViewState;
    tier1: Tier1;
    periodKey: string;
    now: Date;
    expectedVersion: number;
    budgetRemaining: number;
    report: TickReport;
  }): Promise<number> {
    const { view, tier1, periodKey, now, report } = args;
    let expectedVersion = args.expectedVersion;
    let budget = args.budgetRemaining;
    const nowIso = now.toISOString();

    for (const slot_id of EVENT_SLOT_IDS_FOR_DISPATCH) {
      if (budget <= 0) break;
      const list = view.events[slot_id] as Array<PostWorkoutSlotEntry | AnomalyExplainSlotEntry>;
      const due = list.filter((e) => e.status === "scheduled" && e.scheduled_for <= nowIso);
      for (const entry of due) {
        if (budget <= 0) break;
        const eventRef = eventRefFromEntry(slot_id, entry);
        if (!eventRef) continue;
        report.event_slots_dispatched.push(`${slot_id}:${entry.event_id}`);
        budget--;
        try {
          const outcome = await this.dispatchEventSlot({
            slot_id,
            view,
            periodKey,
            eventRef,
            expectedVersion,
            tier1,
            now,
          });
          expectedVersion = outcome.expectedVersion;
          if (outcome.dispatched && outcome.status && outcome.status !== "errored") {
            report.event_slots_succeeded.push(`${slot_id}:${entry.event_id}`);
          } else if (outcome.status === "errored") {
            report.event_slots_errored.push(`${slot_id}:${entry.event_id}`);
          }
        } catch (err) {
          report.event_slots_errored.push(`${slot_id}:${entry.event_id}`);
          report.notes.push(
            `event slot ${slot_id} dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return expectedVersion;
  }

  /** Post a MetaDiff (heartbeat / pipeline_health). */
  async heartbeat(): Promise<boolean> {
    const periodKey = this.resolvePeriodKey(this.now(), this.tz);
    const view = await this.reader.read("daily", periodKey);
    if (!view) return false;
    const diff: MetaDiff = {
      scope: "daily",
      period_key: periodKey,
      meta: { last_runner_heartbeat: this.now().toISOString() },
      expected_version: view.version,
    };
    const result = await this.outbox.submit({ kind: "meta", diff });
    return result.ok;
  }
}

// ── Event slot helpers ──────────────────────────────────────────────────

const EVENT_SLOT_IDS_FOR_DISPATCH: EventSlotId[] = ["post_workout", "anomaly_explain"];

function workoutEventRef(payload: Record<string, unknown>): PostWorkoutEventRef | null {
  const startIso = payload.start_iso;
  const endIso = payload.end_iso;
  const kind = payload.kind;
  if (typeof startIso !== "string" || typeof endIso !== "string" || typeof kind !== "number") {
    return null;
  }
  return {
    event_id: startIso,
    ts_start_iso: startIso,
    ts_end_iso: endIso,
    kind,
  };
}

function eventRefFromEntry(
  slot_id: EventSlotId,
  entry: PostWorkoutSlotEntry | AnomalyExplainSlotEntry,
): SlotEventRef | null {
  if (slot_id === "post_workout") {
    const pw = entry as PostWorkoutSlotEntry;
    if (!pw.workout_ref) return null;
    return {
      post_workout: {
        event_id: pw.event_id,
        ts_start_iso: pw.workout_ref.ts_start_iso,
        ts_end_iso: pw.workout_ref.ts_end_iso,
        kind: pw.workout_ref.kind,
      },
    };
  }
  const ae = entry as AnomalyExplainSlotEntry;
  return {
    anomaly_explain: {
      event_id: ae.event_id,
      observation_id: ae.observation_id,
    },
  };
}

// ── Period resolver ─────────────────────────────────────────────────────

function defaultPeriodKey(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Re-exports for daemon consumers.
export type { AnyDiff };
