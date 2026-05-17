/**
 * Event-driven runner. Long-running service that replaces the polled
 * `daily-finalize-loop` and merges the role of `daily-watch`.
 *
 * Layout:
 *   - chokidar on Gadgetbridge.db → debounced tick:
 *       1. run live pipeline (stage 0/1 + alarms) for today's wake-date
 *       2. emit sleep_complete / workout_complete from new DB rows
 *   - hourly tick → emit day_end backlog (covers fallback if no other event
 *     fired and the wake-date rolled over while idle)
 *   - boot → catch-up backlog over `--lookback` days
 *
 * Subscribers (in `subscribers.ts`) consume the events. Per-period serial
 * lock in the bus keeps the GPU single-tenant.
 */

import chokidar from "chokidar";

import { config } from "../config.ts";
import { db as openDb } from "../db.ts";
import { log, withContext } from "../logger.ts";
import { latestSnapshotDate } from "../period.ts";
import { runDaily } from "../v2-orchestrator.ts";
import { extractOnce, watchZip } from "../zip-extract.ts";
import { bus } from "./bus.ts";
import { emitDayEndBacklog, emitDbEvents } from "./sources.ts";
import { registerSubscribers } from "./subscribers.ts";

const HOURLY_MS = 60 * 60 * 1000;
const DEBOUNCE_MS = 2000;
/** Nutrition reconcile cadence. Cheap indexed query against pulse.db on
 *  the Pi; small interval is fine and gives sub-minute upload latency
 *  without needing a webhook. */
const NUTRITION_RECONCILE_MS = 60 * 1000;

export interface DispatcherOpts {
  lookbackDays: number;
}

export async function eventsLoop(opts: DispatcherOpts): Promise<void> {
  log.info("boot", `events-loop lookback=${opts.lookbackDays}d db=${config.dbPath}`);
  registerSubscribers();

  // Nutrition queue lives in pulse.db on the Pi. We poll it on a short tick
  // (and at boot) — chokidar on a docker-bind-mounted Syncthing folder is
  // unreliable for fs events anyway, and pulse.db is the single source of
  // truth for "what needs classifying."
  const { reconcileMeals } = await import("../nutrition/reconciler.ts");
  const { startOutboxFlusher } = await import("../ingest/outbox.ts");
  startOutboxFlusher();

  reconcileMeals().catch((err) =>
    log.error("reconciler", `boot: ${(err as Error).message}`),
  );
  setInterval(() => {
    reconcileMeals().catch((err) =>
      log.error("reconciler", `tick: ${(err as Error).message}`),
    );
  }, NUTRITION_RECONCILE_MS);

  // Boot: extract any pending zip, then sweep day_end backlog.
  await extractOnce().catch((err) =>
    log.error("boot", `zip extract initial: ${(err as Error).message}`),
  );
  watchZip();

  // Initial sweep runs in the background so it doesn't delay the chokidar
  // watcher coming up. Per-period bus locks keep pipeline runs serial regardless.
  sweep(opts.lookbackDays).catch((err) =>
    log.error("sweep", `initial: ${(err as Error).message}`),
  );

  // Hourly fallback tick — covers idle days where no DB event fires.
  setInterval(() => {
    sweep(opts.lookbackDays).catch((err) =>
      log.error("sweep", `hourly: ${(err as Error).message}`),
    );
  }, HOURLY_MS);

  // DB watcher. Debounce → live pipeline + emit DB events.
  let pending: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      onDbChanged().catch((err) =>
        log.error("db-tick", (err as Error).message),
      );
    }, DEBOUNCE_MS);
  };
  // Polling: Docker bind-mounts on macOS don't propagate inotify. DB updates
  // arrive after the in-container extract or rare external writes, so 10 min
  // is fine — the hourly sweep covers everything else.
  chokidar
    .watch(config.dbPath, {
      awaitWriteFinish: { stabilityThreshold: 1500 },
      usePolling: true,
      interval: 600_000,
      binaryInterval: 600_000,
    })
    .on("change", trigger)
    .on("add", trigger);
  trigger();

  // Keep the process alive — intervals are ref'd, but make intent explicit.
  await new Promise(() => {});
}

async function onDbChanged(): Promise<void> {
  const periodKey = latestSnapshotDate();
  // 1. Refresh live state for today (facts + rules + alarms, no LLM).
  await withContext({ kind: "db_tick", periodKey }, async () => {
    try {
      await runDaily(periodKey, { liveOnly: true });
    } catch (err) {
      log.error("live", (err as Error).message);
    }
    // 2. Emit any new sleep / workout events.
    try {
      await emitDbEvents(openDb());
    } catch (err) {
      log.error("emit", (err as Error).message);
    }
  });
}

async function sweep(lookbackDays: number): Promise<void> {
  const today = latestSnapshotDate();
  await emitDayEndBacklog(lookbackDays, today);
}

/** Emit a manual event for `periodKey` — used by CLI / API for ad-hoc reruns. */
export async function emitManual(periodKey: string): Promise<void> {
  await bus.emit("manual", periodKey, { source: "cli" });
}
