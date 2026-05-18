/**
 * morning_insight — Stage 0 (extract). Deterministic, no LLM.
 *
 * Builds the v3 morning package (last night + this morning + plan + pain
 * history + lever math) via the existing `buildMorningPackage` and decides
 * whether the day is ready for the morning briefing or whether we abstain.
 *
 * Abstain rules (mirror the legacy prompt's data_quality fallbacks):
 *   - no `_facts.json` AND no `sleep_insight.json` → "no_sleep"
 *   - no plan AND no recent session AND no facts → "no_signal"
 * Anything else flows through to prose where the LLM fills the briefing.
 *
 * Cell-key convention: `morning_insight.key === period_key` (wake-date,
 * YYYY-MM-DD). Round-trips via `parseMorningInputFromKey`.
 *
 * Auto-process: OFF by default. The legacy `runV3Cluster("morning", …)`
 * caller fires on every `sleep_complete` (and on `day_end` as part of
 * `runV3`), so a silent-morning isn't possible during the dual-write
 * window. Flip `settings:auto_process:morning_insight` to ON for the
 * cluster to auto-recompute when sleep lands.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { config } from "../../config.ts";
import { db as openDb } from "../../db.ts";
import { buildMorningPackage, type MorningPackage } from "../../v3/packagers/morning.ts";
import type { ClusterContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import type {
  MorningExtractInput,
  MorningInsightPayload,
} from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-trip helper used by the worker — a cell key alone is enough to
 * reconstruct the extract input because `morning_insight.key === period_key`.
 */
export function parseMorningInputFromKey(key: string): MorningExtractInput | null {
  if (!DATE_RE.test(key)) return null;
  return { period_key: key };
}

/**
 * Cluster-only sidecar: prose() needs the same morning-package the
 * extract built (LLM call works off it). Stuffing the entire package
 * into the JobCell payload would balloon row size + duplicate state
 * already on disk under `morning_package.json`, so we reload via the
 * legacy packager. Cheap (file-cached) + always fresh.
 */
export async function loadMorningPackage(periodKey: string): Promise<MorningPackage> {
  const tz = config.timezone;
  let db: ReturnType<typeof openDb> | null = null;
  try {
    db = openDb();
  } catch {
    db = null;
  }
  return buildMorningPackage({
    periodKey,
    db,
    insightsRoot: config.insightsRoot,
    tz,
  });
}

interface AbstainCheck {
  abstain: boolean;
  reason: string | null;
}

function decideAbstain(pkg: MorningPackage): AbstainCheck {
  const dq = pkg.data_quality;
  if (!dq.has_last_night_sleep && !dq.has_recovery_today) {
    return { abstain: true, reason: "no_sleep" };
  }
  if (!dq.has_plan && dq.sessions_in_window === 0 && !dq.has_last_night_sleep) {
    return { abstain: true, reason: "no_signal" };
  }
  return { abstain: false, reason: null };
}

function buildAbstainPayload(periodKey: string, reason: string): MorningInsightPayload {
  return {
    schema_version: "use_case/morning/v1",
    // Cluster row carries `incomplete: false` for an abstain payload —
    // the dual-write to disk also sets it false because the abstain is
    // the final state, no LLM regen will land. Matches the legacy
    // writer's behaviour for abstain shortcuts.
    incomplete: false,
    language: "de",
    abstain: true,
    abstain_reason: reason,
    headline: null,
    summary_short: null,
    summary_long: null,
    verdict_band: null,
    training_recommendation: {
      reasoning: "",
      suggested_session_template_id: null,
      justification_de: null,
      alternatives: [],
    },
    day_shape: [],
    care_for: [],
    levers: [],
    citations: [],
    confidence: {
      value: 0,
      reasoning: `Abstain: ${reason}. Daten zu dünn für eine belastbare Morgen-Empfehlung.`,
    },
    period_key: periodKey,
  };
}

