/**
 * v4 daemon entrypoint — long-running process glue.
 *
 * Wires the SchedulerDaemon into:
 *   - a 60s setInterval `tick()` loop
 *   - a chokidar watcher on `Gadgetbridge.db` that derives BumpEvents
 *     (sleep_complete / workout_complete) and pushes them through
 *     `daemon.applyBumpEvent()`
 *   - SIGINT / SIGTERM handlers that stop the loop and close the DB
 *
 * Side-by-side with v3: this owns the v4 cursor file + v4 outbox queue.
 * v3 keeps its own state and the v2/v3 pipeline still runs from
 * `events-loop` until Phase 4.
 */

import chokidar, { type FSWatcher } from "chokidar";

import { config } from "../../config.ts";
import { db as openDb } from "../../db.ts";
import { log } from "../../logger.ts";
import { Outbox } from "../transport/outbox.ts";
import { SchedulerDaemon } from "./daemon.ts";
import {
  loadCursor,
  saveCursor,
  scanForEvents,
} from "./event-watcher.ts";

export interface RunV4DaemonOptions {
  /** Tick interval in ms (default: 60s). */
  tickMs?: number;
  /** Debounce for chokidar (default: 2s). */
  watcherDebounceMs?: number;
  /** Poll interval for chokidar (default: 60s — Docker bind-mount safe). */
  watcherPollMs?: number;
  /**
   * Skip starting the chokidar watcher (useful in tests, or when running
   * inside a container that doesn't have read access to the DB path).
   */
  noWatch?: boolean;
  /** Override Pi base URL (defaults to env / outbox default). */
  piBaseUrl?: string;
}

interface DaemonHandle {
  stop: () => Promise<void>;
}

/**
 * Build + start the v4 daemon. Returns a `stop()` function the caller
 * can wire into signal handlers. If you just want fire-and-forget, call
 * `await blockForever()` after this.
 */
export async function startV4Daemon(opts: RunV4DaemonOptions = {}): Promise<DaemonHandle> {
  const tickMs = opts.tickMs ?? 60_000;
  const debounceMs = opts.watcherDebounceMs ?? 2_000;
  const pollMs = opts.watcherPollMs ?? 60_000;

  const db = openDb();

  const piBaseUrl = opts.piBaseUrl ?? process.env.PULSE_PI_BASE_URL ?? null;

  const outbox = new Outbox({
    pi_base_url: piBaseUrl ?? undefined,
  });

  const daemon = new SchedulerDaemon({
    db,
    insights_root: config.insightsRoot,
    view_root: config.insightsRoot, // view tree sits under insightsRoot/view/
    outbox,
    pi_base_url: piBaseUrl ?? undefined,
    tz: "Europe/Berlin",
  });

  if (piBaseUrl) {
    log.info("v4-daemon", `pi target=${piBaseUrl} (reader+outbox HTTP mode)`);
  } else {
    log.warn(
      "v4-daemon",
      "PULSE_PI_BASE_URL unset — reader falls back to local view tree (Mac CAS will not converge)",
    );
  }

  log.info("v4-daemon", `tick=${tickMs}ms watcher.poll=${pollMs}ms watcher.debounce=${debounceMs}ms`);

  // First tick immediately so the daemon doesn't sit idle for 60s on boot.
  await runTick(daemon).catch((err) =>
    log.error("v4-daemon", `boot tick: ${(err as Error).message}`),
  );

  const interval = setInterval(() => {
    runTick(daemon).catch((err) =>
      log.error("v4-daemon", `tick: ${(err as Error).message}`),
    );
  }, tickMs);

  let watcher: FSWatcher | null = null;
  let pending: NodeJS.Timeout | null = null;
  const triggerEventScan = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      drainEvents(daemon).catch((err) =>
        log.error("v4-daemon", `event scan: ${(err as Error).message}`),
      );
    }, debounceMs);
  };

  if (!opts.noWatch) {
    watcher = chokidar.watch(config.dbPath, {
      awaitWriteFinish: { stabilityThreshold: 1500 },
      usePolling: true,
      interval: pollMs,
      binaryInterval: pollMs,
    });
    watcher.on("change", triggerEventScan).on("add", triggerEventScan);
    // Boot: catch up on any rows added since the last cursor save.
    triggerEventScan();
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    if (pending) clearTimeout(pending);
    if (watcher) await watcher.close();
    log.info("v4-daemon", "stopped");
  };

  return { stop };
}

/**
 * Run a single tick, log the report. Errors propagate so the caller can
 * decide what to do.
 */
async function runTick(daemon: SchedulerDaemon): Promise<void> {
  const report = await daemon.tick();
  const ok = report.slots_succeeded.length;
  const err = report.slots_errored.length;
  const disp = report.slots_dispatched.length;
  log.info(
    "v4-daemon",
    `tick ${report.period_key}: tier1=${report.tier1_submitted} ` +
      `dispatched=${disp} ok=${ok} err=${err} outbox.drained=${report.outbox_drained} ` +
      `outbox.queued=${report.outbox_failures} ms=${report.ms_total}`,
  );
  for (const note of report.notes) log.info("v4-daemon", `  ${note}`);
}

/**
 * Scan the DB for new sleep/workout rows past the persisted cursor and
 * push each derived BumpEvent into the daemon. Saves the cursor only
 * after the event has been forwarded so a crash mid-loop replays the
 * unprocessed event on next boot.
 */
async function drainEvents(daemon: SchedulerDaemon): Promise<void> {
  let cursor = loadCursor();
  const db = openDb(); // refreshes handle if Gadgetbridge.db rotated.
  const { events, next } = scanForEvents(db, cursor);
  if (events.length === 0) return;

  log.info("v4-daemon", `derived ${events.length} event(s) from DB delta`);
  for (const evt of events) {
    try {
      // All v4 events are daily-scoped today. Weekly slots react via day_end.
      const touched = await daemon.applyBumpEvent(evt.event, "daily", evt.period_key);
      log.info(
        "v4-daemon",
        `applied ${evt.event} → ${evt.period_key} (touched ${touched.length})`,
      );
    } catch (err) {
      log.error(
        "v4-daemon",
        `applyBumpEvent ${evt.event} ${evt.period_key} failed: ${(err as Error).message}`,
      );
    }
  }
  cursor = next;
  saveCursor(cursor);
}

/** Block the calling task until SIGINT/SIGTERM. Wires signal handlers. */
export async function blockForever(handle: DaemonHandle): Promise<void> {
  await new Promise<void>((resolve) => {
    const onSig = (sig: string) => {
      log.info("v4-daemon", `received ${sig}, shutting down`);
      void handle.stop().then(() => resolve());
    };
    process.once("SIGINT", () => onSig("SIGINT"));
    process.once("SIGTERM", () => onSig("SIGTERM"));
  });
}
