/**
 * Stage 7 — Atomic write.
 *
 * Strategy:
 *   1. Write all output files into a per-run staging directory OUTSIDE the
 *      Syncthing watch path.
 *      Default `STAGING_ROOT = /tmp/pulse-staging` (override via env).
 *   2. Once all writes succeed, `fs.rename()` each file into the final
 *      Syncthing-watched location. Order:
 *         a. _facts.json
 *         b. _bundle.json
 *         c. daily.json   (LAST — frontend may read it any time after rename)
 *   3. Rename is atomic on POSIX when source and destination live on the same
 *      filesystem; we accept that constraint and fall back to copy+unlink if
 *      EXDEV is raised.
 *
 * The frontend never reads daily.json before facts.json because the runner
 * writes daily.json last. Mid-pipeline crashes leave behind stale staging
 * files but never corrupt the user-visible directory.
 */

import { mkdir, rename, writeFile, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { BundleManifestV2, DailyInsightV2, FactsBundleV2 } from "@/lib/types/generated";
import { config } from "../config.ts";
import {
  pushBundle,
  pushFacts,
  pushInsight,
  pushPeriodAtomic,
  pushState,
} from "../ingest/client.ts";

export const STAGING_ROOT = process.env.PULSE_STAGING_ROOT ?? "/tmp/pulse-staging";

/**
 * Atomic-writes the daily insight payload + supporting files into the
 * insights tree. The order is: facts → bundle → daily. Frontend treats the
 * presence of daily.json as the "ready" signal, so it must land last.
 */
export async function writeDailyAtomic(
  daily: DailyInsightV2,
  factsBundle: FactsBundleV2,
  bundle: BundleManifestV2,
  periodKey: string,
): Promise<void> {
  const runId = bundle.run_id || randomUUID();
  const stagingDir = path.join(STAGING_ROOT, runId);
  const targetDir = path.join(config.insightsRoot, "daily", periodKey);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });

  const stageFacts = path.join(stagingDir, "_facts.json");
  const stageFactsLocked = path.join(stagingDir, "_facts_locked.json");
  const stageBundle = path.join(stagingDir, "_bundle.json");
  const stageDaily = path.join(stagingDir, "daily.json");

  const finalFacts = path.join(targetDir, "_facts.json");
  const finalFactsLocked = path.join(targetDir, "_facts_locked.json");
  const finalBundle = path.join(targetDir, "_bundle.json");
  const finalDaily = path.join(targetDir, "daily.json");

  // Snapshot freeze: `_facts_locked.json` captures the exact facts the daily
  // LLM was rendered against. The live watcher keeps overwriting `_facts.json`
  // through the day, so without a frozen sibling the verifier (and any
  // human reading the bundle later) loses the ability to check the daily
  // output against the inputs that actually produced it.
  const factsJson = JSON.stringify(factsBundle, null, 2);

  // 1. Write all to staging.
  await writeFile(stageFacts, factsJson, "utf8");
  await writeFile(stageFactsLocked, factsJson, "utf8");
  await writeFile(stageBundle, JSON.stringify(bundle, null, 2), "utf8");
  await writeFile(stageDaily, JSON.stringify(daily, null, 2), "utf8");

  // 2. Atomic rename in canonical order. `_facts_locked.json` lands first so
  // a reader picking up `daily.json` always sees the matching frozen facts.
  await atomicMove(stageFactsLocked, finalFactsLocked);
  await atomicMove(stageFacts, finalFacts);
  await atomicMove(stageBundle, finalBundle);
  await atomicMove(stageDaily, finalDaily); // LAST — frontend may now read.

  // 3. Push to Pi ingest as one atomic transaction. Eliminates the
  // three-POST window where the dashboard could see locked facts paired
  // with a stale or missing insight row.
  const insightStatus: "complete" | "partial" | "live" =
    bundle.pipeline_status === "ok"
      ? "complete"
      : bundle.pipeline_status === "partial"
        ? "partial"
        : "live";
  await pushPeriodAtomic({
    periodKey,
    facts: { status: "locked", payload: factsBundle, source: "runner_v2" },
    insights: [
      { cluster: "v2", status: insightStatus, payload: daily, source: "runner_v2" },
    ],
    bundle: {
      pipeline: "v2",
      status: bundle.pipeline_status === "ok" ? "complete" : "partial",
      stages: bundle.runs ?? [],
      verify: bundle.timings ?? null,
    },
  });
}

/**
 * Rename across filesystems may raise EXDEV; fall back to copy+unlink so the
 * whole thing still appears as a single replacement at the destination
 * (since copy writes a temp file first). Same-FS path uses fs.rename which
 * is atomic.
 */
async function atomicMove(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw err;
    const tmp = `${dst}.tmp.${process.pid}.${Date.now()}`;
    await copyFile(src, tmp);
    await rename(tmp, dst);
    await unlink(src);
  }
}

/**
 * Live-mode write: facts + bundle only. Used by the watch container during a
 * still-in-progress day. Skips daily.json so the dashboard never sees a
 * mid-day LLM verdict — those are reserved for the post-completion finalize.
 */
export async function writeLiveAtomic(
  factsBundle: FactsBundleV2,
  bundle: BundleManifestV2,
  periodKey: string,
): Promise<void> {
  const runId = bundle.run_id || randomUUID();
  const stagingDir = path.join(STAGING_ROOT, runId);
  const targetDir = path.join(config.insightsRoot, "daily", periodKey);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });

  const stageFacts = path.join(stagingDir, "_facts.json");
  const stageBundle = path.join(stagingDir, "_bundle.json");

  const finalFacts = path.join(targetDir, "_facts.json");
  const finalBundle = path.join(targetDir, "_bundle.json");

  await writeFile(stageFacts, JSON.stringify(factsBundle, null, 2), "utf8");
  await writeFile(stageBundle, JSON.stringify(bundle, null, 2), "utf8");

  await atomicMove(stageFacts, finalFacts);
  await atomicMove(stageBundle, finalBundle);

  // Live push: facts + bundle in a single transaction so the dashboard
  // never sees facts paired with a stale bundle status. Fire-and-forget;
  // failed POSTs queue in the local outbox and replay automatically.
  void pushPeriodAtomic({
    periodKey,
    facts: { status: "live", payload: factsBundle, source: "runner_v2" },
    bundle: { pipeline: "v2", status: "live", stages: bundle.runs ?? [] },
  }).catch((err) => console.warn("[stage7] pushPeriodAtomic(live):", err));
}

/**
 * Atomically write alarm_state.json into `stateRoot`.
 * Same staging+rename strategy as writeDailyAtomic.
 * Called by the orchestrator after persistAlarms() when new alarms were appended.
 */
export async function writeAlarmStateAtomic(
  alarmState: import("@/lib/types/generated").AlarmStateV1,
  stateRoot: string,
): Promise<void> {
  const finalPath = path.join(stateRoot, "alarm_state.json");
  const stagingDir = path.join(STAGING_ROOT, `alarm-state-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });
  const stageFile = path.join(stagingDir, "alarm_state.json");
  await writeFile(stageFile, JSON.stringify(alarmState, null, 2), "utf8");
  await atomicMove(stageFile, finalPath);

  // Mirror into PULSE_STATE_KV. Fire-and-forget so a Pi network stall does
  // not block the next alarm cycle. Outbox replays on failure.
  void pushState({ key: "alarm_state", value: alarmState }).catch((err) =>
    console.warn("[stage7] pushState(alarm_state):", err),
  );
}
