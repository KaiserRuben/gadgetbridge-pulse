/**
 * Smoke test for Phase 3 stage5b_patterns.
 *
 * Sequential GPU-friendly:
 *   1. computeSurpriseCandidates(2026-05-08)            — deterministic, no LLM
 *   2. frameSurpriseInsight() x 2                       — sequential Ollama
 *   3. detectPatterns(30 days)                          — deterministic, no LLM
 *   4. namePattern(top cluster) x 1                     — sequential Ollama
 *   5. upsertPattern() + readPatterns()                 — DB roundtrip
 *
 * Run: `npx tsx runner/src/test/probe-patterns-smoke.ts [period_key]`
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.ts";
import {
  computeSurpriseCandidates,
  frameSurpriseInsight,
} from "../analyzer/surprise-ranking.ts";
import { detectPatterns } from "../analyzer/pattern-detection.ts";
import { namePattern } from "../analyzer/pattern-naming.ts";
import { readPatterns, upsertPattern } from "../analyzer/pattern-library.ts";

async function main(): Promise<void> {
  const periodKey = process.argv[2] ?? "2026-05-08";

  // ── Step 1: surprise candidates (deterministic) ────────────────────────
  console.log(`\n=== STEP 1: computeSurpriseCandidates(${periodKey}) ===`);
  const t1 = Date.now();
  const candidates = await computeSurpriseCandidates(
    periodKey,
    config.insightsRoot,
    5,
  );
  const dt1 = Date.now() - t1;
  console.log(`  found ${candidates.length} candidate(s) in ${dt1} ms`);
  for (const c of candidates) {
    console.log(
      `    - ${c.metric.padEnd(22)} z=${c.z_score.toFixed(2).padStart(7)} ` +
        `today=${c.today_value} mean=${c.baseline_mean.toFixed(2)} std=${c.baseline_std.toFixed(2)} ` +
        `n=${c.n_baseline}${c.fragile ? " (fragile)" : ""} → ${c.surprise_label}`,
    );
  }

  // ── Step 2: frame top-2 candidates via LLM (sequential) ────────────────
  console.log(`\n=== STEP 2: frameSurpriseInsight x ${Math.min(2, candidates.length)} ===`);
  const top2 = candidates.slice(0, 2);
  for (const c of top2) {
    const t = Date.now();
    try {
      const framed = await frameSurpriseInsight(c, {
        ollamaUrl: config.ollamaUrl,
        periodKey,
      });
      const dt = Date.now() - t;
      console.log(`  ${c.metric}: ${(dt / 1000).toFixed(2)} s`);
      console.log(`    headline_de: ${framed.headline_de}`);
      console.log(`    reason_de:   ${framed.reason_de}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${c.metric}: failed — ${msg}`);
    }
  }

  // ── Step 3: detect pattern clusters (deterministic) ────────────────────
  console.log(`\n=== STEP 3: detectPatterns(30 days) ===`);
  const t3 = Date.now();
  const clusters = await detectPatterns(config.insightsRoot, periodKey, 30);
  const dt3 = Date.now() - t3;
  console.log(`  found ${clusters.length} cluster(s) in ${dt3} ms`);
  for (const c of clusters) {
    console.log(
      `    - ${c.signature_id} n=${c.occurrence_count} ` +
        `[${c.first_seen}..${c.last_seen}] flags=${c.salient_flags.join(", ")}`,
    );
  }

  // ── Step 4: name top cluster via LLM ───────────────────────────────────
  if (clusters.length > 0) {
    console.log(`\n=== STEP 4: namePattern(top cluster) ===`);
    const top = clusters[0];
    const exampleDates = top.member_dates.slice(-3);
    const exampleDays: object[] = [];
    for (const d of exampleDates) {
      try {
        const txt = await readFile(
          path.join(config.insightsRoot, "daily", d, "_facts.json"),
          "utf8",
        );
        exampleDays.push(JSON.parse(txt) as object);
      } catch {
        /* skip */
      }
    }
    const t4 = Date.now();
    try {
      const named = await namePattern(top, exampleDays, {
        ollamaUrl: config.ollamaUrl,
      });
      const dt4 = Date.now() - t4;
      console.log(`  ${top.signature_id}: ${(dt4 / 1000).toFixed(2)} s`);
      console.log(`    name_de:        ${named.name_de}`);
      console.log(`    description_de: ${named.description_de}`);

      // ── Step 5: upsert + readback ────────────────────────────────────
      console.log(`\n=== STEP 5: upsertPattern() + readPatterns() ===`);
      const upserted = await upsertPattern({
        id: named.signature_id,
        name_de: named.name_de,
        description_de: named.description_de,
        signature_json: JSON.stringify({
          centroid: named.centroid,
          salient_flags: named.salient_flags,
          member_dates: named.member_dates,
        }),
        first_seen: named.first_seen,
        last_seen: named.last_seen,
      });
      if (!upserted) {
        console.error("  upsert failed (Pi unreachable)");
      } else {
        console.log(
          `  upsert ok: id=${upserted.id} occ=${upserted.occurrence_count}`,
        );
      }
      const all = await readPatterns(10);
      console.log(`  PULSE_PATTERN_LIBRARY rows: ${all.length}`);
      for (const r of all) {
        console.log(
          `    - ${r.id} ${r.occurrence_count}× "${r.name_de}" (${r.last_seen})`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  naming failed: ${msg}`);
    }
  } else {
    console.log(`\n=== STEPS 4 & 5: skipped (no clusters) ===`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[probe] failed:", err);
  process.exit(1);
});
