/**
 * V3 orchestrator — replaces v2 stages 3-6.
 *
 * Pipeline:
 *   Stage A — facts + baselines (existing v2 builder, unchanged)
 *   Stage B — package builders (sleep, recovery, activity) — pure, parallel
 *   Stage L — LLM use-case calls (sleep, recovery, activity) — parallel
 *   Stage S — synthesis call — sequential (depends on L outputs + day_score)
 *   Stage W — write artifacts — atomic
 *
 * Live-mode shortcut: in-progress day skips Stage L + S, writes packages only.
 *
 * Run alongside v2 — gated by RUNNER_V3_ENABLED env (default off).
 */

import { db as openDb } from "./db.ts";
import { config } from "./config.ts";
import { log, withContext } from "./logger.ts";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, unlinkSync, copyFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const STAGING_ROOT = process.env.PULSE_STAGING_ROOT ?? "/tmp/pulse-staging";

import { buildSleepPackage } from "./v3/packagers/sleep.ts";
import { buildRecoveryPackage } from "./v3/packagers/recovery.ts";
import { buildActivityPackage } from "./v3/packagers/activity.ts";
import { buildTrainingPackage } from "./v3/packagers/training.ts";
import { buildMorningPackage } from "./v3/packagers/morning.ts";
import {
  pickBaselines,
  readFactsForDate,
} from "./v3/packagers/shared.ts";
import { computeDayScore } from "./v3/day-score.ts";
import { runUseCase, SLEEP_MANIFEST, RECOVERY_MANIFEST, ACTIVITY_MANIFEST, type UseCaseRunResult } from "./v3/runner.ts";
import { SLEEP_SYSTEM_PROMPT, buildSleepUserPrompt } from "./v3/prompts/sleep.ts";
import { RECOVERY_SYSTEM_PROMPT, buildRecoveryUserPrompt } from "./v3/prompts/recovery.ts";
import { ACTIVITY_SYSTEM_PROMPT, buildActivityUserPrompt } from "./v3/prompts/activity.ts";
import {
  TRAINING_SYSTEM_PROMPT,
  TRAINING_MANIFEST,
  buildTrainingUserPrompt,
} from "./v3/prompts/training.ts";
import {
  MORNING_SYSTEM_PROMPT,
  MORNING_MANIFEST,
  buildMorningUserPrompt,
} from "./v3/prompts/morning.ts";
import { buildSynthesisPackage, runSynthesis } from "./v3/synthesis.ts";
import { pushBundle, pushFacts, pushInsight } from "./ingest/client.ts";
import { isComplete, markComplete, type Artifact, type V3Artifact } from "./state/completion-log.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(__dirname, "v3/schemas");
// The training cluster reuses the canonical schema from runner/src/schemas/training/
// so the Next.js side, the runner, and the v3 orchestrator all validate
// against the same JSON document.
const TRAINING_SCHEMAS_DIR = path.resolve(__dirname, "schemas/training");

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(path.join(SCHEMAS_DIR, name), "utf8")) as object;
}

function loadTrainingSchema(name: string): object {
  return JSON.parse(readFileSync(path.join(TRAINING_SCHEMAS_DIR, name), "utf8")) as object;
}

// ── Per-cluster config table ────────────────────────────────────────────────
//
// Single source of truth for the three LLM clusters. Adding a cluster = add
// a row here + extend V3Cluster.

type PackageBuilder = (
  args: { periodKey: string; db: ReturnType<typeof openDb>; insightsRoot: string; tz: string },
) => unknown | Promise<unknown>;

interface ClusterCfg {
  buildPackage: PackageBuilder;
  systemPrompt: string;
  buildUserPrompt: (pkg: any) => string;
  schema: object;
  manifest: string;
  packageFile: string;
  insightFile: string;
  artifact: V3Artifact;
  /** Optional override for Ollama format mode. Defaults to schema-constrained. */
  formatMode?: "schema" | "json";
}

