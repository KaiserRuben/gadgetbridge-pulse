/**
 * Coach runner CLI.
 *
 * Usage:
 *   tsx src/index.ts snapshot                    # all domains, latest day
 *   tsx src/index.ts snapshot --date=YYYY-MM-DD
 *   tsx src/index.ts snapshot --only=sleep,cardio
 *   tsx src/index.ts snapshot --dry-run
 *   tsx src/index.ts watch
 *   tsx src/index.ts daily          [--date=YYYY-MM-DD] [--dry-run] [--force]
 *   tsx src/index.ts daily-watch                  # live mode: facts+rules+alarms only
 *   tsx src/index.ts daily-finalize [--date=YYYY-MM-DD]  # one-shot, full LLM pipeline for a completed day
 *   tsx src/index.ts daily-finalize-loop          # long-running: scans for un-finalised past days every 5 min
 */

import chokidar from "chokidar";
import { assertDbExists } from "./config.ts";
import { log } from "./logger.ts";
import { buildSnapshotFacts } from "./facts/snapshot.ts";
import {
  isDailyFinalised,
  isDayComplete,
  latestSnapshotDate,
} from "./period.ts";
import { runPrompt } from "./orchestrator.ts";
import { writeAtomic, insightPath } from "./output.ts";
import { config } from "./config.ts";
import { runDaily } from "./v2-orchestrator.ts";
import { extractOnce, watchZip } from "./zip-extract.ts";
import { eventsLoop, emitManual } from "./events/dispatcher.ts";

// Domain prompt modules — each registers itself in SNAPSHOT_REGISTRY on import.
import "./prompts/snapshot/sleep.ts";
import "./prompts/snapshot/cardio.ts";
import "./prompts/snapshot/activity.ts";
import "./prompts/snapshot/body.ts";
import "./prompts/snapshot/stress.ts";
import "./prompts/snapshot/anomalies.ts";
import "./prompts/snapshot/coach.ts";

import { SNAPSHOT_REGISTRY } from "./prompts/snapshot/registry.ts";

async function runSnapshot(opts: { date?: string; only?: string[]; dryRun?: boolean }) {
  const periodKey = opts.date ?? latestSnapshotDate();
  console.log(`\n=== snapshot ${periodKey} ===`);

  const facts = buildSnapshotFacts(periodKey);
  const factsPath = insightPath("snapshot", periodKey, "_facts");
  await writeAtomic(factsPath, JSON.stringify(facts, null, 2));
  console.log(`facts written → ${factsPath}\n`);

  const allDomains = Object.keys(SNAPSHOT_REGISTRY);
  const selected = opts.only ?? allDomains;
  const prompts = selected
    .map((d) => SNAPSHOT_REGISTRY[d])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  if (prompts.length === 0) {
    console.error(`No prompts to run. Available: ${allDomains.join(", ")}`);
    process.exit(1);
  }

  if (opts.dryRun) {
    for (const p of prompts) console.log(`would run: ${p.timeframe}/${p.domain}`);
    return;
  }

  for (const prompt of prompts) {
    const result = await runPrompt(prompt, facts);
    if (!result.ok) console.error(`  ${prompt.domain} failed: ${result.reason}`);
  }
}

async function runDailyV2(opts: {
  date?: string;
  dryRun?: boolean;
  force?: boolean;
  liveOnly?: boolean;
}) {
  const periodKey = opts.date ?? latestSnapshotDate();
  console.log(`\n=== daily-v2 ${periodKey}${opts.dryRun ? " (dry-run)" : ""} ===`);
  const result = await runDaily(periodKey, {
    dryRun: opts.dryRun,
    force: opts.force,
    liveOnly: opts.liveOnly,
  });
  if (!result.ok) {
    console.error(`daily failed: ${result.error}`);
    process.exit(1);
  }
  console.log(
    `pipeline=${result.bundle.pipeline_status} verify=${result.verify.ok ? "ok" : "fail"} timings=${JSON.stringify(result.bundle.timings)}`,
  );
}

async function watch() {
  console.log(`watching ${config.dbPath}`);
  let pending: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      runSnapshot({}).catch((err) => console.error("snapshot failed:", err));
      pending = null;
    }, 2000);
  };
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
}

