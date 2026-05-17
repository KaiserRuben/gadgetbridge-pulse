/**
 * Synthesis stage (v3).
 *
 * Builds the synthesis package from the 3 use-case insights + deterministic
 * day_score + verdict_band + domain KPI summary, then calls the synthesis
 * LLM via the generic use-case runner.
 */

import type { DayScoreResult } from "./day-score.ts";
import { runUseCase, SYNTHESIS_MANIFEST } from "./runner.ts";
import { SYNTHESIS_SYSTEM_PROMPT, buildSynthesisUserPrompt } from "./prompts/synthesis.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNTHESIS_SCHEMA = JSON.parse(
  readFileSync(path.resolve(__dirname, "schemas/synthesis_insight.schema.json"), "utf8"),
) as object;

export interface UseCaseInsight {
  domain: "sleep" | "recovery" | "activity";
  insight: unknown;
  ok: boolean;
}

export interface SynthesisPackageInputs {
  periodKey: string;
  tz: string;
  dayOfWeek: string;
  isWeekend: boolean;
  sleep: UseCaseInsight;
  recovery: UseCaseInsight;
  activity: UseCaseInsight;
  dayScore: DayScoreResult;
}

export interface SynthesisPackage {
  meta: {
    today_date: string;
    generated_at: string;
    tz: string;
    day_of_week: string;
    is_weekend: boolean;
    package_version: "synthesis_package/v1";
  };
  sleep_insight: unknown;
  recovery_insight: unknown;
  activity_insight: unknown;
  day_score_deterministic: number;
  verdict_band_deterministic: "above_usual" | "steady" | "below_usual";
  domain_kpi_summary: {
    sleep: KpiLite[];
    recovery: KpiLite[];
    activity: KpiLite[];
  };
  context: {
    conflicts_detected: boolean;
    missing_use_cases: string[];
  };
}

interface KpiLite {
  id: string;
  label_de: string;
  value: number;
  band: string;
}

export function buildSynthesisPackage(inputs: SynthesisPackageInputs): SynthesisPackage {
  const sleepKpis = extractKpis(inputs.sleep);
  const recoveryKpis = extractKpis(inputs.recovery);
  const activityKpis = extractKpis(inputs.activity);

  const missing: string[] = [];
  if (!inputs.sleep.ok) missing.push("sleep");
  if (!inputs.recovery.ok) missing.push("recovery");
  if (!inputs.activity.ok) missing.push("activity");

  const conflicts = detectSuggestionConflicts(inputs);

  return {
    meta: {
      today_date: inputs.periodKey,
      generated_at: new Date().toISOString(),
      tz: inputs.tz,
      day_of_week: inputs.dayOfWeek,
      is_weekend: inputs.isWeekend,
      package_version: "synthesis_package/v1",
    },
    sleep_insight: inputs.sleep.insight,
    recovery_insight: inputs.recovery.insight,
    activity_insight: inputs.activity.insight,
    day_score_deterministic: inputs.dayScore.value,
    verdict_band_deterministic: inputs.dayScore.band,
    domain_kpi_summary: {
      sleep: sleepKpis,
      recovery: recoveryKpis,
      activity: activityKpis,
    },
    context: {
      conflicts_detected: conflicts,
      missing_use_cases: missing,
    },
  };
}

function extractKpis(uc: UseCaseInsight): KpiLite[] {
  // Accept any insight that has a kpis array — schema validation already ran.
  // Don't gate on uc.ok: grounding-failure leaves valid kpi structure intact.
  if (!uc.insight || typeof uc.insight !== "object") return [];
  const insight = uc.insight as { kpis?: Array<{ id: string; label_de: string; value: number; band: string }> };
  if (!Array.isArray(insight.kpis)) return [];
  return insight.kpis.slice(0, 3).map((k) => ({
    id: k.id,
    label_de: k.label_de,
    value: k.value,
    band: k.band,
  }));
}

function detectSuggestionConflicts(inputs: SynthesisPackageInputs): boolean {
  // Heuristic: any two domains both having `tonight` suggestions with very
  // different verbs (rest vs train) is a conflict signal. Cheap proxy:
  // count tonight-horizon suggestions across domains.
  let tonightCount = 0;
  for (const uc of [inputs.sleep, inputs.recovery, inputs.activity]) {
    if (!uc.ok || !uc.insight) continue;
    const insight = uc.insight as { suggestions_today?: Array<{ horizon: string }> };
    const tonight = (insight.suggestions_today ?? []).filter((s) => s.horizon === "tonight");
    if (tonight.length > 0) tonightCount++;
  }
  return tonightCount >= 2;
}

export async function runSynthesis(pkg: SynthesisPackage, model?: string) {
  return runUseCase({
    model,
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    userPrompt: buildSynthesisUserPrompt(pkg),
    schema: SYNTHESIS_SCHEMA,
    pkg,
    manifest: SYNTHESIS_MANIFEST,
    tag: "synthesis",
  });
}