const CLUSTER_CONFIG: Record<V3Cluster, ClusterCfg> = {
  sleep: {
    buildPackage: buildSleepPackage as PackageBuilder,
    systemPrompt: SLEEP_SYSTEM_PROMPT,
    buildUserPrompt: buildSleepUserPrompt as (pkg: any) => string,
    schema: loadSchema("sleep_insight.schema.json"),
    manifest: SLEEP_MANIFEST,
    packageFile: "sleep_package.json",
    insightFile: "sleep_insight.json",
    artifact: "v3_sleep",
  },
  recovery: {
    buildPackage: buildRecoveryPackage as PackageBuilder,
    systemPrompt: RECOVERY_SYSTEM_PROMPT,
    buildUserPrompt: buildRecoveryUserPrompt as (pkg: any) => string,
    schema: loadSchema("recovery_insight.schema.json"),
    manifest: RECOVERY_MANIFEST,
    packageFile: "recovery_package.json",
    insightFile: "recovery_insight.json",
    artifact: "v3_recovery",
  },
  activity: {
    buildPackage: buildActivityPackage as PackageBuilder,
    systemPrompt: ACTIVITY_SYSTEM_PROMPT,
    buildUserPrompt: buildActivityUserPrompt as (pkg: any) => string,
    schema: loadSchema("activity_insight.schema.json"),
    manifest: ACTIVITY_MANIFEST,
    packageFile: "activity_package.json",
    insightFile: "activity_insight.json",
    artifact: "v3_activity",
  },
  training: {
    buildPackage: buildTrainingPackage as PackageBuilder,
    systemPrompt: TRAINING_SYSTEM_PROMPT,
    // Default kind="prescription" — the event subscriber picks the right
    // kind based on which event fired (workout_complete → post_session,
    // day_end → prescription, weekly is fired separately).
    buildUserPrompt: ((pkg: unknown) => buildTrainingUserPrompt(pkg, "prescription")) as (pkg: any) => string,
    schema: loadTrainingSchema("training-insight.schema.json"),
    manifest: TRAINING_MANIFEST,
    packageFile: "training_package.json",
    insightFile: "training_insight.json",
    artifact: "v3_training",
    formatMode: "json",
  },
  morning: {
    buildPackage: buildMorningPackage as PackageBuilder,
    systemPrompt: MORNING_SYSTEM_PROMPT,
    buildUserPrompt: buildMorningUserPrompt as (pkg: any) => string,
    schema: loadSchema("morning_insight.schema.json"),
    manifest: MORNING_MANIFEST,
    packageFile: "morning_package.json",
    insightFile: "morning_insight.json",
    artifact: "v3_morning",
    // Same constraint as training: nullable nested objects + cross-domain
    // shape exceeds Ollama's grammar engine for qwen3.6. Ajv post-validates.
    formatMode: "json",
  },
};

// ── Per-cluster entries ─────────────────────────────────────────────────────
//
// Each cluster is self-contained: build package → write package → run LLM →
// write insight. Used by event-driven subscribers (sleep_complete fires sleep
// + recovery, workout_complete fires activity). day_end runs the full
// `runV3` which additionally produces synthesis + sentinel.

export type V3Cluster = "sleep" | "recovery" | "activity" | "training" | "morning";

export interface ClusterRunResult {
  ok: boolean;
  cluster: V3Cluster;
  periodKey: string;
  artifacts: string[];
  totalMs: number;
  errors: string[];
  /** True when the cluster was already finalised and the LLM call was skipped. */
  skipped?: boolean;
}

