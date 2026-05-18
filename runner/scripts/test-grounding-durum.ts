/**
 * Phase 2b end-to-end grounding probe — Dürüm photo.
 *
 * Not a unit test (CI has no GPU, no Ollama, no internet to USDA/OFF). Run
 * manually:
 *
 *   cd /Users/kaiser/Projects/deploy_local/pulse/runner
 *   npx tsx scripts/test-grounding-durum.ts
 *
 * The `--tools` flag enables the agentic tool-calling variant of Stage A.
 * The default is the prompt-only path (matches production behaviour with
 * NUTRITION_TOOLS_ENABLED unset). Run both back-to-back to A/B compare:
 *
 *   npx tsx scripts/test-grounding-durum.ts             # baseline
 *   npx tsx scripts/test-grounding-durum.ts --tools     # tool loop on
 *
 * Requires the meal photo at /tmp/pulse-shots/meal-1024.jpg. If missing:
 *
 *   curl http://192.168.178.254:3030/api/nutrition/photo/394559c3-6087-46fc-8bde-293f0e487f9f -o /tmp/pulse-shots/meal.jpg
 *   sips -Z 1024 /tmp/pulse-shots/meal.jpg --out /tmp/pulse-shots/meal-1024.jpg
 *
 * Acceptance:
 *   - ≥ 4 components (decomposition rule fires)
 *   - no single "Belegtes Brötchen" lump
 *   - each component carries a provenance trail
 *   - at least one component grounded via USDA or OFF
 *   - kcal total in 600–1000 (realistic Dürüm range)
 *
 * Prints a clear PASS / FAIL footer.
 */

import { existsSync } from "node:fs";

import { classifyMeal, type ClassifyImage } from "../src/nutrition/stages/classify-vlm.ts";
import { enrichComponents } from "../src/nutrition/stages/enrich.ts";
import { prepareImage } from "../src/nutrition/image-prep.ts";
import type { MealJob } from "../src/nutrition/types.ts";

const PHOTO_PATH = process.env.PROBE_PHOTO ?? "/tmp/pulse-shots/meal-1024.jpg";
const HINT = process.env.PROBE_HINT ?? "Dürüm, Hähnchen";

const USE_TOOLS = process.argv.includes("--tools");
// Apply the env flag before classify-vlm.ts decides which path to use.
// The module reads process.env at call time, so flipping it here at boot
// is safe.
if (USE_TOOLS) {
  process.env.NUTRITION_TOOLS_ENABLED = "1";
} else {
  delete process.env.NUTRITION_TOOLS_ENABLED;
}

function header(s: string) {
  // eslint-disable-next-line no-console
  console.log(`\n──────── ${s} ────────`);
}

