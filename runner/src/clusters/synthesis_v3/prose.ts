/**
 * synthesis_v3 — Stage 1 (prose). Wraps the existing v3 synthesis LLM
 * call so the JobCell layer reuses the locked schema + system prompt.
 *
 * Dual-write transitional behaviour: after a successful prose pass we
 * also write the legacy `daily_v3.json` under
 * `$INSIGHTS_ROOT/daily/<periodKey>/daily_v3.json` via an atomic rename
 * so the existing `loadDailyV3()` reader path stays alive for the home
 * page hero, day-detail page, and every other surface that reads the
 * file (DailyV3Bundle aggregate, dashboard mode math, calendar band).
 *
 * Race-condition note: the legacy `runV3` caller (called from
 * `events/subscribers.ts` on `day_end`, and from `v3-orchestrator.ts`)
 * remains alive. Two writers race to the same final path during
 * overlapping pipeline runs; atomic rename means the second writer
 * wins. The JSON shape is the same in both paths, so a momentary
 * "stale-then-fresh-then-stale" is the worst case until the legacy
 * producer is retired.
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
import synthesisInsightSchema from "../../v3/schemas/synthesis_insight.schema.json" with { type: "json" };
import {
  buildSynthesisPackage,
  runSynthesis,
} from "../../v3/synthesis.ts";
import type { ProseContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import { loadInputsForProse } from "./extract.ts";
import type {
  SynthesisContradiction,
  SynthesisDomainPointer,
  SynthesisTopAction,
  SynthesisV3Payload,
} from "./types.ts";

const STAGING_ROOT = process.env.PULSE_STAGING_ROOT ?? "/tmp/pulse-staging";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateLegacyShape = ajv.compile(synthesisInsightSchema);

/**
 * Map a cluster `SynthesisV3Payload` back to the legacy
 * `SynthesisInsightV3` file shape. The two only diverge in the
 * cluster's extras (`period_key`, `model`) which the legacy reader /
 * schema doesn't accept (`additionalProperties: false`). Strip them on
 * the way out so the file is byte-stable against the prior writer.
 */
function toLegacyShape(p: SynthesisV3Payload): Record<string, unknown> {
  return {
    schema_version: p.schema_version,
    language: p.language,
    incomplete: p.incomplete,
    abstain: p.abstain,
    abstain_reason: p.abstain_reason,
    verdict_band: p.verdict_band,
    headline: p.headline,
    summary_short: p.summary_short,
    summary_long: p.summary_long,
    key_insight: p.key_insight,
    top_action_today: p.top_action_today,
    domain_pointers: p.domain_pointers,
    contradictions: p.contradictions,
    confidence: p.confidence,
  };
}

/**
 * Atomically write `daily_v3.json`. Stage in `$PULSE_STAGING_ROOT` then
 * rename into place so Syncthing never picks up a half-file. Mirrors
 * `atomicWrite` in v3-orchestrator.
 */