/** Read an existing insight file, returning null if missing/unparseable. */
function readExistingInsight<T = unknown>(outDir: string, file: string): T | null {
  const p = path.join(outDir, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Write the finalised payload — flips `incomplete` to false and atomically
 * renames the file, then records the artifact in the completion log. This is
 * the only place that sets `incomplete: false`; any other writer path leaves
 * the default `true` in place, and the dashboard treats truthy / missing flag
 * as "in-flight".
 */
function writeFinalArtifact(filePath: string, periodKey: string, artifact: Artifact, payload: unknown): void {
  let final: unknown = payload;
  if (final && typeof final === "object" && !Array.isArray(final)) {
    final = { ...(final as Record<string, unknown>), incomplete: false };
  }
  atomicWrite(filePath, JSON.stringify(final, null, 2));
  markComplete(periodKey, artifact);
}

/**
 * Run a cluster's LLM call OR load an existing finalised run from the log.
 *
 * On a fresh day: runs `call()`, writes the insight with `incomplete: false`
 * + appends to the completion log, pushes to ingest. On a re-run where the
 * log already has this cluster: loads the insight from disk and returns a
 * synthetic ok result, skipping the LLM. A failed prior run (no log entry)
 * is retried by re-invoking `call()`.
 */
async function runOrLoadCluster(args: {
  cluster: V3Cluster;
  outDir: string;
  insightFile: string;
  artifact: V3Artifact;
  call: () => Promise<UseCaseRunResult>;
}): Promise<{ ok: boolean; insight: unknown; errors: string[]; skipped: boolean }> {
  const { cluster, outDir, insightFile, artifact, call } = args;
  const periodKey = extractPeriodKey(outDir);
  if (isComplete(periodKey, artifact)) {
    const existing = readExistingInsight(outDir, insightFile);
    log.info(`v3:${cluster}`, "already finalised — reuse insight (skip LLM)");
    return { ok: true, insight: existing, errors: [], skipped: true };
  }
  const run = await call();
  const insightPath = path.join(outDir, insightFile);
  if (run.insight && typeof run.insight === "object") {
    if (run.ok) {
      writeFinalArtifact(insightPath, periodKey, artifact, run.insight);
    } else {
      // Failed run — write the payload but leave `incomplete: true` so retries
      // know to re-run, and skip the log append.
      atomicWrite(insightPath, JSON.stringify(run.insight, null, 2));
    }
  }
  await pushInsight({
    periodKey,
    cluster,
    status: run.ok ? "complete" : "partial",
    payload: run.insight ?? {},
    source: "runner_v3",
  });
  return {
    ok: run.ok,
    insight: run.insight,
    errors: run.ok ? [] : [run.errors.slice(-1).join("|")],
    skipped: false,
  };
}

/** Pull the YYYY-MM-DD segment out of the daily output dir. */
function extractPeriodKey(outDir: string): string {
  return path.basename(outDir);
}

export async function runV3Cluster(
  cluster: V3Cluster,
  opts: { periodKey: string; tz?: string; model?: string },
): Promise<ClusterRunResult> {
  return withContext({ kind: `v3:${cluster}`, periodKey: opts.periodKey }, () =>
    runV3ClusterInner(cluster, opts),
  ) as Promise<ClusterRunResult>;
}

async function runV3ClusterInner(
  cluster: V3Cluster,
  opts: { periodKey: string; tz?: string; model?: string },
): Promise<ClusterRunResult> {
  const t0 = Date.now();
  const tz = opts.tz ?? config.timezone ?? "Europe/Berlin";
  const db = openDb();
  const insightsRoot = config.insightsRoot;
  const outDir = path.join(insightsRoot, "daily", opts.periodKey);
  mkdirSync(outDir, { recursive: true });

  const cfg = CLUSTER_CONFIG[cluster];
  const pkgPath = path.join(outDir, cfg.packageFile);
  const insightPath = path.join(outDir, cfg.insightFile);

  // Pick-up: if completion log already records this cluster as done, skip.
  if (isComplete(opts.periodKey, cfg.artifact)) {
    log.info(`v3:${cluster}`, "already finalised — skip");
    return {
      ok: true,
      cluster,
      periodKey: opts.periodKey,
      artifacts: [pkgPath, insightPath],
      totalMs: Date.now() - t0,
      errors: [],
      skipped: true,
    };
  }

  const pkg = await Promise.resolve(
    cfg.buildPackage({ periodKey: opts.periodKey, db, insightsRoot, tz }),
  );
  atomicWrite(pkgPath, JSON.stringify(pkg, null, 2));
  // Push the package as 'live' so the dashboard shows numeric KPIs before
  // the LLM finishes. The insight row stays 'pending' until run completes.
  await pushInsight({
    periodKey: opts.periodKey,
    cluster: `${cluster}_package`,
    status: "live",
    payload: pkg,
    source: "runner_v3",
  });
  const run = await runUseCase({
    model: opts.model,
    systemPrompt: cfg.systemPrompt,
    userPrompt: cfg.buildUserPrompt(pkg),
    schema: cfg.schema,
    pkg,
    manifest: cfg.manifest,
    tag: cluster,
    formatMode: cfg.formatMode,
  });
  if (run.insight && typeof run.insight === "object") {
    if (run.ok) writeFinalArtifact(insightPath, opts.periodKey, cfg.artifact, run.insight);
    else atomicWrite(insightPath, JSON.stringify(run.insight, null, 2));
  }
  await pushInsight({
    periodKey: opts.periodKey,
    cluster,
    status: run.ok ? "complete" : "partial",
    payload: run.insight ?? {},
    source: "runner_v3",
  });
  return {
    ok: run.ok,
    cluster,
    periodKey: opts.periodKey,
    artifacts: [pkgPath, insightPath],
    totalMs: Date.now() - t0,
    errors: run.ok ? [] : [run.errors.slice(-1).join("|")],
  };
}

// ── Public entry ────────────────────────────────────────────────────────────

export interface V3OrchestratorOpts {
  periodKey: string;
  tz?: string;
  /** Skip LLM stages (live mode for in-progress day). */
  liveOnly?: boolean;
  /** Override model (default config.model = qwen3.6:latest). */
  model?: string;
  /** Override day_of_week derivation. */
  dayOfWeekOverride?: string;
}

export interface V3OrchestratorResult {
  ok: boolean;
  periodKey: string;
  liveOnly: boolean;
  artifacts: string[];
  totalMs: number;
  errors: string[];
  stage_b_ms: number;
  stage_l_ms: number;
  stage_s_ms: number;
  stage_w_ms: number;
}

export async function runV3(opts: V3OrchestratorOpts): Promise<V3OrchestratorResult> {
  return withContext({ kind: "v3", periodKey: opts.periodKey }, () =>
    runV3Inner(opts),
  ) as Promise<V3OrchestratorResult>;
}

async function runV3Inner(opts: V3OrchestratorOpts): Promise<V3OrchestratorResult> {
  const tz = opts.tz ?? config.timezone ?? "Europe/Berlin";
  const t0 = Date.now();
  const errors: string[] = [];
  const db = openDb();
  const insightsRoot = config.insightsRoot;
  const outDir = path.join(insightsRoot, "daily", opts.periodKey);
  mkdirSync(outDir, { recursive: true });

  // ── Stage B — package builders (sequential, fast) ──────────────────────────
  const tB0 = Date.now();
  const sleepPkg = buildSleepPackage({ periodKey: opts.periodKey, db, insightsRoot, tz });
  const recoveryPkg = buildRecoveryPackage({ periodKey: opts.periodKey, db, insightsRoot, tz });
  const activityPkg = buildActivityPackage({ periodKey: opts.periodKey, db, insightsRoot, tz });
  const trainingPkg = buildTrainingPackage({ periodKey: opts.periodKey, db, insightsRoot, tz });
  const stageBMs = Date.now() - tB0;

  // Persist packages — useful for audit even in live mode.
  const sleepPkgPath = path.join(outDir, "sleep_package.json");
  const recoveryPkgPath = path.join(outDir, "recovery_package.json");
  const activityPkgPath = path.join(outDir, "activity_package.json");
  const trainingPkgPath = path.join(outDir, "training_package.json");
  atomicWrite(sleepPkgPath, JSON.stringify(sleepPkg, null, 2));
  atomicWrite(recoveryPkgPath, JSON.stringify(recoveryPkg, null, 2));
  atomicWrite(activityPkgPath, JSON.stringify(activityPkg, null, 2));
  atomicWrite(trainingPkgPath, JSON.stringify(trainingPkg, null, 2));

  // Compute deterministic day_score from facts (always, used by hero).
  const factsToday = readFactsForDate(insightsRoot, opts.periodKey);
  const dayScore = computeDayScoreFromFacts(factsToday);
  const dayScorePath = path.join(outDir, "day_score.json");
  atomicWrite(dayScorePath, JSON.stringify(dayScore, null, 2));

  // Push the day score + each package the moment they're ready. The
  // dashboard renders these numeric tiles before any LLM stage completes.
  await Promise.all([
    pushInsight({ periodKey: opts.periodKey, cluster: "day_score", status: "complete", payload: dayScore, source: "runner_v3" }),
    pushInsight({ periodKey: opts.periodKey, cluster: "sleep_package", status: "live", payload: sleepPkg, source: "runner_v3" }),
    pushInsight({ periodKey: opts.periodKey, cluster: "recovery_package", status: "live", payload: recoveryPkg, source: "runner_v3" }),
    pushInsight({ periodKey: opts.periodKey, cluster: "activity_package", status: "live", payload: activityPkg, source: "runner_v3" }),
    pushInsight({ periodKey: opts.periodKey, cluster: "training_package", status: "live", payload: trainingPkg, source: "runner_v3" }),
    pushBundle({ periodKey: opts.periodKey, pipeline: "v3", status: "live", stages: { stage_b_ms: stageBMs } }),
  ]);

  if (opts.liveOnly) {
    return {
      ok: true,
      periodKey: opts.periodKey,
      liveOnly: true,
      artifacts: [sleepPkgPath, recoveryPkgPath, activityPkgPath, trainingPkgPath, dayScorePath],
      totalMs: Date.now() - t0,
      errors,
      stage_b_ms: stageBMs,
      stage_l_ms: 0,
      stage_s_ms: 0,
      stage_w_ms: 0,
    };
  }

  // ── Stage L — LLM use-case calls (parallel, pick-up per cluster) ──────────
  // Each cluster is independently sentinel-gated: prior successful runs are
  // loaded from disk and the LLM call is skipped. A failed cluster on a past
  // run gets retried on the next sweep.
  const sleepInsightPath = path.join(outDir, "sleep_insight.json");
  const recoveryInsightPath = path.join(outDir, "recovery_insight.json");
  const activityInsightPath = path.join(outDir, "activity_insight.json");
  const trainingInsightPath = path.join(outDir, "training_insight.json");

  const tL0 = Date.now();
  const [sleepRun, recoveryRun, activityRun, trainingRun] = await Promise.all([
    runOrLoadCluster({
      cluster: "sleep",
      outDir,
      insightFile: "sleep_insight.json",
      artifact: "v3_sleep",
      call: () => runUseCase({
        model: opts.model,
        systemPrompt: SLEEP_SYSTEM_PROMPT,
        userPrompt: buildSleepUserPrompt(sleepPkg),
        schema: CLUSTER_CONFIG.sleep.schema,
        pkg: sleepPkg,
        manifest: SLEEP_MANIFEST,
        tag: "sleep",
      }),
    }),
    runOrLoadCluster({
      cluster: "recovery",
      outDir,
      insightFile: "recovery_insight.json",
      artifact: "v3_recovery",
      call: () => runUseCase({
        model: opts.model,
        systemPrompt: RECOVERY_SYSTEM_PROMPT,
        userPrompt: buildRecoveryUserPrompt(recoveryPkg),
        schema: CLUSTER_CONFIG.recovery.schema,
        pkg: recoveryPkg,
        manifest: RECOVERY_MANIFEST,
        tag: "recovery",
      }),
    }),
    runOrLoadCluster({
      cluster: "activity",
      outDir,
      insightFile: "activity_insight.json",
      artifact: "v3_activity",
      call: () => runUseCase({
        model: opts.model,
        systemPrompt: ACTIVITY_SYSTEM_PROMPT,
        userPrompt: buildActivityUserPrompt(activityPkg),
        schema: CLUSTER_CONFIG.activity.schema,
        pkg: activityPkg,
        manifest: ACTIVITY_MANIFEST,
        tag: "activity",
      }),
    }),
    runOrLoadCluster({
      cluster: "training",
      outDir,
      insightFile: "training_insight.json",
      artifact: "v3_training",
      call: () => runUseCase({
        model: opts.model,
        systemPrompt: TRAINING_SYSTEM_PROMPT,
        // Within the day_end pipeline run we emit a `prescription` insight
        // for tomorrow. Post-session insights are emitted by the
        // workout_complete subscriber via runV3Cluster (see subscribers.ts).
        userPrompt: buildTrainingUserPrompt(trainingPkg, "prescription"),
        schema: CLUSTER_CONFIG.training.schema,
        pkg: trainingPkg,
        manifest: TRAINING_MANIFEST,
        tag: "training",
        // Ollama's grammar-constrained format mode rejects the training
        // schema's nullable nested objects (`anyOf` with type:null) — even
        // after inlining cross-file $refs. Drop to `format: "json"` and
        // rely on Ajv post-validation. Other clusters keep the strict
        // grammar mode (their schemas are flat).
        formatMode: "json",
      }),
    }),
  ]);
  const stageLMs = Date.now() - tL0;

  if (!sleepRun.ok) errors.push(`sleep: ${sleepRun.errors.slice(-1).join("|")}`);
  if (!recoveryRun.ok) errors.push(`recovery: ${recoveryRun.errors.slice(-1).join("|")}`);
  if (!activityRun.ok) errors.push(`activity: ${activityRun.errors.slice(-1).join("|")}`);
  if (!trainingRun.ok) errors.push(`training: ${trainingRun.errors.slice(-1).join("|")}`);

  // ── Stage M — morning briefing (depends on sleep+recovery+activity insights
  //              already written, so runs sequentially after the parallel batch)
  const morningRun = await runV3ClusterInner("morning", opts);
  if (!morningRun.ok) errors.push(`morning: ${morningRun.errors.slice(-1).join("|")}`);

  // ── Stage S — synthesis call (pick-up: skip if log records it) ────────────
  const dailyV3Path = path.join(outDir, "daily_v3.json");
  const synthesisPkgPath = path.join(outDir, "synthesis_package.json");
  const tS0 = Date.now();
  let synthesisOk = false;
  if (isComplete(opts.periodKey, "v3_synthesis")) {
    log.info("v3:synthesis", "already finalised — skip");
    synthesisOk = true;
  } else {
    const synthesisPkg = buildSynthesisPackage({
      periodKey: opts.periodKey,
      tz,
      dayOfWeek: opts.dayOfWeekOverride ?? dayOfWeekKey(opts.periodKey, tz),
      isWeekend: isWeekend(opts.periodKey, tz),
      sleep: { domain: "sleep", insight: sleepRun.insight, ok: sleepRun.ok },
      recovery: { domain: "recovery", insight: recoveryRun.insight, ok: recoveryRun.ok },
      activity: { domain: "activity", insight: activityRun.insight, ok: activityRun.ok },
      dayScore,
    });
    atomicWrite(synthesisPkgPath, JSON.stringify(synthesisPkg, null, 2));

    const synthesisRun = await runSynthesis(synthesisPkg, opts.model);
    if (!synthesisRun.ok) errors.push(`synthesis: ${synthesisRun.errors.slice(-1).join("|")}`);
    synthesisOk = synthesisRun.ok;

    if (synthesisRun.insight && typeof synthesisRun.insight === "object") {
      if (synthesisRun.ok) {
        writeFinalArtifact(dailyV3Path, opts.periodKey, "v3_synthesis", synthesisRun.insight);
      } else {
        atomicWrite(dailyV3Path, JSON.stringify(synthesisRun.insight, null, 2));
      }
    }
    await pushInsight({
      periodKey: opts.periodKey,
      cluster: "synthesis",
      status: synthesisRun.ok ? "complete" : "partial",
      payload: synthesisRun.insight ?? {},
      source: "runner_v3",
    });
  }
  const stageSMs = Date.now() - tS0;
  const stageWMs = 0;
  void synthesisOk;
  await pushBundle({
    periodKey: opts.periodKey,
    pipeline: "v3",
    status: errors.length === 0 ? "complete" : "partial",
    stages: { stage_b_ms: stageBMs, stage_l_ms: stageLMs, stage_s_ms: stageSMs, stage_w_ms: stageWMs },
    verify: { errors },
  });

  return {
    ok: errors.length === 0,
    periodKey: opts.periodKey,
    liveOnly: false,
    artifacts: [
      sleepPkgPath,
      recoveryPkgPath,
      activityPkgPath,
      trainingPkgPath,
      dayScorePath,
      sleepInsightPath,
      recoveryInsightPath,
      activityInsightPath,
      trainingInsightPath,
      synthesisPkgPath,
      dailyV3Path,
    ],
    totalMs: Date.now() - t0,
    errors,
    stage_b_ms: stageBMs,
    stage_l_ms: stageLMs,
    stage_s_ms: stageSMs,
    stage_w_ms: stageWMs,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeDayScoreFromFacts(facts: Record<string, unknown> | null) {
  const sleep = (facts?.sleep as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const cardio = (facts?.cardio as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const activity = (facts?.activity as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};
  const stress = (facts?.stress as { metrics?: Record<string, number | null> } | undefined)?.metrics ?? {};

  const baselines = {
    ...pickBaselines(facts, "sleep", ["sleep_efficiency_pct", "tst_min", "rmssd_ms", "rhr_sleep_bpm"]),
    ...pickBaselines(facts, "cardio", ["rhr_day_bpm"]),
    ...pickBaselines(facts, "stress", ["stress_mean"]),
    ...pickBaselines(facts, "activity", ["steps", "active_minutes"]),
  };

  return computeDayScore(
    {
      sleep_efficiency_pct: sleep.sleep_efficiency_pct ?? null,
      tst_min: sleep.tst_min ?? null,
      rmssd_ms: sleep.rmssd_ms ?? null,
      rhr_day_bpm: cardio.rhr_day_bpm ?? null,
      rhr_sleep_bpm: sleep.rhr_sleep_bpm ?? null,
      stress_mean: stress.stress_mean ?? null,
      steps: activity.steps ?? null,
      active_minutes: activity.active_minutes ?? null,
    },
    baselines,
  );
}

function atomicWrite(target: string, content: string): void {
  // CLAUDE.md hard rule: stream insight writes through `$PULSE_STAGING_ROOT`
  // and rename into place. Writing `${target}.tmp` inside `$INSIGHTS_ROOT`
  // exposes the half-written file to Syncthing replication.
  mkdirSync(STAGING_ROOT, { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = path.join(STAGING_ROOT, `${path.basename(target)}.${randomUUID()}.tmp`);
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, target);
  } catch (err) {
    // Cross-device rename fails with EXDEV. Copy into a tmp file ADJACENT to
    // the target (same filesystem), then rename atomically. Writing the final
    // path directly would expose a half-written file to Syncthing replication.
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      const tmp2 = `${target}.tmp.${process.pid}.${Date.now()}`;
      copyFileSync(tmp, tmp2);
      renameSync(tmp2, target);
      try {
        unlinkSync(tmp);
      } catch {
        /* swallow */
      }
    } else {
      throw err;
    }
  }
}

function dayOfWeekKey(periodKey: string, tz: string): string {
  const d = new Date(`${periodKey}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return fmt.toLowerCase();
}

function isWeekend(periodKey: string, tz: string): boolean {
  const wd = dayOfWeekKey(periodKey, tz);
  return wd === "sat" || wd === "sun";
}