async function runBackfill(opts: { days: number; dryRun?: boolean }) {
  const today = latestSnapshotDate();
  const dates: string[] = [];
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = opts.days - 1; i >= 0; i--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    dates.push(key);
  }
  console.log(`\n=== backfill ${opts.days} days: ${dates[0]} → ${dates[dates.length - 1]} ===`);
  let okCount = 0;
  let failCount = 0;
  for (const periodKey of dates) {
    console.log(`\n--- ${periodKey} ---`);
    try {
      const result = await runDaily(periodKey, {
        dryRun: opts.dryRun,
        force: true,
      });
      if (result.ok) {
        okCount++;
        console.log(`pipeline=${result.bundle.pipeline_status} verify=${result.verify.ok ? "ok" : "fail"}`);
      } else {
        failCount++;
        console.error(`failed: ${result.error}`);
      }
    } catch (err) {
      failCount++;
      console.error(`exception:`, err);
    }
  }
  console.log(`\n=== backfill done: ${okCount} ok, ${failCount} failed ===`);
}

async function runBackfillAlarms(opts: { days: number; dryRun?: boolean }) {
  const today = latestSnapshotDate();
  const dates: string[] = [];
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = opts.days - 1; i >= 0; i--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    dates.push(key);
  }
  console.log(
    `\n=== backfill-alarms ${opts.days} days: ${dates[0]} → ${dates[dates.length - 1]}${opts.dryRun ? " (dry-run)" : ""} ===`,
  );

  const { buildDailyFacts } = await import("./facts/daily.ts");
  const { runStage1 } = await import("./stages/stage1-rules.ts");
  const { persistAlarms } = await import("./output/alarms.ts");
  const { ensureStateFiles } = await import("./state/bootstrap.ts");
  const { db: openDb } = await import("./db.ts");
  const { config } = await import("./config.ts");

  const state = await ensureStateFiles();
  const alarmState = state.alarmState as import("./rules/types.ts").AlarmStateV1;
  const localNow = new Date().toISOString().replace("Z", "");

  let totalAppended = 0;
  let processedDays = 0;
  let failedDays = 0;

  for (const periodKey of dates) {
    try {
      const facts = await buildDailyFacts(periodKey);
      const rules = runStage1(facts, alarmState, localNow, state.pause, openDb());
      const tieredCandidates = rules.observations.filter(
        (o) => o.tier !== null && (!o.suppressed_by || o.suppressed_by.length === 0),
      );
      if (opts.dryRun) {
        console.log(
          `  ${periodKey}: ${tieredCandidates.length} candidate(s) — ${
            tieredCandidates.map((o) => `${o.id}(${o.tier})`).join(", ") || "none"
          }`,
        );
        processedDays++;
        continue;
      }
      const { appended } = await persistAlarms(
        rules.observations,
        periodKey,
        alarmState,
        config.alarmsRoot,
      );
      totalAppended += appended.length;
      processedDays++;
    } catch (err) {
      console.error(`  ${periodKey}: error — ${err instanceof Error ? err.message : String(err)}`);
      failedDays++;
    }
  }

  console.log(
    `\n=== backfill-alarms done: ${processedDays} days processed, ${totalAppended} alarms appended, ${failedDays} failed ===`,
  );
}

async function dailyWatch() {
  console.log(`daily-watch ${config.dbPath} (live-only mode — facts + rules + alarms)`);
  // Extract any pre-existing zip on boot, then watch for new ones. The DB
  // write triggers the chokidar watcher below → live-only pipeline.
  // The full LLM pipeline is reserved for the post-completion finalize cron;
  // this watch only refreshes facts and persists alarms mid-day.
  await extractOnce().catch((err) => console.error("[zip-extract] initial:", err));
  watchZip();
  let pending: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      runDailyV2({ liveOnly: true }).catch((err) =>
        console.error("daily-watch failed:", err),
      );
      pending = null;
    }, 2000);
  };
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
}

/**
 * One-shot finalize: run the full LLM pipeline for one completed day.
 * Used both interactively and by the cron-loop. Refuses to run for the
 * current (in-progress) day unless --force is passed.
 */
async function dailyFinalize(opts: { date?: string; force?: boolean }) {
  const periodKey = opts.date ?? latestSnapshotDate();
  if (!opts.force && !isDayComplete(periodKey)) {
    console.error(
      `daily-finalize: ${periodKey} is the current day — refusing without --force`,
    );
    process.exit(1);
  }
  if (isDailyFinalised(periodKey) && !opts.force) {
    console.log(`daily-finalize: ${periodKey} already finalised — skipping`);
    return;
  }
  console.log(`\n=== daily-finalize ${periodKey} ===`);
  const result = await runDaily(periodKey, { force: opts.force });
  if (!result.ok) {
    console.error(`finalize failed: ${result.error}`);
    process.exit(1);
  }
  console.log(
    `pipeline=${result.bundle.pipeline_status} verify=${result.verify.ok ? "ok" : "fail"} timings=${JSON.stringify(result.bundle.timings)}`,
  );
}

