/**
 * 3-shot drift test harness.
 *
 * Run a single domain prompt N times back-to-back against the same facts and
 * report variance across runs. Catches:
 *   - JSON shape regressions (one run validates, another doesn't)
 *   - Verdict drift (rating flips between runs)
 *   - Confidence calibration drift
 *   - Headline rewording extremes
 *
 * Usage:
 *   tsx src/test/drift.ts <domain> [shots=3]
 *
 * Examples:
 *   tsx src/test/drift.ts sleep 3
 *   tsx src/test/drift.ts coach 5
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildSnapshotFacts } from "../facts/snapshot.ts";
import { latestSnapshotDate } from "../period.ts";
import { runPrompt } from "../orchestrator.ts";
import { config } from "../config.ts";

import "../prompts/snapshot/sleep.ts";
import "../prompts/snapshot/cardio.ts";
import "../prompts/snapshot/activity.ts";
import "../prompts/snapshot/body.ts";
import "../prompts/snapshot/stress.ts";
import "../prompts/snapshot/anomalies.ts";
import "../prompts/snapshot/coach.ts";
import { SNAPSHOT_REGISTRY } from "../prompts/snapshot/registry.ts";

type ShotResult = {
  shot: number;
  ok: boolean;
  reason?: string;
  rating?: string;
  score?: number;
  confidence?: number;
  calc?: number;
  headline?: string;
  duration_ms?: number;
  attempts?: number;
};

async function main() {
  const domain = process.argv[2];
  const shots = Math.max(1, Math.min(10, Number(process.argv[3] ?? 3)));

  if (!domain) {
    console.error("usage: tsx src/test/drift.ts <domain> [shots=3]");
    process.exit(1);
  }
  const prompt = SNAPSHOT_REGISTRY[domain];
  if (!prompt) {
    console.error(
      `Unknown domain '${domain}'. Available: ${Object.keys(SNAPSHOT_REGISTRY).join(", ")}`,
    );
    process.exit(1);
  }

  const periodKey = latestSnapshotDate();
  const facts = buildSnapshotFacts(periodKey);
  console.log(`\n=== drift test · ${domain} · ${shots} shots · period ${periodKey} ===\n`);

  const driftDir = path.join(config.insightsRoot, "snapshot", periodKey, "_drift");
  mkdirSync(driftDir, { recursive: true });

  const results: ShotResult[] = [];

  for (let i = 1; i <= shots; i++) {
    console.log(`\n--- shot ${i}/${shots} ---`);
    const t0 = Date.now();
    const res = await runPrompt(prompt, facts);
    const dur = Date.now() - t0;
    if (!res.ok) {
      results.push({ shot: i, ok: false, reason: res.reason, duration_ms: dur });
      continue;
    }
    const o = res.output as Record<string, unknown>;
    const v = (o.verdict ?? {}) as { rating?: string; score_0_100?: number; headline?: string };
    const c = (o.confidence ?? {}) as { value?: number; calc?: number };
    results.push({
      shot: i,
      ok: true,
      rating: v.rating,
      score: v.score_0_100,
      confidence: c.value,
      calc: c.calc,
      headline: v.headline,
      duration_ms: dur,
    });
    // Save the shot's output for diffability
    writeFileSync(
      path.join(driftDir, `${domain}.shot-${i}.json`),
      JSON.stringify(o, null, 2),
    );
  }

  // ── analysis ──
  const okShots = results.filter((r) => r.ok);
  const ratings = new Set(okShots.map((r) => r.rating));
  const scores = okShots.map((r) => r.score ?? 0);
  const confs = okShots.map((r) => r.confidence ?? 0);
  const headlines = new Set(okShots.map((r) => r.headline));

  const stat = (xs: number[]) => {
    if (xs.length === 0) return { min: 0, max: 0, mean: 0, range: 0 };
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { min, max, mean: +mean.toFixed(3), range: +(max - min).toFixed(3) };
  };

  const summary = {
    domain,
    period: periodKey,
    shots,
    pass_rate: `${okShots.length}/${shots}`,
    rating_unique: ratings.size,
    rating_set: [...ratings],
    score: stat(scores),
    confidence: stat(confs),
    headline_unique: headlines.size,
    durations_ms: results.map((r) => r.duration_ms ?? 0),
    results,
  };

  writeFileSync(
    path.join(driftDir, `${domain}.summary.json`),
    JSON.stringify(summary, null, 2),
  );

  console.log("\n=== summary ===");
  console.log(`pass rate: ${summary.pass_rate}`);
  console.log(`rating drift: ${summary.rating_unique} unique → ${summary.rating_set.join(", ")}`);
  console.log(
    `score: mean ${summary.score.mean} · range ${summary.score.range} (min ${summary.score.min}, max ${summary.score.max})`,
  );
  console.log(
    `confidence: mean ${summary.confidence.mean} · range ${summary.confidence.range}`,
  );
  console.log(`headline variants: ${summary.headline_unique}`);
  console.log(`durations: ${summary.durations_ms.map((d) => Math.round(d / 1000) + "s").join(", ")}`);

  // Drift verdict
  const driftWarn: string[] = [];
  if (summary.rating_unique > 1) driftWarn.push("RATING DRIFT");
  if (summary.score.range > 15) driftWarn.push(`SCORE RANGE ${summary.score.range} > 15`);
  if (summary.confidence.range > 0.15) driftWarn.push(`CONFIDENCE RANGE ${summary.confidence.range} > 0.15`);
  if (okShots.length < shots) driftWarn.push(`PASS RATE ${okShots.length}/${shots}`);
  if (driftWarn.length === 0) {
    console.log("\n✓ no significant drift");
  } else {
    console.log("\n⚠ drift flags:", driftWarn.join(" · "));
  }

  console.log(`\nartifacts → ${driftDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