function lineify(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

async function main(): Promise<void> {
  if (!existsSync(PHOTO_PATH)) {
    // eslint-disable-next-line no-console
    console.error(
      `[FAIL] photo not found at ${PHOTO_PATH}. ` +
        `Fetch it first:\n` +
        `  curl http://192.168.178.254:3030/api/nutrition/photo/394559c3-6087-46fc-8bde-293f0e487f9f -o /tmp/pulse-shots/meal.jpg\n` +
        `  sips -Z 1024 /tmp/pulse-shots/meal.jpg --out /tmp/pulse-shots/meal-1024.jpg`,
    );
    process.exit(2);
  }

  header(`prepare image — ${PHOTO_PATH}`);
  const prepared = await prepareImage(PHOTO_PATH, 1024);
  // eslint-disable-next-line no-console
  console.log(`  ${prepared.width}×${prepared.height}px → ${prepared.bytes} bytes`);

  const images: ClassifyImage[] = [
    { base64: prepared.base64, kind: "meal", ord: 0 },
  ];

  const job: MealJob = {
    meal_id: "probe-durum",
    period_key: "2026-05-17",
    user_meal_at: "2026-05-17T19:00:00+02:00",
    user_text: HINT || null,
    notes: null,
    photos: [{ ord: 0, path: PHOTO_PATH, mime: "image/jpeg", kind: "meal" }],
  };

  header(
    `classify (qwen3.6, hint="${HINT}", tools=${USE_TOOLS ? "ON" : "OFF"})`,
  );
  const t0 = Date.now();
  const classify = await classifyMeal({ job, images });
  // eslint-disable-next-line no-console
  console.log(`  latency=${classify.latencyMs}ms hintDropped=${classify.hintDropped}`);
  // eslint-disable-next-line no-console
  console.log(lineify(classify.output));

  header(`enrich (grounding cascade)`);
  const enriched = await enrichComponents(classify.output);
  // eslint-disable-next-line no-console
  console.log(
    `  usdaHits=${enriched.usdaHits.length} (${enriched.usdaHits.join(",") || "—"})\n` +
      `  offHits=${enriched.offHits.length} (${enriched.offHits.join(",") || "—"})\n` +
      `  llmHits=${enriched.llmHits.length} (${enriched.llmHits.join(",") || "—"})\n` +
      `  unresolved=${enriched.unresolved.length} (${enriched.unresolved.join(",") || "—"})`,
  );

  header(`final components`);
  for (const c of enriched.components) {
    const prov = c.provenance
      .map((p) =>
        p.external_id
          ? `${p.field_path}:${p.source}:${p.external_id}`
          : `${p.field_path}:${p.source}`,
      )
      .join(", ");
    // eslint-disable-next-line no-console
    console.log(
      `  • ${c.label.padEnd(28)} ${String(c.grams).padStart(5)}g  ` +
        `kcal=${c.nutrition.totals.kcal}  [${prov}]`,
    );
  }

  header(`totals`);
  // eslint-disable-next-line no-console
  console.log(lineify(enriched.totals));

  // ── Acceptance gate ────────────────────────────────────────────────────
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  checks.push({
    name: "≥ 4 components",
    ok: enriched.components.length >= 4,
    detail: `got ${enriched.components.length}`,
  });

  const labels = enriched.components.map((c) => c.label.toLowerCase());
  checks.push({
    name: "no lumped 'Belegtes Brötchen'",
    ok: !labels.some((l) => l.includes("belegtes broetchen") || l.includes("belegtes brötchen")),
  });

  checks.push({
    name: "every component carries provenance",
    ok: enriched.components.every((c) => c.provenance.length > 0),
  });

  const externalGrounded = enriched.components.some((c) =>
    c.provenance.some((p) => p.source === "external_db"),
  );
  checks.push({
    name: "≥ 1 component grounded via USDA or OFF (external_db)",
    ok: externalGrounded,
    detail: externalGrounded ? "yes" : "all fell to LLM / seed only",
  });

  const kcal = enriched.totals.kcal;
  checks.push({
    name: "kcal total in 600–1000",
    ok: kcal >= 600 && kcal <= 1000,
    detail: `total=${kcal}`,
  });

  header(`acceptance`);
  let allOk = true;
  for (const check of checks) {
    const tag = check.ok ? "PASS" : "FAIL";
    // eslint-disable-next-line no-console
    console.log(`  [${tag}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    if (!check.ok) allOk = false;
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${allOk ? "PASS" : "FAIL"} — Dürüm grounding probe (tools=${
      USE_TOOLS ? "on" : "off"
    }) in ${Date.now() - t0}ms\n`,
  );

  // Per-component canonicalisation summary — useful when A/B comparing
  // tools-on vs tools-off output. Prints the food_keys sorted alphabetically
  // so a diff between two runs is trivial to scan.
  const keys = enriched.components.map((c) => c.food_key).sort();
  // eslint-disable-next-line no-console
  console.log(`  food_keys: [${keys.join(", ")}]`);
  const sources = enriched.components.flatMap((c) =>
    c.provenance.filter((p) => p.field_path === "nutrition.per100g").map((p) => p.source),
  );
  const counts: Record<string, number> = {};
  for (const s of sources) counts[s] = (counts[s] ?? 0) + 1;
  // eslint-disable-next-line no-console
  console.log(`  provenance: ${JSON.stringify(counts)}`);

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[FAIL] probe threw: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
