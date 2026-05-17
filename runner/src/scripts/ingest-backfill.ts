/**
 * One-shot backfill: read every existing insight/state file on disk and POST
 * it into the Pi dashboard's /api/ingest/* endpoints. Idempotent — re-runs
 * are safe (the Pi dedupes via PULSE_INGEST_LOG).
 *
 * Usage:
 *   PULSE_INGEST_BASE_URL=http://pi.local:3030 \
 *   PULSE_INGEST_TOKEN=... \
 *   npx tsx runner/src/scripts/ingest-backfill.ts [--limit=N]
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.ts";
import {
  pushAlarm,
  pushBundle,
  pushFacts,
  pushInsight,
  pushState,
} from "../ingest/client.ts";
import { isV2Complete } from "../state/completion-log.ts";

interface Args {
  limit: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  return {
    limit: limitArg ? Number(limitArg.split("=")[1]) || 9999 : 9999,
  };
}

async function safeReadJson<T = unknown>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function backfillDaily(limit: number): Promise<void> {
  const dailyRoot = path.join(config.insightsRoot, "daily");
  if (!(await fileExists(dailyRoot))) return;
  const entries = await readdir(dailyRoot);
  const dates = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort().reverse().slice(0, limit);

  for (const date of dates) {
    const dir = path.join(dailyRoot, date);
    const factsPath = path.join(dir, "_facts.json");
    const factsLockedPath = path.join(dir, "_facts_locked.json");
    const bundlePath = path.join(dir, "_bundle.json");
    const dailyPath = path.join(dir, "daily.json");

    const facts = (await safeReadJson(factsLockedPath)) ?? (await safeReadJson(factsPath));
    const bundle = await safeReadJson<Record<string, unknown>>(bundlePath);
    const daily = await safeReadJson(dailyPath);
    const complete = isV2Complete(date);

    if (facts) {
      await pushFacts({
        periodKey: date,
        status: complete ? "locked" : "live",
        payload: facts,
        source: "backfill",
      });
    }
    if (daily) {
      await pushInsight({
        periodKey: date,
        cluster: "v2",
        status: complete ? "complete" : "partial",
        payload: daily,
        source: "backfill",
      });
    }
    if (bundle) {
      const pipelineStatus = (bundle.pipeline_status as string) ?? "partial";
      await pushBundle({
        periodKey: date,
        pipeline: "v2",
        status:
          pipelineStatus === "ok" || complete
            ? "complete"
            : pipelineStatus === "partial"
              ? "partial"
              : "live",
        stages: (bundle.stages as unknown) ?? [],
        verify: bundle.verification ?? null,
      });
    }

    // v3 artifacts
    for (const cluster of ["sleep", "recovery", "activity", "synthesis"]) {
      const fileName =
        cluster === "synthesis" ? "daily_v3.json" : `${cluster}_insight.json`;
      const insightPath = path.join(dir, fileName);
      const insight = await safeReadJson<Record<string, unknown>>(insightPath);
      if (insight) {
        const finalised = insight.incomplete === false;
        await pushInsight({
          periodKey: date,
          cluster,
          status: finalised ? "complete" : "partial",
          payload: insight,
          source: "backfill_v3",
        });
      }
    }
    const dayScore = await safeReadJson(path.join(dir, "day_score.json"));
    if (dayScore) {
      await pushInsight({
        periodKey: date,
        cluster: "day_score",
        status: "complete",
        payload: dayScore,
        source: "backfill_v3",
      });
    }

    console.log(`[backfill] ${date} pushed`);
  }
}

async function backfillState(): Promise<void> {
  for (const key of ["pause", "labs", "alarm_state"]) {
    const p = path.join(config.stateRoot, `${key}.json`);
    const val = await safeReadJson(p);
    if (val !== null) {
      await pushState({ key, value: val });
      console.log(`[backfill] state ${key} pushed`);
    }
  }
}

async function backfillAlarms(limit: number): Promise<void> {
  const alarmsRoot = config.alarmsRoot;
  if (!(await fileExists(alarmsRoot))) return;
  const months = (await readdir(alarmsRoot)).filter((e) => /^\d{4}-\d{2}$/.test(e)).sort();
  let pushed = 0;
  for (const month of months) {
    if (pushed >= limit) break;
    const monthFile = path.join(alarmsRoot, month, "alarms.json");
    const events = await safeReadJson<Array<Record<string, unknown>>>(monthFile);
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (pushed >= limit) break;
      const id = (ev.id as string) ?? `${month}|${(ev.ts as string) ?? ""}|${(ev.kind as string) ?? ""}`;
      await pushAlarm({
        id,
        periodKey: (ev.period_key as string) ?? (ev.date as string) ?? month,
        tsIso: (ev.ts as string) ?? (ev.iso as string) ?? new Date(0).toISOString(),
        kind: (ev.kind as string) ?? "unknown",
        severity: (ev.severity as string) ?? "info",
        payload: ev,
      });
      pushed++;
    }
  }
  console.log(`[backfill] ${pushed} alarms pushed`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!config.ingestBaseUrl) {
    console.error("PULSE_INGEST_BASE_URL not set — nothing to push to.");
    process.exit(1);
  }
  console.log(`[backfill] target ${config.ingestBaseUrl}, limit ${args.limit}`);
  await backfillDaily(args.limit);
  await backfillState();
  await backfillAlarms(args.limit * 10);
  console.log("[backfill] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