/**
 * Long-running finalize loop. Wakes every 5 minutes; if there is at least one
 * past day without a `_complete` sentinel, runs the full pipeline for the
 * oldest such day. Single-shot per tick — leaves remaining backlog for the
 * next tick so we never queue up multiple LLM runs concurrently on one GPU.
 *
 * Backfill horizon: `FINALIZE_LOOKBACK_DAYS` (default 7) — we only sweep up
 * to a week of history so a Pi that just came online doesn't immediately
 * spend a day rebuilding 30 days of insight.
 */
async function dailyFinalizeLoop(opts: { lookback: number; intervalMs: number }) {
  console.log(
    `daily-finalize-loop lookback=${opts.lookback}d interval=${Math.round(opts.intervalMs / 1000)}s`,
  );
  const tick = async () => {
    try {
      const today = latestSnapshotDate();
      const dates = pastDateRange(today, opts.lookback);
      const pending = dates.filter(
        (d) => isDayComplete(d) && !isDailyFinalised(d),
      );
      if (pending.length === 0) {
        console.log(`[loop] all caught up — newest pending: none`);
        return;
      }
      const target = pending[0]; // oldest first
      console.log(`[loop] finalising ${target} (${pending.length - 1} more queued)`);
      const result = await runDaily(target, {});
      if (!result.ok) console.error(`[loop] ${target}: ${result.error}`);
    } catch (err) {
      console.error("[loop] tick failed:", err);
    }
  };
  await tick();
  setInterval(tick, opts.intervalMs);
  // Keep alive — the ref'd interval holds the event loop. Caller should bind
  // a SIGTERM handler if the process manager wants graceful shutdown.
  await new Promise(() => {});
}

