/**
 * v4 scheduler daemon.
 *
 * Single-tick orchestration:
 *   1. Build tier1 for the current period (deterministic, no LLM).
 *   2. POST Tier1Diff to Pi (CAS-checked).
 *   3. Read latest view (after our tier1 write) for current expected_version.
 *   4. Decay slot statuses (fresh → aging → stale; scheduled → missed).
 *   5. Pick due slots in topological order; for each, dispatch → SlotDiff → outbox.
 *   6. Drain outbox queue for any earlier failures.
 *
 * Tick cadence: every 60s by default. Caller (CLI / docker) wires the
 * interval timer + signal handlers.
 *
 * Event-bump path (chokidar / manual):
 *   `applyBumpEvent(event)` reads view, applies bump in memory, posts a
 *   SlotDiff per touched slot to re-anchor scheduled_for. Bypasses the
 *   regular tick path.
 *
 * Phase 2 surface: returns a TickReport so callers (CLI, tests) can log
 * what happened.
 */

import type Database from "better-sqlite3";

import { ViewStateReader } from "../view-state/reader.ts";
import { Outbox } from "../transport/outbox.ts";
import { buildTier1 as defaultBuildTier1 } from "../tier1/refresher.ts";
import type { Tier1 } from "../types.ts";
import { dispatchSlot } from "../worker/dispatch.ts";
import { applyBump, decayStatuses, pickDueSlots } from "./calendar.ts";
import { getSlotEntry } from "../slots/_registry.ts";
import type {
  AnyDiff,
} from "../transport/outbox.ts";
import type { OllamaResult } from "../../ollama.ts";
import type {
  BumpEvent,
} from "../slots/_registry.ts";
import type {
  MetaDiff,
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

    for (const item of toRun) {
      report.slots_dispatched.push(item.slot_id);
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

    report.ms_total = Date.now() - t0;
    return report;
  }

  /**
   * Bump scheduled_for on slots matching `event` and submit re-anchoring
   * SlotDiffs. Doesn't dispatch — that's the next tick's job.
   */
  async applyBumpEvent(event: BumpEvent, scope: Scope, periodKey: string): Promise<string[]> {
    const view = await this.reader.read(scope, periodKey);
    if (!view) return [];
    const now = this.now();
    const { next, rescheduled } = applyBump(view, event, now);
    if (rescheduled.length === 0) return [];

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
    return touched;
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
