/**
 * V2 orchestrator: 7-stage daily pipeline.
 *
 * Stages:
 *   0. Facts (deterministic SQL aggregation)
 *   1. Rules (pure rule engine)
 *   2. Retrieval (similar-day k-NN — P3 stub)
 *   3. Evidence picker (LLM — P3 stub)
 *   4. Prose draft (LLM — P3 stub, always abstain=true)
 *   5. (deleted in v2)
 *   6. Verify (5-layer gate)
 *   7. Atomic write (staging → rename into insights/daily/<date>/)
 *
 * Failure mode: render coherent. We always write *something* — last-good
 * insight + status note > blank/hallucinated.
 */

import { randomUUID } from "node:crypto";

import type {
  BundleManifestV2,
  DailyInsightV2,
  FactsBundleV2,
  StageRecord,
  AlarmStateV1 as GenAlarmStateV1,
} from "@/lib/types/generated";
import type { AlarmStateV1 } from "./rules/types.ts";

import { config } from "./config.ts";
import { db as openDb } from "./db.ts";
import { log, withContext } from "./logger.ts";
import {
  isDailyFinalised,
  isDayComplete,
} from "./period.ts";
import { markComplete } from "./state/completion-log.ts";
import { buildDailyFacts } from "./facts/daily.ts";
import { runStage1 } from "./stages/stage1-rules.ts";
import { findSimilarDays } from "./stages/stage2-retrieval.ts";
import { runStage3 } from "./stages/stage3-evidence.ts";
import { runStage4 } from "./stages/stage4-prose.ts";
import {
  verify,
  criticalFailed,
  checkSemanticViolations,
  s1StubSummary,
  type VerifyResult,
} from "./stages/stage6-verify.ts";
import { runCritic } from "./stages/stage6-critic.ts";
import {
  writeDailyAtomic,
  writeLiveAtomic,
  writeAlarmStateAtomic,
} from "./stages/stage7-write.ts";
import { ensureStateFiles } from "./state/bootstrap.ts";
import { persistAlarms } from "./output/alarms.ts";
// Lever computation + per-lever LLM cards used to live in Stage 5 here;
// both moved to the v3 morning cluster (`runner/src/v3/packagers/morning.ts`)
// after the trigger shifted from day_end to sleep_complete.
import {
  computeSurpriseCandidates,
  frameSurpriseInsight,
  type SurpriseInsight,
} from "./analyzer/surprise-ranking.ts";
import { detectPatterns } from "./analyzer/pattern-detection.ts";
import { namePattern } from "./analyzer/pattern-naming.ts";
import { readPatterns, upsertPattern } from "./analyzer/pattern-library.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RunOptions {
  /** Skip Stage 7 atomic write — used for tests / dry-runs. */
  dryRun?: boolean;
  /** ISO local time string to feed the rule engine; defaults to now. */
  currentLocalTime?: string;
  /** Force Stage W (weekly) even if `periodKey` is not a Sunday. */
  runWeekly?: boolean;
  /**
   * Bypass the day-complete gate. Used by `backfill` (replays past days that
   * are obviously finished but bypasses the sentinel re-run guard) and by
   * interactive `daily --date=…` runs. Production watch + cron paths must
   * NOT pass force=true.
   */
  force?: boolean;
  /**
   * Live mode — run only stages 0/1 + alarms + facts/bundle write. Skips
   * every LLM stage (3/4/5/5b/W) and never writes daily.json. Used by the
   * watch container so the dashboard always sees fresh facts mid-day, but
   * the LLM verdict is reserved for the post-day finalize cron.
   */
  liveOnly?: boolean;
}

export type RunResult =
  | { ok: true; daily: DailyInsightV2; facts: FactsBundleV2; bundle: BundleManifestV2; verify: VerifyResult }
  | { ok: false; error: string; bundle: BundleManifestV2 };

const STAGE4_MODEL_VERSION = "p4-daily-v2";

/**
 * Run the full daily pipeline for `periodKey` (YYYY-MM-DD).
 */
export async function runDaily(periodKey: string, opts: RunOptions = {}): Promise<RunResult> {
  return withContext({ kind: "v2", periodKey }, () => runDailyInner(periodKey, opts)) as Promise<RunResult>;
}

