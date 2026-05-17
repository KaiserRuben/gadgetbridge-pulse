/**
 * Smoke test for the Phase 3 anomaly-explanation pipeline.
 *
 * Calls explainAnomaly() directly (skips the route handler) for the
 * 2026-05-07 rhr_tachycardia_safety observation. Loads the 7 prior
 * _facts.json files from disk, posts to Ollama, runs the validator, prints
 * latency + counts.
 *
 * Run: `npx tsx runner/src/test/probe-explain-anomaly.ts [period_key] [observation_id]`
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.ts";
import { explainAnomaly, type AnomalyExplanationInput } from "../analyzer/anomaly-explanation.ts";
import { validateExplanation } from "../analyzer/anomaly-validator.ts";

interface DailyDriverShape {
  metric_id: string;
  clause: string;
  delta_text: string;
  evidence_ids: string[];
}

interface DailyShape {
  drivers?: DailyDriverShape[];
}

function priorDates(periodKey: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${periodKey}T00:00:00Z`);
  for (let i = 1; i <= n; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const periodKey = process.argv[2] ?? "2026-05-07";
  const observationId = process.argv[3] ?? "rhr_tachycardia_safety";

  const dailyPath = path.join(config.insightsRoot, "daily", periodKey, "daily.json");
  const daily = await readJsonOrNull<DailyShape>(dailyPath);
  if (!daily) {
    console.error(`[probe] daily.json not found at ${dailyPath}`);
    process.exit(2);
  }

  const driver = daily.drivers?.find((d) => d.evidence_ids?.includes(observationId));
  const observationText = driver
    ? `${driver.clause} (${driver.delta_text})`
    : `Anomalie ${observationId}`;

  // Load 7 days of _facts.json (today + 6 prior). Skip missing.
  const dates = [periodKey, ...priorDates(periodKey, 6)];
  const contextFacts: object[] = [];
  for (const d of dates) {
    const fp = path.join(config.insightsRoot, "daily", d, "_facts.json");
    const facts = await readJsonOrNull<object>(fp);
    if (facts) contextFacts.push(facts);
  }
  console.log(
    `[probe] loaded ${contextFacts.length}/7 _facts.json files for window ending ${periodKey}`,
  );

  const input: AnomalyExplanationInput = {
    observation_id: observationId,
    period_key: periodKey,
    observation_text: observationText,
    context_facts: contextFacts,
  };

  console.log(`[probe] observation_text: ${observationText}`);
  console.log(`[probe] calling Ollama at ${config.ollamaUrl} (model qwen3.6:latest)...`);
  const t0 = Date.now();
  const explanation = await explainAnomaly(input);
  const latency = Date.now() - t0;

  console.log(`[probe] latency: ${(latency / 1000).toFixed(2)} s`);
  console.log(`[probe] hypothesis count: ${explanation.hypotheses.length}`);
  for (const h of explanation.hypotheses) {
    console.log(`[probe]   - ${h.strength.padEnd(8)} ${h.factor}: ${h.rationale}`);
  }

  const validation = validateExplanation(explanation, input);
  console.log(`[probe] validator ok=${validation.ok} warnings=${validation.warnings.length}`);
  for (const w of validation.warnings) {
    console.log(`[probe]   warning: ${w}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[probe] failed:", err);
  process.exit(1);
});