/** Past N day-keys ending YESTERDAY (today excluded), oldest first. */
function pastDateRange(today: string, n: number): string[] {
  const out: string[] = [];
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = n; i >= 1; i--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

async function main() {
  assertDbExists();
  const args = process.argv.slice(2);
  const cmd = args[0];
  const dateArg = args.find((a) => a.startsWith("--date="))?.slice(7);
  const onlyArg = args.find((a) => a.startsWith("--only="))?.slice(7);
  const only = onlyArg ? onlyArg.split(",").map((s) => s.trim()) : undefined;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  switch (cmd) {
    case "snapshot":
      await runSnapshot({ date: dateArg, only, dryRun });
      break;
    case "watch":
      await watch();
      break;
    case "daily":
      await runDailyV2({ date: dateArg, dryRun, force });
      break;
    case "daily-watch":
      await dailyWatch();
      break;
    case "daily-finalize":
      await dailyFinalize({ date: dateArg, force });
      break;
    case "events-loop": {
      const lookbackArg = args.find((a) => a.startsWith("--lookback="))?.slice(11);
      const lookback = lookbackArg
        ? parseInt(lookbackArg, 10)
        : parseInt(process.env.FINALIZE_LOOKBACK_DAYS ?? "7", 10);
      if (!Number.isFinite(lookback) || lookback < 1 || lookback > 60) {
        console.error(`invalid --lookback=${lookbackArg}; expected 1-60`);
        process.exit(1);
      }
      // Surface deployment-critical config at startup. Silent-no-op writes are
      // the #1 footgun: the Mac runner classifies a meal, POSTs to the Pi,
      // and (if INGEST_BASE_URL is unset) returns `ok: true, queued: false`
      // with nothing actually written. Logging up-front beats a deep debug.
      if (!config.ingestBaseUrl) {
        console.warn(
          "[events-loop] INGEST_BASE_URL is empty — Pi writes will be silent no-ops. " +
            "Set INGEST_BASE_URL (e.g. http://pulse.tailnet:3030) to enable meal/food/insight persistence.",
        );
      } else {
        console.log(`[events-loop] ingest target: ${config.ingestBaseUrl}`);
      }
      await eventsLoop({ lookbackDays: lookback });
      break;
    }
    case "events-emit": {
      const kind = args.find((a) => a.startsWith("--kind="))?.slice(7) ?? "manual";
      const periodKey = dateArg ?? latestSnapshotDate();
      if (kind !== "manual") {
        console.error(`only --kind=manual supported from CLI`);
        process.exit(1);
      }
      await emitManual(periodKey);
      // Give the in-process handler a moment to drain. The bus dispatches
      // asynchronously, so we wait long enough for runDaily to bind its lock.
      await new Promise((r) => setTimeout(r, 250));
      break;
    }
    case "daily-finalize-loop": {
      const lookbackArg = args.find((a) => a.startsWith("--lookback="))?.slice(11);
      const intervalArg = args.find((a) => a.startsWith("--interval="))?.slice(11);
      const lookback = lookbackArg
        ? parseInt(lookbackArg, 10)
        : parseInt(process.env.FINALIZE_LOOKBACK_DAYS ?? "7", 10);
      const intervalSec = intervalArg
        ? parseInt(intervalArg, 10)
        : parseInt(process.env.FINALIZE_INTERVAL_SEC ?? "300", 10);
      if (!Number.isFinite(lookback) || lookback < 1 || lookback > 60) {
        console.error(`invalid --lookback=${lookbackArg}; expected 1-60`);
        process.exit(1);
      }
      if (!Number.isFinite(intervalSec) || intervalSec < 30 || intervalSec > 3600) {
        console.error(`invalid --interval=${intervalArg}; expected 30-3600 seconds`);
        process.exit(1);
      }
      await dailyFinalizeLoop({ lookback, intervalMs: intervalSec * 1000 });
      break;
    }
    case "backfill": {
      const daysArg = args.find((a) => a.startsWith("--days="))?.slice(7);
      const days = daysArg ? parseInt(daysArg, 10) : 30;
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        console.error(`invalid --days=${daysArg}; expected 1-365`);
        process.exit(1);
      }
      await runBackfill({ days, dryRun });
      break;
    }
    case "backfill-alarms": {
      const daysArg = args.find((a) => a.startsWith("--days="))?.slice(7);
      const days = daysArg ? parseInt(daysArg, 10) : 30;
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        console.error(`invalid --days=${daysArg}; expected 1-365`);
        process.exit(1);
      }
      await runBackfillAlarms({ days, dryRun });
      break;
    }
    case "backfill-completion": {
      await import("./scripts/backfill-completion.ts");
      break;
    }
    case "nutrition-cluster": {
      const { runNutritionCluster } = await import("./v3/packagers/nutrition.ts");
      const { startOutboxFlusher, outboxSize } = await import("./ingest/outbox.ts");
      startOutboxFlusher();
      const periodKey = dateArg ?? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const r = await runNutritionCluster({ periodKey, day_complete: force });
      console.log(JSON.stringify(r, null, 2));
      // Drain outbox so a one-shot CLI invocation persists everything before
      // exit. Hard-cap at 30 s — anything queued past that hits the
      // long-running flusher in the watcher daemon.
      const deadline = Date.now() + 30_000;
      while (outboxSize() > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      if (outboxSize() > 0) {
        console.warn(`[nutrition-cluster] outbox still has ${outboxSize()} row(s) — start the daemon to flush`);
      }
      if (!r.ok) process.exit(1);
      break;
    }
    default:
      console.error(
        "usage:\n" +
          "  snapshot [--date=YYYY-MM-DD] [--only=sleep,cardio] [--dry-run]\n" +
          "  watch\n" +
          "  daily [--date=YYYY-MM-DD] [--dry-run] [--force]\n" +
          "  daily-watch                                 # live mode (facts + rules + alarms)\n" +
          "  daily-finalize [--date=YYYY-MM-DD] [--force]\n" +
          "  daily-finalize-loop [--lookback=7] [--interval=300]\n" +
          "  events-loop [--lookback=7]                  # event-driven (replaces daily-watch + finalize-loop)\n" +
          "  events-emit --kind=manual [--date=YYYY-MM-DD]\n" +
          "  backfill [--days=30] [--dry-run]\n" +
          "  backfill-alarms [--days=30] [--dry-run]\n" +
          "  nutrition-cluster [--date=YYYY-MM-DD] [--force]  # one-shot Stage C aggregator",
      );
      process.exit(1);
  }
}

// Process-level diagnostics: containers restart silently when the runner
// process exits. Capture uncaught errors + termination signals so the docker
// log shows WHY the last run ended rather than just "events-loop starting" 5x.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    log.warn("proc", `received ${sig}, shutting down`);
    process.exit(0);
  });
}
process.on("uncaughtException", (err) => {
  log.error("proc", `uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  log.error("proc", `unhandledRejection: ${msg}`);
});

main().catch((err) => {
  log.error("proc", `main crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