function buildSeedPayload(periodKey: string, pkg: MorningPackage): MorningInsightPayload {
  // Verdict band is deterministic (`deriveVerdictBand` in the legacy
  // packager) and pinned by the locked prompt. Seed it here so the
  // schema stays valid even before the LLM runs — prose copies it
  // verbatim (the prompt has a hard "VERDICT-LOCK" rule).
  return {
    schema_version: "use_case/morning/v1",
    // Cluster seed is in-flight; the writer flips to false at atomic-
    // rename time after the LLM lands.
    incomplete: true,
    language: "de",
    abstain: false,
    abstain_reason: null,
    headline: null,
    summary_short: null,
    summary_long: null,
    verdict_band: pkg.verdict_band,
    training_recommendation: {
      reasoning: "",
      suggested_session_template_id: pkg.training.plan?.schedule_today ?? null,
      justification_de: null,
      alternatives: [],
    },
    day_shape: [],
    care_for: [],
    // Lever snapshots are deterministic — the morning prompt only adds
    // prose around them. Seed empty here; prose fills the full lever
    // card array. (We *could* seed the lever snapshots from `pkg.levers`
    // but the LLM rewrites them anyway, and we'd risk drift if the
    // morning's lever math ever diverges from the cluster row format.)
    levers: [],
    citations: [],
    confidence: {
      value: 0,
      reasoning: "",
    },
    period_key: periodKey,
  };
}

/**
 * Build the partial extract package. Deterministic, no LLM.
 *
 * The package builder pulls from `_facts.json`, sibling cluster
 * insights (sleep/recovery/activity) and pulse.db (plan, sessions,
 * pain). Anything missing simply lands as null/empty in `pkg` — the
 * abstain check + `data_quality` flags then decide whether to skip the
 * LLM call.
 */
export async function extract(
  ctx: ClusterContext,
  input: MorningExtractInput,
): Promise<PulseDataPackage<MorningInsightPayload>> {
  if (!input || !DATE_RE.test(input.period_key)) {
    throw new Error(
      `morning_insight.extract: invalid period_key '${input?.period_key ?? "(missing)"}'`,
    );
  }
  const periodKey = input.period_key;

  // The `_facts.json` write is gated on the live-watch pipeline running.
  // If the day folder is entirely empty we can't even produce a package;
  // surface as abstain immediately so the worker doesn't crash on the
  // builder's lever math.
  const factsPath = path.join(config.insightsRoot, "daily", periodKey, "_facts.json");
  if (!existsSync(factsPath)) {
    const payload = buildAbstainPayload(periodKey, "no_facts");
    const provenance: ProvenanceTag[] = [
      { field_path: "abstain", source: "rule_computed" },
    ];
    return {
      cluster: "morning_insight",
      key: periodKey,
      scope: "daily",
      generated_at: new Date().toISOString(),
      payload,
      provenance,
      deps: [],
      package_version: 1,
    };
  }

  const pkg = await loadMorningPackage(periodKey);
  const { abstain, reason } = decideAbstain(pkg);

  if (abstain && reason) {
    const payload = buildAbstainPayload(periodKey, reason);
    const provenance: ProvenanceTag[] = [
      { field_path: "abstain", source: "rule_computed" },
    ];
    return {
      cluster: "morning_insight",
      key: periodKey,
      scope: "daily",
      generated_at: new Date().toISOString(),
      payload,
      provenance,
      deps: [],
      package_version: 1,
    };
  }

  const payload = buildSeedPayload(periodKey, pkg);

  // Provenance for the deterministic fields. The verdict_band is
  // computed in `deriveVerdictBand` (rule_computed); the training
  // recommendation's `suggested_session_template_id` is the literal
  // plan schedule slot for today (rule_computed, sourced from the
  // PULSE_TRAINING_PLAN row).
  const provenance: ProvenanceTag[] = [
    { field_path: "period_key", source: "rule_computed" },
    { field_path: "verdict_band", source: "rule_computed" },
  ];
  if (payload.training_recommendation.suggested_session_template_id) {
    provenance.push({
      field_path: "training_recommendation.suggested_session_template_id",
      source: "rule_computed",
    });
  }

  // ctx.periodKey carries the cell key (same as input.period_key).
  void ctx;

  return {
    cluster: "morning_insight",
    key: periodKey,
    scope: "daily",
    generated_at: new Date().toISOString(),
    payload,
    provenance,
    deps: [],
    package_version: 1,
  };
}