async function runDailyInner(periodKey: string, opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const stageRecords: StageRecord[] = [];
  const timings: Record<string, number> = {};

  const bundle: BundleManifestV2 = {
    schema_version: "bundle/v2",
    period_key: periodKey,
    timeframe: "daily",
    run_id: runId,
    started_at: startedAt,
    updated_at: startedAt,
    pipeline_status: "running",
    model: config.model,
    model_version: STAGE4_MODEL_VERSION,
    runs: stageRecords,
    timings,
  };

  const recordStage = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = Date.now();
    const stageStarted = new Date().toISOString();
    const rec: StageRecord = {
      stage: name,
      status: "ok",
      started_at: stageStarted,
      ended_at: null,
      error: null,
    };
    stageRecords.push(rec);
    try {
      const out = await fn();
      const dt = Date.now() - t0;
      timings[name] = dt;
      rec.ended_at = new Date().toISOString();
      log.info(name, `ok ${dt}ms`);
      return out;
    } catch (err) {
      rec.status = "failed";
      rec.error = err instanceof Error ? err.message : String(err);
      rec.ended_at = new Date().toISOString();
      throw err;
    }
  };

  // Day-complete gate. The full LLM pipeline only runs for finished days.
  // If `force=true` we bypass — used by backfills and manual `daily --date=…`.
  // If `liveOnly=true` we run a reduced pipeline (stages 0/1 + alarms only).
  // Otherwise: in-progress day → degrade to liveOnly automatically.
  const dayComplete = isDayComplete(periodKey);
  const effectiveLiveOnly =
    opts.liveOnly === true || (!dayComplete && opts.force !== true);

  // Re-run guard. Once the completion log records `v2_daily` for this date
  // and the caller did not pass force=true, exit immediately. Avoids the
  // historical bug where `daily-watch` re-fired all LLM stages on every DB
  // sync. The log entry is only appended by a successful full-pipeline run.
  if (!effectiveLiveOnly && opts.force !== true && isDailyFinalised(periodKey)) {
    bundle.pipeline_status = "ok";
    bundle.updated_at = new Date().toISOString();
    log.info("guard", "already finalised, skip");
    return {
      ok: true,
      daily: {} as DailyInsightV2,
      facts: {} as FactsBundleV2,
      bundle,
      verify: { ok: true, layers: [] } as VerifyResult,
    };
  }

  if (effectiveLiveOnly) {
    bundle.pipeline_status = "live";
    log.info("v2", `mode=live (day_complete=${dayComplete}${opts.force === true ? " force" : ""})`);
  } else {
    log.info("v2", `mode=full (day_complete=${dayComplete}${opts.force === true ? " force" : ""})`);
  }

  try {
    // ── Bootstrap state files ───────────────────────────────────────────────
    const state = await ensureStateFiles();
    let alarmState: AlarmStateV1 = state.alarmState as AlarmStateV1;

    // ── Stage 0: facts ──────────────────────────────────────────────────────
    const facts = await recordStage("stage0_facts", async () =>
      buildDailyFacts(periodKey),
    );

    // ── Stage 1: rules ──────────────────────────────────────────────────────
    const localNow =
      opts.currentLocalTime ?? new Date().toISOString().replace("Z", "");
    const rules = await recordStage("stage1_rules", () =>
      runStage1(facts, alarmState, localNow, state.pause, openDb()),
    );

    // ── Live-only shortcut ────────────────────────────────────────────────
    // In-progress day: persist alarms (so safety alerts still fire), write
    // _facts.json + _bundle.json, and exit. NO daily.json is written, so the
    // dashboard renders a "Tages-Insight wird heute Nacht berechnet" state
    // until the post-completion finalize cron runs.
    if (effectiveLiveOnly) {
      if (!opts.dryRun) {
        const { appended, updatedState } = await persistAlarms(
          rules.observations,
          periodKey,
          alarmState,
          config.alarmsRoot,
        );
        if (appended.length > 0) {
          await writeAlarmStateAtomic(updatedState as GenAlarmStateV1, config.stateRoot);
        }
        bundle.updated_at = new Date().toISOString();
        await recordStage("stage7_write_live", () =>
          writeLiveAtomic(facts, bundle, periodKey),
        );
      }
      return {
        ok: true,
        daily: {} as DailyInsightV2,
        facts,
        bundle,
        verify: { ok: true, layers: [] } as VerifyResult,
      };
    }

    // ── Early-abstain shortcut ────────────────────────────────────────────
    // If rule engine says abstain (cold-start, no observations, sparse data),
    // skip LLM stages entirely and emit a deterministic German one-liner.
    // Saves ~25-90s of LLM time per empty/cold day.
    let daily: DailyInsightV2;
    if (rules.abstain) {
      log.info("v2", `early abstain: ${rules.abstain_reason} (skip stages 2-4)`);
      daily = buildDeterministicAbstain(periodKey, rules.abstain_reason ?? "Heute keine Beobachtungen.", state.pause);
    } else {
      // ── Stage 2: retrieval ─────────────────────────────────────────────────
      // Currently a no-op: the k-NN index never landed (`query day missing
      // features`). We pass an empty list straight to Stage 4. Restore the
      // call once the embedding/index pipeline ships.
      const similarDays: Awaited<ReturnType<typeof findSimilarDays>> = [];

      // ── Stage 3: evidence picker (deterministic by default) ────────────────
      const picked = await recordStage("stage3_evidence", () =>
        runStage3(rules.observations),
      );

      // ── Stage 4: prose draft (LLM, structured output) ──────────────────────
      // Regen-with-feedback loop. After the initial generation, run a focused
      // semantic check (paired numeric grounding + S1 relativisation +
      // regen-able forbidden patterns) and on violations call Stage 4 again
      // with the violation list as a `feedback` block. Up to 2 regenerations.
      // If the loop exhausts and an S1 was relativised, we replace the summary
      // with a deterministic stub rather than ship safety-undermining prose.
      const SEMANTIC_REGEN_ATTEMPTS = 2;
      let stage4 = await recordStage("stage4_prose", () =>
        runStage4(facts, rules.observations, picked, similarDays, state.pause),
      );
      let lastS1Triggered = false;
      // Regen temperature decay: 0.10 on regen 1, 0.05 on regen 2. The
      // initial Stage 4 call uses the default 0.15. Lower temperatures on
      // retries focus the model on the exact violations instead of
      // exploring new prose.
      const REGEN_TEMPS = [0.10, 0.05];
      for (let regen = 0; regen < SEMANTIC_REGEN_ATTEMPTS; regen++) {
        if (stage4.used_abstain_fallback || stage4.daily.abstain) break;
        const semantics = checkSemanticViolations(
          stage4.daily,
          facts,
          rules.observations,
        );
        lastS1Triggered = semantics.s1Triggered;
        if (semantics.ok) break;
        log.warn("stage4", `regen ${regen + 1}/${SEMANTIC_REGEN_ATTEMPTS}: ${semantics.violations.length} violation(s) — ${semantics.violations[0]}`);
        stage4 = await recordStage(`stage4_prose_regen_${regen + 1}`, () =>
          runStage4(facts, rules.observations, picked, similarDays, state.pause, {
            feedback: semantics.violations,
            temperatureBase: REGEN_TEMPS[regen],
          }),
        );
      }
      // Optional critic-model pass before the final semantic check. The
      // critic runs only when RUNNER_CRITIC_MODEL is set; it produces a
      // German violation list that is folded into one extra regen attempt.
      // Swallow all critic errors — never let it block the pipeline.
      if (
        process.env.RUNNER_CRITIC_MODEL &&
        !stage4.used_abstain_fallback &&
        !stage4.daily.abstain
      ) {
        const critic = await recordStage("stage6_critic", () => runCritic(stage4.daily));
        if (critic.violations.length > 0) {
          log.warn("stage6_critic", `${critic.violations.length} violation(s) — regen stage 4`);
          stage4 = await recordStage("stage4_prose_regen_critic", () =>
            runStage4(facts, rules.observations, picked, similarDays, state.pause, {
              feedback: critic.violations,
            }),
          );
        }
      }

      // Final post-loop check. If still violating S1 specifically, swap the
      // summary for a deterministic stub. Any lingering non-S1 violations are
      // logged here AND persisted into the bundle manifest as a synthetic
      // stage record so the run trace survives.
      const finalSemantics = checkSemanticViolations(
        stage4.daily,
        facts,
        rules.observations,
      );
      if (finalSemantics.s1Triggered && !stage4.daily.abstain) {
        log.warn("stage4", `S1 stub fallback after ${SEMANTIC_REGEN_ATTEMPTS} regens`);
        stage4.daily.summary = s1StubSummary(rules.observations);
      }
      if (!finalSemantics.ok && !stage4.daily.abstain) {
        const residual = finalSemantics.violations.slice(0, 6).join(" | ");
        log.warn("stage4", `residual violations (${finalSemantics.violations.length}): ${finalSemantics.violations.slice(0, 3).join(" | ")}`);
        const nowIso = new Date().toISOString();
        stageRecords.push({
          stage: "stage4_residuals",
          status: "partial",
          started_at: nowIso,
          ended_at: nowIso,
          error: residual,
        });

        // Drop drivers that the regen loop could not fix. Each violation
        // string starts with `driver "<metric_id>"`; collect those metric
        // ids and remove the matching drivers. The schema permits 0-3
        // drivers, so an empty list is valid. Without this, ungrounded or
        // direction-flipped drivers ship to the dashboard despite being
        // flagged.
        const offending = new Set<string>();
        for (const v of finalSemantics.violations) {
          const m = /^driver "([^"]+)"/.exec(v);
          if (m) offending.add(m[1]);
        }
        if (offending.size > 0) {
          const before = stage4.daily.drivers.length;
          stage4.daily.drivers = stage4.daily.drivers.filter(
            (d) => !offending.has(d.metric_id),
          ) as DailyInsightV2["drivers"];
          const after = stage4.daily.drivers.length;
          if (after < before) {
            log.warn("stage4", `dropped ${before - after} unfixable driver(s): ${[...offending].join(", ")}`);
          }
        }
      }
      void lastS1Triggered;
      daily = stage4.daily;
    }

    // ── Alarm persistence ─────────────────────────────────────────────────
    // Runs on every non-dry-run execution including abstain days so S1 safety
    // alarms are never blocked by LLM abstention. Moved here (before stage 5)
    // so the alarm side-effect is independent of LLM coaching outcomes.
    if (!opts.dryRun) {
      const { appended, updatedState } = await persistAlarms(
        rules.observations,
        periodKey,
        alarmState,
        config.alarmsRoot,
      );
      if (appended.length > 0) {
        await writeAlarmStateAtomic(updatedState as GenAlarmStateV1, config.stateRoot);
      }
      // Reflect the persisted state in the in-memory variable so any future
      // stage that reads `alarmState` sees the latest snooze/dismiss/mute
      // counts. Today nothing downstream reads it, but this keeps the
      // invariant simple if a stage is added.
      alarmState = updatedState as AlarmStateV1;
    }

    // (Former Stage 5 — per-lever coaching trajectory — moved to the v3
    // morning cluster which fires on `sleep_complete`. The /coach UI now
    // reads `morning_insight.levers`; `daily.coaching_cards` is no longer
    // populated. See `runner/src/v3/{packagers,prompts}/morning.ts`.)

    // ── Stage 5b: pattern naming + surprise ranking ────────────────────────
    // Per PROBE_pattern_naming_and_surprise.md: math computes ranking +
    // clustering + z-score + label-banding; LLM only writes the framing.
    // Sequential Ollama calls (single GPU). Catastrophic failure here MUST
    // NOT fail the daily pipeline — try-catch wrap, log, skip.
    const surpriseInsights = await recordStage("stage5b_patterns", async () => {
      const insights: SurpriseInsight[] = [];
      try {
        // ── A. Surprise candidates → frame top 5 ─────────────────────────
        const candidates = await computeSurpriseCandidates(
          periodKey,
          config.insightsRoot,
          5,
        );
        log.info("stage5b_patterns", `${candidates.length} surprise candidate(s) (|z|≥1.5)`);
        for (const c of candidates) {
          try {
            const framed = await frameSurpriseInsight(c, {
              ollamaUrl: config.ollamaUrl,
              periodKey,
            });
            insights.push(framed);
          } catch (innerErr) {
            const msg =
              innerErr instanceof Error ? innerErr.message : String(innerErr);
            log.warn("stage5b_patterns", `surprise framing ${c.metric} failed: ${msg}`);
          }
        }

        // ── B. Pattern detection + naming ────────────────────────────────
        const clusters = await detectPatterns(config.insightsRoot, periodKey, 90);
        log.info("stage5b_patterns", `${clusters.length} recurring cluster(s)`);
        const existingIds = new Set(readPatterns(200).map((p) => p.id));
        for (const cluster of clusters) {
          if (existingIds.has(cluster.signature_id)) {
            // Bump occurrence_count + last_seen via upsertPattern (it
            // increments on existing rows). Keep name/description as is.
            try {
              upsertPattern({
                id: cluster.signature_id,
                name_de: "", // unused on existing path (UPDATE keeps name)
                description_de: null,
                signature_json: JSON.stringify({
                  centroid: cluster.centroid,
                  salient_flags: cluster.salient_flags,
                }),
                first_seen: cluster.first_seen,
                last_seen: cluster.last_seen,
              });
            } catch (innerErr) {
              const msg =
                innerErr instanceof Error
                  ? innerErr.message
                  : String(innerErr);
              log.warn("stage5b_patterns", `upsert ${cluster.signature_id} failed: ${msg}`);
            }
            continue;
          }

          // New cluster → load up to 3 example day facts and name via LLM.
          const exampleDates = cluster.member_dates.slice(-3);
          const exampleDays: object[] = [];
          for (const d of exampleDates) {
            try {
              const txt = await readFile(
                path.join(config.insightsRoot, "daily", d, "_facts.json"),
                "utf8",
              );
              exampleDays.push(JSON.parse(txt) as object);
            } catch {
              /* skip missing */
            }
          }
          try {
            const named = await namePattern(cluster, exampleDays, {
              ollamaUrl: config.ollamaUrl,
            });
            upsertPattern({
              id: cluster.signature_id,
              name_de: named.name_de,
              description_de: named.description_de,
              signature_json: JSON.stringify({
                centroid: cluster.centroid,
                salient_flags: cluster.salient_flags,
              }),
              first_seen: cluster.first_seen,
              last_seen: cluster.last_seen,
            });
            log.info("stage5b_patterns", `named ${cluster.signature_id}: "${named.name_de}"`);
          } catch (innerErr) {
            const msg =
              innerErr instanceof Error ? innerErr.message : String(innerErr);
            log.warn("stage5b_patterns", `naming ${cluster.signature_id} failed: ${msg}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("stage5b_patterns", `skipped: ${msg}`);
      }
      return insights;
    });

    if (surpriseInsights.length > 0) {
      // daily/v2.2 — surprise_insights is additive on the existing payload.
      (daily as DailyInsightV2).surprise_insights =
        surpriseInsights as DailyInsightV2["surprise_insights"];
      daily.schema_version = "daily/v2.2" as DailyInsightV2["schema_version"];
    }

    // ── Stage 6: verify ─────────────────────────────────────────────────────
    // Moved AFTER stages 5/5b so the verifier sees the final daily payload
    // (with coaching_cards + surprise_insights when applicable). Previously
    // ran before, then 5/5b mutated `schema_version` to v2.1/v2.2, leaving
    // the verifier's pass referring to a stale snapshot.
    const factsString = JSON.stringify(facts);
    const verifyResult = await recordStage("stage6_verify", () =>
      verify(daily, facts, factsString, rules.observations),
    );
    if (criticalFailed(verifyResult)) {
      const failedLayers = verifyResult.layers
        .filter((l) => l.critical && !l.ok)
        .map((l) => `${l.name}: ${l.details}`)
        .join(" | ");
      log.error("stage6", `critical failure(s): ${failedLayers}`);
      bundle.pipeline_status = "partial";
    } else if (daily.abstain) {
      bundle.pipeline_status = "abstained";
    } else {
      bundle.pipeline_status = "ok";
    }

    // ── Stage 7: atomic write ───────────────────────────────────────────────
    if (!opts.dryRun) {
      bundle.updated_at = new Date().toISOString();
      await recordStage("stage7_write", () =>
        writeDailyAtomic(daily, facts, bundle, periodKey),
      );
      // Finalisation: record v2_daily in the completion log. Subsequent
      // `runDaily(periodKey)` calls without force=true exit early. Written
      // AFTER daily.json so a mid-write crash leaves the day re-runnable.
      markComplete(periodKey, "v2_daily");
    } else {
      log.info("stage7", "skipped (dry-run)");
    }

    // ── Stage W: weekly recap (Sunday + on-demand) ──────────────────────────
    // Runs every Sunday AND when caller passes runWeekly=true. Catastrophic
    // failure here MUST NOT fail the daily pipeline — try/catch wrap, log.
    if (!opts.dryRun) {
      // Use local-tz weekday (Europe/Berlin); UTC weekday would flip near
      // midnight UTC and silently skip real Sundays.
      const tzWeekday = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        weekday: "short",
      }).format(new Date(`${periodKey}T12:00:00Z`));
      const isSunday = tzWeekday === "Sun";
      if (isSunday || opts.runWeekly) {
        try {
          const { runStageWeekly } = await import("./stages/stageW-weekly.ts");
          const res = await recordStage("stageW_weekly", () =>
            runStageWeekly({ date: periodKey, insightsRoot: config.insightsRoot }),
          );
          if (!res.ok) {
            log.warn("stageW", `non-fatal: ${res.error ?? "unknown"} (week ${res.weekKey})`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("stageW", `skipped: ${msg}`);
        }
      }
    }

    return { ok: true, daily, facts, bundle, verify: verifyResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bundle.pipeline_status = "failed";
    bundle.updated_at = new Date().toISOString();
    return { ok: false, error: message, bundle };
  }
}

/**
 * Deterministic German abstain — no LLM call. Maps the rule engine's English
 * reason to a calm German one-liner from the prose-architect's family A/B/C/D
 * templates (no_observations / sparse_data / low_confidence / user_override_ok).
 */
function buildDeterministicAbstain(
  _periodKey: string,
  reasonEn: string,
  pause: { i_feel_fine?: boolean | null } | null | undefined,
): DailyInsightV2 {
  const family = reasonEn.toLowerCase().includes("cold-start")
    ? "sparse_data"
    : pause?.i_feel_fine
      ? "user_override_ok"
      : "no_observations";

  const templates: Record<string, string> = {
    no_observations: "Heute ist physiologisch unauffällig — bleib einfach dran.",
    sparse_data: "Daten zu spärlich, um etwas Verlässliches zu sagen — schau morgen wieder rein.",
    low_confidence: "Die Datenlage ist heute dünn — besser warten, bis mehr Werte vorliegen.",
    user_override_ok: "Du hast gesagt, es geht dir gut — die Daten bestätigen das heute.",
  };

  return {
    schema_version: "daily/v2",
    reasoning_trace:
      `Rule engine returned abstain. Reason (EN): ${reasonEn}. Family: ${family}. ` +
      `No LLM call needed — emitting deterministic German one-liner.`,
    language: "de",
    abstain: true,
    abstain_reason: templates[family],
    headline: null,
    verdict_band: null,
    summary: null,
    drivers: [],
    affirmation: null,
    reflection: null,
    action: null,
    i_feel_fine_override: pause?.i_feel_fine === true,
    confidence: {
      value: family === "sparse_data" ? 0.2 : 0.4,
      calc: family === "sparse_data" ? "0.2" : "0.4",
      factors: [
        `observations_count w=0.30 s=0.00 — 0 actionable observations`,
        `inputs_confidence_avg w=0.25 s=0.50 — domain inputs present but unactionable`,
        `cross_domain_agreement w=0.20 s=0.50 — no drivers to compare`,
        `baseline_available w=0.15 s=${family === "sparse_data" ? "0.00 — cold start" : "0.50 — partial baseline"}`,
        `freshness w=0.10 s=1.00 — generated fresh`,
      ],
    },
  } as DailyInsightV2;
}
