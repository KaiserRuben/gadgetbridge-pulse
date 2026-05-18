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
/** JobCell stale-lease sweep cadence. Reclaims rows whose worker crashed
 *  mid-claim. TTL is 2× the 5-min worker lease so live claims are never
 *  touched. */
const JOBCELL_SWEEP_MS = 3 * 60 * 1000;
const JOBCELL_LEASE_TTL_MS = 10 * 60 * 1000;
/** Queue-marker drain cadence. Markers come from the Pi dashboard via the
 *  Syncthing-replicated `$INSIGHTS_ROOT/queue/` dir. ~5s gives a CTA-to-
 *  worker latency of (Syncthing ~1–5s) + (drain ~5s) ≈ 10s p99, well below
 *  the user's patience threshold for a "berechne jetzt" click. */
const QUEUE_MARKER_DRAIN_MS = 5 * 1000;

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
  const { sweepStaleLeases, enqueue: cellEnqueue } = await import("../jobs/cell.ts");
  const { scanMarkers, consumeMarker } = await import("../jobs/queue-marker.ts");
  startOutboxFlusher();

  reconcileMeals().catch((err) =>
    log.error("reconciler", `boot: ${(err as Error).message}`),
  );
  setInterval(() => {
    reconcileMeals().catch((err) =>
      log.error("reconciler", `tick: ${(err as Error).message}`),
    );
  }, NUTRITION_RECONCILE_MS);

  // JobCell stale-lease sweep — reclaims rows from crashed workers and caps
  // pending rows that exceeded MAX_RETRIES. Pure SQLite UPDATE, runs on the
  // runner's pulse.db handle (same path as cell.claim/release).
  setInterval(() => {
    try {
      const swept = sweepStaleLeases(JOBCELL_LEASE_TTL_MS);
      if (swept > 0) log.warn("jobs", `swept ${swept} stale lease(s)`);
    } catch (err) {
      log.error("jobs", `sweep tick: ${(err as Error).message}`);
    }
  }, JOBCELL_SWEEP_MS);

  // Syncthing-backed CTA queue drain — picks up user-clicked reprocess
  // requests that the Pi enqueue route dropped as marker files in
  // `$INSIGHTS_ROOT/queue/`. Each marker becomes a local cell.enqueue()
  // (which pushes onto the runner's worker heap) and is then deleted.
  setInterval(async () => {
    try {
      const markers = await scanMarkers();
      for (const m of markers) {
        try {
          await cellEnqueue({
            cluster: m.cluster,
            key: m.key,
            scope: m.scope,
            priority: m.priority,
            reason: m.reason,
          });
          await consumeMarker(m.filename);
          log.info("jobs", `drained marker ${m.cluster}/${m.key} (${m.reason})`);
        } catch (err) {
          log.error("jobs", `marker ${m.filename}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      log.error("jobs", `marker scan: ${(err as Error).message}`);
    }
  }, QUEUE_MARKER_DRAIN_MS);

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
