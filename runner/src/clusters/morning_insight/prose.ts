/**
 * morning_insight — Stage 1 (prose). Wraps the existing v3 morning LLM
 * call so the JobCell layer reuses the locked schema + system prompt.
 *
 * Dual-write transitional behaviour: after a successful prose pass we
 * also write the legacy `morning_insight.json` under
 * `$INSIGHTS_ROOT/daily/<periodKey>/morning_insight.json` via an atomic
 * rename so the existing `loadMorningInsight()` reader path stays alive
 * for the home page + /coach + every domain page that reads the file.
 *
 * Race-condition note: the legacy `runV3Cluster("morning", …)` writer
 * remains alive (`v3-orchestrator.ts` + `events/subscribers.ts`). Two
 * writers race to the same final path during overlapping pipeline
 * runs; atomic rename means the second writer wins. The JSON shape is
 * the same in both paths, so a momentary "stale-then-fresh-then-stale"
 * is the worst case until the legacy producer is retired.
 *
 * Abstain shortcut: when the extract package already has
 * `payload.abstain === true`, we skip the LLM entirely and return the
 * package as-is (with refreshed `generated_at`), then dual-write it.
 *
 * Critic pass: Phase 4 work. We log when the setting is on and short-
 * circuit to a single-model run. The plumbing (`ctx.criticModel`,
 * model-tag composition) is in place so the wiring drops in cleanly.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import {
  MORNING_SYSTEM_PROMPT,
  MORNING_MANIFEST,
  buildMorningUserPrompt,
} from "../../v3/prompts/morning.ts";
import morningInsightSchema from "../../v3/schemas/morning_insight.schema.json" with { type: "json" };
import { runUseCase } from "../../v3/runner.ts";
import type { ProseContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import { loadMorningPackage } from "./extract.ts";
import type {
  MorningCareForItem,
  MorningCitation,
  MorningDayShapeStep,
  MorningInsightPayload,
  MorningLeverCard,
  MorningTrainingRecommendation,
} from "./types.ts";

const STAGING_ROOT = process.env.PULSE_STAGING_ROOT ?? "/tmp/pulse-staging";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateLegacyShape = ajv.compile(morningInsightSchema);

/**
 * Map a cluster `MorningInsightPayload` back to the legacy
 * `MorningInsightV1` file shape. The two only diverge in the cluster's
 * extras (`period_key`, `model`) which the legacy reader / schema
 * doesn't accept (`additionalProperties: false`). Strip them on the way
 * out so the file is byte-stable against the prior writer.
 */
function toLegacyShape(p: MorningInsightPayload): Record<string, unknown> {
  return {
    schema_version: p.schema_version,
    incomplete: p.incomplete,
    language: p.language,
    abstain: p.abstain,
    abstain_reason: p.abstain_reason,
    headline: p.headline,
    summary_short: p.summary_short,
    summary_long: p.summary_long,
    verdict_band: p.verdict_band,
    training_recommendation: p.training_recommendation,
    day_shape: p.day_shape,
    care_for: p.care_for,
    levers: p.levers,
    citations: p.citations,
    confidence: p.confidence,
  };
}

/**
 * Atomically write `morning_insight.json`. Stage in `$PULSE_STAGING_ROOT`
 * then rename into place so Syncthing never picks up a half-file.
 * Mirrors `atomicWrite` in v3-orchestrator.
 */
async function writeMorningInsightJson(
  payload: MorningInsightPayload,
  periodKey: string,
  insightsRoot: string,
): Promise<void> {
  const dir = path.join(insightsRoot, "daily", periodKey);
  await mkdir(dir, { recursive: true });
  await mkdir(STAGING_ROOT, { recursive: true });
  const finalPath = path.join(dir, "morning_insight.json");
  const legacy = toLegacyShape(payload);
  const body = JSON.stringify(legacy, null, 2);
  const tmp = path.join(STAGING_ROOT, `morning_insight.json.${randomUUID()}.tmp`);
  await writeFile(tmp, body, "utf8");
  try {
    await rename(tmp, finalPath);
  } catch (err) {
    // EXDEV (cross-device rename) — fall back to adjacent-temp + rename
    // so the final replace stays atomic on the destination filesystem.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      const adj = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
      await writeFile(adj, body, "utf8");
      await rename(adj, finalPath);
    } else {
      throw err;
    }
  }
}