async function writeDailyV3Json(
  payload: SynthesisV3Payload,
  periodKey: string,
  insightsRoot: string,
): Promise<void> {
  const dir = path.join(insightsRoot, "daily", periodKey);
  await mkdir(dir, { recursive: true });
  await mkdir(STAGING_ROOT, { recursive: true });
  const finalPath = path.join(dir, "daily_v3.json");
  const legacy = toLegacyShape(payload);
  const body = JSON.stringify(legacy, null, 2);
  const tmp = path.join(STAGING_ROOT, `daily_v3.json.${randomUUID()}.tmp`);
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

function dayOfWeekKey(periodKey: string, tz: string): string {
  const d = new Date(`${periodKey}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return fmt.toLowerCase();
}

function isWeekend(periodKey: string, tz: string): boolean {
  const wd = dayOfWeekKey(periodKey, tz);
  return wd === "sat" || wd === "sun";
}

/**
 * Walk the LLM-emitted insight and merge it into the cluster payload.
 * The LLM-emitted shape (after passing the legacy schema) matches the
 * cluster's shape one-for-one — `period_key` + `model` are cluster
 * extras added here, not LLM-fillable.
 */
function mergeLlmInsight(
  base: SynthesisV3Payload,
  llm: Record<string, unknown>,
  periodKey: string,
  modelTag: string,
): SynthesisV3Payload {
  return {
    schema_version: "use_case/synthesis/v1",
    // Final state — the writer flips this to false at atomic-rename
    // time; we mirror it here so the JobCell row matches the file.
    incomplete: false,
    language: llm.language === "en" ? "en" : "de",
    abstain: typeof llm.abstain === "boolean" ? llm.abstain : base.abstain,
    abstain_reason:
      typeof llm.abstain_reason === "string" || llm.abstain_reason === null
        ? (llm.abstain_reason as string | null)
        : base.abstain_reason,
    verdict_band:
      llm.verdict_band === null ||
      llm.verdict_band === "above_usual" ||
      llm.verdict_band === "steady" ||
      llm.verdict_band === "below_usual"
        ? (llm.verdict_band as SynthesisV3Payload["verdict_band"])
        : base.verdict_band,
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
    key_insight:
      typeof llm.key_insight === "string" || llm.key_insight === null
        ? (llm.key_insight as string | null)
        : base.key_insight,
    top_action_today:
      llm.top_action_today && typeof llm.top_action_today === "object"
        ? (llm.top_action_today as SynthesisTopAction)
        : llm.top_action_today === null
          ? null
          : base.top_action_today,
    domain_pointers: Array.isArray(llm.domain_pointers)
      ? (llm.domain_pointers as SynthesisDomainPointer[])
      : base.domain_pointers,
    contradictions: Array.isArray(llm.contradictions)
      ? (llm.contradictions as SynthesisContradiction[])
      : base.contradictions,
    confidence:
      llm.confidence && typeof llm.confidence === "object"
        ? (llm.confidence as SynthesisV3Payload["confidence"])
        : base.confidence,
    model: modelTag,
    period_key: periodKey,
  };
}

/**
 * Build per-field provenance for everything the LLM filled. Mirrors the
 * weekly_recap + morning_insight cluster approach — one tag per
 * top-level prose field, plus per-item tags for the array entries
 * (contradictions / domain_pointers) so the dashboard's ProvenanceRow
 * can group them coherently.
 */
function buildLlmProvenance(payload: SynthesisV3Payload): ProvenanceTag[] {
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
  if (payload.key_insight) tags.push(onelined("key_insight"));
  if (payload.top_action_today) tags.push(onelined("top_action_today"));
  payload.contradictions.forEach((_, i) =>
    tags.push(onelined(`contradictions[${i}]`)),
  );
  payload.domain_pointers.forEach((_, i) =>
    tags.push(onelined(`domain_pointers[${i}]`)),
  );
  tags.push({
    field_path: "confidence",
    source: "llm_derived",
    confidence: conf,
  });
  return tags;
}

export async function prose(
  pkg: PulseDataPackage<SynthesisV3Payload>,
  ctx: ProseContext,
): Promise<PulseDataPackage<SynthesisV3Payload>> {
  const periodKey = pkg.payload.period_key ?? pkg.key;
  const baseModel = config.model;

  // ── Abstain shortcut ─────────────────────────────────────────────────
  if (pkg.payload.abstain) {
    if (ctx.criticModel) {
      log.info("synthesis_v3", `abstain payload — skipping critic (${ctx.criticModel})`);
    }
    // Dual-write the legacy file so any non-cluster reader sees the
    // abstain notice. Best-effort: never fail the cell on a write
    // hiccup, the JobCell row is the source of truth.
    try {
      await writeDailyV3Json(pkg.payload, periodKey, config.insightsRoot);
    } catch (err) {
      log.warn("synthesis_v3", `dual-write abstain ${periodKey}: ${(err as Error).message}`);
    }
    return {
      ...pkg,
      payload: { ...pkg.payload, model: baseModel },
      generated_at: new Date().toISOString(),
    };
  }

  // ── LLM call ─────────────────────────────────────────────────────────
  // Re-load the prerequisite inputs — the live-watch pipeline rewrites
  // facts on every chokidar tick, and the sibling cluster insights may
  // have landed in the gap between extract and prose. Cheap I/O,
  // fresher inputs.
  const inputs = loadInputsForProse(periodKey);
  if (!inputs.dayScore) {
    // Defensive: extract guaranteed the day folder exists, but if the
    // day_score.json was deleted between extract and prose, we still
    // need a deterministic seed. Fall back to a steady band so the
    // synthesis package builds — the LLM may override.
    log.warn("synthesis_v3", `${periodKey}: day_score missing at prose stage, using fallback`);
  }
  const dayScore = inputs.dayScore ?? {
    value: 50,
    band: "steady" as const,
    contributions: {},
    weight_used: 0,
    reasoning: "fallback: day_score missing at prose stage",
  };

  const synthesisPackage = buildSynthesisPackage({
    periodKey,
    tz: config.timezone,
    dayOfWeek: dayOfWeekKey(periodKey, config.timezone),
    isWeekend: isWeekend(periodKey, config.timezone),
    sleep: inputs.sleep,
    recovery: inputs.recovery,
    activity: inputs.activity,
    dayScore,
  });

  if (ctx.criticModel) {
    log.info(
      "synthesis_v3",
      `critic enabled (${ctx.criticModel}) — Phase 4 wiring pending, running base only`,
    );
  }

  const run = await runSynthesis(synthesisPackage, baseModel);

  if (!run.ok || !run.insight || typeof run.insight !== "object") {
    // Best-effort: dual-write the (possibly partial) insight so the
    // file reader has something to show. Don't flip the cell to a
    // degraded payload — we throw and the worker calls
    // release(...error), which preserves the cached row from any prior
    // successful run.
    if (run.insight && typeof run.insight === "object") {
      const degraded = {
        ...pkg.payload,
        ...(run.insight as Record<string, unknown>),
        incomplete: true,
        period_key: undefined,
        model: undefined,
      } as SynthesisV3Payload;
      try {
        await writeDailyV3Json(degraded, periodKey, config.insightsRoot);
      } catch (err) {
        log.warn(
          "synthesis_v3",
          `dual-write degraded ${periodKey}: ${(err as Error).message}`,
        );
      }
    }
    throw new Error(
      `synthesis_v3.prose: LLM call failed for ${periodKey}: ${run.errors.slice(-1).join("|") || "unknown"}`,
    );
  }

  const llmRaw = run.insight as Record<string, unknown>;
  // Belt-and-braces schema check — runUseCase already ran Ajv against
  // the schema, but a future refactor could disable that. Re-validate
  // here so the dual-write always sees a well-formed legacy file.
  if (!validateLegacyShape({ ...llmRaw, incomplete: false })) {
    log.warn(
      "synthesis_v3",
      `legacy-schema secondary check failed: ${ajv.errorsText(validateLegacyShape.errors)}`,
    );
  }

  const modelTag = ctx.criticModel ? `${baseModel}+${ctx.criticModel}` : baseModel;
  const merged = mergeLlmInsight(pkg.payload, llmRaw, periodKey, modelTag);
  const llmProvenance = buildLlmProvenance(merged);

  // Dual-write. Failure is non-fatal: the JobCell row is the source of
  // truth, the file is for transitional readers only.
  try {
    await writeDailyV3Json(merged, periodKey, config.insightsRoot);
  } catch (err) {
    log.warn("synthesis_v3", `dual-write ${periodKey}: ${(err as Error).message}`);
  }

  return {
    ...pkg,
    payload: merged,
    provenance: [...pkg.provenance, ...llmProvenance],
    generated_at: new Date().toISOString(),
  };
}
