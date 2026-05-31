/**
 * v4 backfill — single-shot pipeline runs for past day(s).
 *
 * The live v4 daemon only targets the current period_key on each tick, so
 * a freshly deployed (or freshly bumped) Pi has no view_state for the
 * preceding window. `runV4Backfill` walks a date range ending YESTERDAY
 * and, for each date, instantiates a SchedulerDaemon pinned to that
 * period via `resolvePeriodKey`, then ticks until no slots remain due
 * (since the daemon caps dispatch at MAX_SLOTS_PER_TICK=4 and the daily
 * registry has 5 auto-scheduled slots).
 */

import { db as openDb } from "../../db.ts";
import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { DAILY_SLOTS } from "../slots/_registry.ts";
import { Outbox } from "../transport/outbox.ts";
import { ViewStateReader } from "../view-state/reader.ts";
import { SchedulerDaemon } from "./daemon.ts";
import type { SlotEntry } from "../types.ts";

export interface BackfillOptions {
  days: number;
  date?: string;
  dryRun?: boolean;
  piBaseUrl?: string;
}

export interface BackfillResult {
  ok: number;
  failed: number;
}

const MAX_TICK_ITERATIONS = 6;
const TZ = "Europe/Berlin";

export async function runV4Backfill(opts: BackfillOptions): Promise<BackfillResult> {
  const targets = opts.date ? [opts.date] : pastDateRange(opts.days);
  const piBaseUrl = opts.piBaseUrl ?? process.env.PULSE_PI_BASE_URL ?? undefined;
  const autoSlotIds = DAILY_SLOTS.filter((s) => s.auto_schedule).map((s) => s.slot_id);

  log.info(
    "v4-backfill",
    `targets=${targets.length} (${targets[0]} → ${targets[targets.length - 1]}) ` +
      `dry=${opts.dryRun ? "1" : "0"} pi=${piBaseUrl ?? "(local)"} auto_slots=${autoSlotIds.join(",")}`,
  );

  if (opts.dryRun) {
    for (const target of targets) {
      log.info("v4-backfill", `would dispatch [${target}] slots=${autoSlotIds.join(",")}`);
    }
    return { ok: targets.length, failed: 0 };
  }

  if (!piBaseUrl) {
    log.warn(
      "v4-backfill",
      "PULSE_PI_BASE_URL unset — diffs land in local view tree only (Pi will not converge)",
    );
  }

  const db = openDb();
  const outbox = new Outbox({ pi_base_url: piBaseUrl });
  const reader = new ViewStateReader({
    view_root: config.insightsRoot,
    pi_base_url: piBaseUrl,
  });

  let ok = 0;
  let failed = 0;

  for (const target of targets) {
    const t0 = Date.now();
    log.info("v4-backfill", `--- ${target} ---`);
    const daemon = new SchedulerDaemon({
      db,
      insights_root: config.insightsRoot,
      view_root: config.insightsRoot,
      outbox,
      pi_base_url: piBaseUrl,
      tz: TZ,
      resolvePeriodKey: () => target,
    });

    let dispatchedTotal = 0;
    let succeededTotal = 0;
    let erroredTotal = 0;
    let iterations = 0;
    let lastTickHadWork = true;
    try {
      while (lastTickHadWork && iterations < MAX_TICK_ITERATIONS) {
        const report = await daemon.tick();
        iterations++;
        dispatchedTotal += report.slots_dispatched.length;
        succeededTotal += report.slots_succeeded.length;
        erroredTotal += report.slots_errored.length;
        log.info(
          "v4-backfill",
          `[${target}] tick#${iterations} dispatched=${report.slots_dispatched.length} ` +
            `ok=${report.slots_succeeded.length} err=${report.slots_errored.length} ` +
            `outbox.queued=${report.outbox_failures} ms=${report.ms_total}`,
        );
        for (const note of report.notes) log.info("v4-backfill", `  [${target}] ${note}`);
        lastTickHadWork = report.slots_dispatched.length > 0;
      }

      const view = await reader.read("daily", target);
      const summary: string[] = [];
      for (const slotId of autoSlotIds) {
        const entry = (view?.slots as unknown as Record<string, SlotEntry | undefined>)?.[slotId];
        summary.push(`${slotId}=${entry?.status ?? "missing"}`);
      }
      log.info(
        "v4-backfill",
        `[${target}] done iter=${iterations} dispatched=${dispatchedTotal} ` +
          `ok=${succeededTotal} err=${erroredTotal} ms=${Date.now() - t0} | ${summary.join(" ")}`,
      );

      if (erroredTotal > 0 || succeededTotal === 0) failed++;
      else ok++;
    } catch (err) {
      failed++;
      log.error(
        "v4-backfill",
        `[${target}] threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info("v4-backfill", `summary ok=${ok} failed=${failed} of ${targets.length}`);
  return { ok, failed };
}

/** Past N day-keys ending YESTERDAY (today excluded), oldest first. */
function pastDateRange(n: number): string[] {
  const today = todayBerlinKey();
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function todayBerlinKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