/**
 * Walk the LLM-emitted insight and merge it into the cluster payload.
 * The LLM-emitted shape (after passing the legacy schema) matches the
 * cluster's shape one-for-one — `period_key` + `model` are cluster
 * extras added here, not LLM-fillable.
 */
function mergeLlmInsight(
  base: MorningInsightPayload,
  llm: Record<string, unknown>,
  periodKey: string,
  modelTag: string,
): MorningInsightPayload {
  const tr = llm.training_recommendation as MorningTrainingRecommendation | undefined;
  return {
    schema_version: "use_case/morning/v1",
    // Final state — the writer flips this to false at atomic-rename
    // time; we mirror it here so the JobCell row matches the file.
    incomplete: false,
    language: (llm.language === "en" ? "en" : "de"),
    abstain: typeof llm.abstain === "boolean" ? llm.abstain : base.abstain,
    abstain_reason:
      typeof llm.abstain_reason === "string" || llm.abstain_reason === null
        ? (llm.abstain_reason as string | null)
        : base.abstain_reason,
    headline:
      typeof llm.headline === "string" || llm.headline === null
        ? (llm.headline as string | null)
        : base.headline,
    summary_short:
      typeof llm.summary_short === "string" || llm.summary_short === null
        ? (llm.summary_short as string | null)
        : base.summary_short,
    summary_long:
      typeof llm.summary_long === "string" || llm.summary_long === null
        ? (llm.summary_long as string | null)
        : base.summary_long,
    // verdict_band is locked — the prompt forbids the LLM from changing
    // it. Trust the seed value from extract() but fall through to the
    // LLM's copy if extract somehow left it null.
    verdict_band:
      base.verdict_band ??
      (llm.verdict_band === null ||
      llm.verdict_band === "above_usual" ||
      llm.verdict_band === "steady" ||
      llm.verdict_band === "below_usual"
        ? (llm.verdict_band as MorningInsightPayload["verdict_band"])
        : null),
    training_recommendation: tr ?? base.training_recommendation,
    day_shape: Array.isArray(llm.day_shape)
      ? (llm.day_shape as MorningDayShapeStep[])
      : base.day_shape,
    care_for: Array.isArray(llm.care_for)
      ? (llm.care_for as MorningCareForItem[])
      : base.care_for,
    levers: Array.isArray(llm.levers)
      ? (llm.levers as MorningLeverCard[])
      : base.levers,
    citations: Array.isArray(llm.citations)
      ? (llm.citations as MorningCitation[])
      : base.citations,
    confidence:
      llm.confidence && typeof llm.confidence === "object"
        ? (llm.confidence as MorningInsightPayload["confidence"])
        : base.confidence,
    model: modelTag,
    period_key: periodKey,
  };
}

/**
 * Build per-field provenance for everything the LLM filled. Mirrors the
 * weekly_recap cluster's approach — one tag per top-level prose field,
 * plus per-item tags for the array entries (day_shape / care_for /
 * levers) so the dashboard's ProvenanceRow can group them coherently.
 */
function buildLlmProvenance(payload: MorningInsightPayload): ProvenanceTag[] {
  const conf = payload.confidence.value;
  const tags: ProvenanceTag[] = [];
  const onelined = (path: string): ProvenanceTag => ({
    field_path: path,
    source: "llm_derived",
    confidence: conf,
  });
  if (payload.headline) tags.push(onelined("headline"));
  if (payload.summary_short) tags.push(onelined("summary_short"));
  if (payload.summary_long) tags.push(onelined("summary_long"));
  tags.push(onelined("training_recommendation.justification_de"));
  payload.day_shape.forEach((_, i) => tags.push(onelined(`day_shape[${i}]`)));
  payload.care_for.forEach((_, i) => tags.push(onelined(`care_for[${i}]`)));
  payload.levers.forEach((_, i) => tags.push(onelined(`levers[${i}]`)));
  tags.push({
    field_path: "confidence",
    source: "llm_derived",
    confidence: conf,
  });
  return tags;
}

export async function prose(
  pkg: PulseDataPackage<MorningInsightPayload>,
  ctx: ProseContext,
): Promise<PulseDataPackage<MorningInsightPayload>> {
  const periodKey = pkg.payload.period_key ?? pkg.key;
  const baseModel = config.model;

  // ── Abstain shortcut ─────────────────────────────────────────────────
  if (pkg.payload.abstain) {
    if (ctx.criticModel) {
      log.info("morning_insight", `abstain payload — skipping critic (${ctx.criticModel})`);
    }
    // Dual-write the legacy file so any non-cluster reader sees the
    // abstain notice. Best-effort: never fail the cell on a write
    // hiccup, the JobCell row is the source of truth.
    try {
      await writeMorningInsightJson(pkg.payload, periodKey, config.insightsRoot);
    } catch (err) {
      log.warn("morning_insight", `dual-write abstain ${periodKey}: ${(err as Error).message}`);
    }
    return {
      ...pkg,
      payload: { ...pkg.payload, model: baseModel },
      generated_at: new Date().toISOString(),
    };
  }

  // ── LLM call ─────────────────────────────────────────────────────────
  // Re-load the morning package — the live-watch pipeline rewrites
  // _facts.json on every chokidar tick, and the sibling cluster
  // insights (sleep / recovery) may have landed in the gap between
  // extract and prose. Cheap I/O, fresher inputs.
  const morningPackage = await loadMorningPackage(periodKey);

  if (ctx.criticModel) {
    log.info(
      "morning_insight",
      `critic enabled (${ctx.criticModel}) — Phase 4 wiring pending, running base only`,
    );
  }

  const run = await runUseCase({
    model: baseModel,
    systemPrompt: MORNING_SYSTEM_PROMPT,
    userPrompt: buildMorningUserPrompt(morningPackage),
    schema: morningInsightSchema,
    pkg: morningPackage,
    manifest: MORNING_MANIFEST,
    tag: "morning_insight",
    // Same constraint as the v3-orchestrator's morning cluster: Ollama's
    // grammar engine rejects the nullable-nested-object shape on
    // qwen3.6, so we fall back to `format: "json"` and let Ajv
    // post-validate. See v3-orchestrator CLUSTER_CONFIG.morning.
    formatMode: "json",
  });

  if (!run.ok || !run.insight || typeof run.insight !== "object") {
    // Best-effort: dual-write the (possibly partial) insight so the file
    // reader has something to show. Don't flip the cell to a degraded
    // payload — we throw and the worker calls release(...error), which
    // preserves the cached row from any prior successful run.
    if (run.insight && typeof run.insight === "object") {
      const degraded = {
        ...pkg.payload,
        ...(run.insight as Record<string, unknown>),
        incomplete: true,
        period_key: undefined,
        model: undefined,
      } as MorningInsightPayload;
      try {
        await writeMorningInsightJson(degraded, periodKey, config.insightsRoot);
      } catch (err) {
        log.warn(
          "morning_insight",
          `dual-write degraded ${periodKey}: ${(err as Error).message}`,
        );
      }
    }
    throw new Error(
      `morning_insight.prose: LLM call failed for ${periodKey}: ${run.errors.slice(-1).join("|") || "unknown"}`,
    );
  }

  const llmRaw = run.insight as Record<string, unknown>;
  // Belt-and-braces schema check — runUseCase already ran Ajv against
  // the schema in `format: "json"` mode, but a future refactor could
  // disable that. Re-validate here so the dual-write always sees a
  // well-formed legacy file.
  if (!validateLegacyShape({ ...llmRaw, incomplete: false })) {
    log.warn(
      "morning_insight",
      `legacy-schema secondary check failed: ${ajv.errorsText(validateLegacyShape.errors)}`,
    );
  }

  const modelTag = ctx.criticModel ? `${baseModel}+${ctx.criticModel}` : baseModel;
  const merged = mergeLlmInsight(pkg.payload, llmRaw, periodKey, modelTag);
  const llmProvenance = buildLlmProvenance(merged);

  // Dual-write. Failure is non-fatal: the JobCell row is the source of
  // truth, the file is for transitional readers only.
  try {
    await writeMorningInsightJson(merged, periodKey, config.insightsRoot);
  } catch (err) {
    log.warn("morning_insight", `dual-write ${periodKey}: ${(err as Error).message}`);
  }

  return {
    ...pkg,
    payload: merged,
    provenance: [...pkg.provenance, ...llmProvenance],
    generated_at: new Date().toISOString(),
  };
}
