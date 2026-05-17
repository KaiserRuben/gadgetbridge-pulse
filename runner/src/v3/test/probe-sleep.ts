/**
 * Probe-sleep — validates the v3 sleep use case end-to-end on a real day.
 *
 * Usage:
 *   tsx runner/src/v3/test/probe-sleep.ts [--date YYYY-MM-DD] [--seeds 3] [--abstain]
 *
 * Picks a recent date with full sleep data (or the date supplied), runs the
 * packager, calls qwen3.6 via Ollama with structured output, validates the
 * result against the JSON schema, prints token usage / latency / KPIs.
 *
 * --abstain: artificially clips wear_hours_today to 4 to verify the abstain
 *            path triggers correctly.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { config } from "../../config.ts";
import { db as openDb } from "../../db.ts";
import { callOllama } from "../../ollama.ts";
import { buildSleepPackage } from "../packagers/sleep.ts";
import { SLEEP_SYSTEM_PROMPT, buildSleepUserPrompt } from "../prompts/sleep.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../schemas/sleep_insight.schema.json");
const OUTPUT_DIR = path.resolve(__dirname, "output");

interface Args {
  date: string | null;
  seeds: number;
  abstain: boolean;
  model: string;
  promptOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { date: null, seeds: 3, abstain: false, model: config.model, promptOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") out.date = argv[++i];
    else if (a === "--seeds") out.seeds = Number(argv[++i]);
    else if (a === "--abstain") out.abstain = true;
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--prompt-only") out.promptOnly = true;
  }
  return out;
}

function pickRecentDate(insightsRoot: string): string | null {
  const dailyDir = path.join(insightsRoot, "daily");
  if (!existsSync(dailyDir)) return null;
  const dates = readdirSync(dailyDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  dates.sort();
  // Walk backward from the newest date until we find one with non-null tst_min.
  for (let i = dates.length - 1; i >= 0; i--) {
    const factsPath = path.join(dailyDir, dates[i], "_facts.json");
    if (!existsSync(factsPath)) continue;
    try {
      const facts = JSON.parse(readFileSync(factsPath, "utf8")) as {
        sleep?: { metrics?: { tst_min?: number | null } };
      };
      if (facts.sleep?.metrics?.tst_min) return dates[i];
    } catch {
      // skip
    }
  }
  return null;
}

async function runOnce(opts: {
  date: string;
  seed: number;
  abstain: boolean;
  ajv: Ajv2020;
  schema: object;
  model: string;
  promptOnly: boolean;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  promptTokens: number;
  evalTokens: number;
  schemaValid: boolean;
  schemaErrors: string[];
  groundingErrors: string[];
  raw: string;
  parsed: unknown;
  packageBytes: number;
}> {
  const db = openDb();
  const pkg = buildSleepPackage({
    periodKey: opts.date,
    db,
    insightsRoot: config.insightsRoot,
  });

  if (opts.abstain && pkg.context.data_quality) {
    pkg.context.data_quality.wear_hours_today = 4;
  }

  const packageJson = JSON.stringify(pkg);
  const user = buildSleepUserPrompt(pkg);

  const manifest = `FELDER-MANIFEST (exakte Namen, Reihenfolge, Typen — keine eigenen Felder erfinden, keine Felder weglassen):
1.  schema_version: const "use_case/sleep/v1"
2.  language: "de" | "en"
3.  abstain: boolean
4.  abstain_reason: string|null (≤240). Nicht-null wenn abstain=true.
5.  headline: string|null (≤60). Verb-led. Null wenn abstain=true.
6.  summary_short: string|null (≤100 Zeichen). ≥1 konkrete Zahl.
7.  summary_long: string|null (≤200). ≥1 Baseline-/Delta-Bezug.
8.  analysis_today: string|null (≤400). ≥2 konkrete Zahlen.
9.  analysis_context: string|null (≤300). ≥1 z-Score ODER Delta vs Baseline UND ≥1 Vergleich vs letzte 2 Nächte.
10. suggestions_today: Array (0-3) von { reasoning (20-240), anchor (4-60, das Signal), tiny (4-80, die Aktion), why (8-140, der Mechanismus), horizon ("today"|"tonight") }
11. suggestions_long_term: Array (0-3) von { reasoning (20-240), horizon ("this_week"|"this_month"), action (8-140), why (12-200) }
12. kpis: Array (3-5) von { reasoning (20-240), id (snake_case), label_de (3-40), value (0-100), band ("above_usual"|"steady"|"below_usual") }. Erste 3 in dieser Reihenfolge: sleep_quality, recovery_readiness, sleep_consistency.
13. confidence: { reasoning (20-240), value (0-1) }`;

  const system = opts.promptOnly
    ? `${SLEEP_SYSTEM_PROMPT}\n\n${manifest}\n\nGib AUSSCHLIESSLICH ein einziges JSON-Objekt aus. Beginne direkt mit '{' und beende mit '}'. Kein Markdown, keine Code-Fences, kein Text davor oder dahinter, keine Schema-Wiederholung.`
    : SLEEP_SYSTEM_PROMPT;

  const result = await callOllama({
    model: opts.model,
    system,
    user,
    format: opts.promptOnly ? undefined : opts.schema,
    options: {
      temperature: 0.2,
      num_ctx: 32768,
      num_predict: 4000,
      seed: opts.seed,
    },
  });

  let parsed: unknown = null;
  let parseError: string | null = null;
  const rawContent = result.content;
  const jsonText = opts.promptOnly ? extractJson(rawContent) : rawContent;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  const validate = opts.ajv.compile(opts.schema);
  const schemaValid = parsed != null ? Boolean(validate(parsed)) : false;
  const schemaErrors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  );
  if (parseError) schemaErrors.unshift(`JSON.parse: ${parseError}`);

  const groundingErrors = parsed && schemaValid ? checkGrounding(parsed, pkg) : [];

  return {
    ok: schemaValid && groundingErrors.length === 0,
    latencyMs: result.totalMs,
    promptTokens: result.promptTokens,
    evalTokens: result.evalTokens,
    schemaValid,
    schemaErrors,
    groundingErrors,
    raw: result.content,
    parsed,
    packageBytes: packageJson.length,
  };
}

function extractJson(text: string): string {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenced.length > 0) return fenced[fenced.length - 1][1].trim();
  // Walk through balanced { ... } objects and return the LAST that parses,
  // preferring those containing "schema_version" to handle schema-echo cases.
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  const withMarker = candidates.filter((c) => /"schema_version"\s*:\s*"use_case\/sleep\/v1"/.test(c));
  const pool = withMarker.length > 0 ? withMarker : candidates;
  for (let i = pool.length - 1; i >= 0; i--) {
    try {
      JSON.parse(pool[i]);
      return pool[i];
    } catch {
      // try previous candidate
    }
  }
  return text;
}

/** Pull every numeric token from the model output and check it appears in the package. */
function checkGrounding(parsed: unknown, pkg: unknown): string[] {
  const numbersInPkg = new Set<string>();
  collectNumbers(pkg, numbersInPkg);

  const errs: string[] = [];
  const proseFields = ["analysis_today", "analysis_context", "summary_short", "summary_long", "headline"];
  const obj = parsed as Record<string, unknown>;
  for (const f of proseFields) {
    const txt = typeof obj[f] === "string" ? (obj[f] as string) : null;
    if (!txt) continue;
    const matches = txt.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
    for (const raw of matches) {
      const norm = raw.replace(",", ".");
      const n = Number(norm);
      if (!Number.isFinite(n)) continue;
      if (isPlausibleNoise(n)) continue;
      if (!numbersInPkg.has(canonical(n))) {
        errs.push(`${f}: number ${raw} not in package`);
      }
    }
  }
  return errs;
}

function isPlausibleNoise(n: number): boolean {
  // Allow common phrasings that aren't grounded values: percentages 0/100, day counts 1-7.
  if (Number.isInteger(n) && n >= 0 && n <= 7) return true;
  if (n === 100) return true;
  return false;
}

function collectNumbers(value: unknown, out: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(canonical(value));
    // Also add rounded variants the LLM commonly emits (e.g. 6.2 → 6, 6h12).
    out.add(canonical(Math.round(value)));
    out.add(canonical(Math.round(value * 10) / 10));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

function canonical(n: number): string {
  // Match the LLM-formatted variants. Strip trailing zeros.
  const s = n.toString();
  return s;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? pickRecentDate(config.insightsRoot);
  if (!date) {
    console.error("[probe-sleep] no date with sleep data found");
    process.exit(1);
  }

  console.log(`[probe-sleep] date=${date} seeds=${args.seeds} abstain=${args.abstain} model=${args.model} promptOnly=${args.promptOnly}`);

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;

  const outDir = OUTPUT_DIR;
  mkdirSync(outDir, { recursive: true });

  // Save the packed input once for inspection.
  const db = openDb();
  const pkgSample = buildSleepPackage({
    periodKey: date,
    db,
    insightsRoot: config.insightsRoot,
  });
  if (args.abstain && pkgSample.context.data_quality) {
    pkgSample.context.data_quality.wear_hours_today = 4;
  }
  const pkgPath = path.join(outDir, `sleep_package_${date}${args.abstain ? "_abstain" : ""}.json`);
  writeFileSync(pkgPath, JSON.stringify(pkgSample, null, 2), "utf8");
  console.log(`[probe-sleep] package → ${pkgPath} (${(JSON.stringify(pkgSample).length / 1024).toFixed(1)} KB)`);

  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  for (let i = 0; i < args.seeds; i++) {
    const seed = 1000 + i;
    process.stdout.write(`[probe-sleep] seed=${seed} ... `);
    const r = await runOnce({ date, seed, abstain: args.abstain, ajv, schema, model: args.model, promptOnly: args.promptOnly });
    runs.push(r);
    const tag = r.ok ? "OK" : r.schemaValid ? "GROUNDING" : "INVALID";
    console.log(
      `${tag} ${r.latencyMs}ms in=${r.promptTokens} out=${r.evalTokens} ` +
        `schema=${r.schemaValid ? "yes" : "no"} grounding_errs=${r.groundingErrors.length}`,
    );
    if (r.schemaErrors.length > 0 && !r.schemaValid) {
      for (const e of r.schemaErrors.slice(0, 8)) console.log(`    schema: ${e}`);
    }
    if (r.groundingErrors.length > 0) {
      for (const e of r.groundingErrors.slice(0, 8)) console.log(`    ground: ${e}`);
    }
    const outPath = path.join(
      outDir,
      `sleep_insight_${date}_seed${seed}${args.abstain ? "_abstain" : ""}.json`,
    );
    writeFileSync(outPath, r.raw, "utf8");
  }

  console.log("\n[probe-sleep] summary");
  console.log(`  ok runs:           ${runs.filter((r) => r.ok).length}/${runs.length}`);
  console.log(`  schema-valid runs: ${runs.filter((r) => r.schemaValid).length}/${runs.length}`);
  console.log(
    `  avg latency:       ${Math.round(runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length)}ms`,
  );
  console.log(
    `  avg input tokens:  ${Math.round(runs.reduce((s, r) => s + r.promptTokens, 0) / runs.length)}`,
  );
  console.log(
    `  avg output tokens: ${Math.round(runs.reduce((s, r) => s + r.evalTokens, 0) / runs.length)}`,
  );

  // KPI stability across seeds.
  if (runs.every((r) => r.schemaValid && !args.abstain)) {
    console.log("\n[probe-sleep] KPI stability");
    const kpisBySeed = runs.map(
      (r) =>
        (r.parsed as { kpis?: Array<{ id: string; value: number; band: string }> })?.kpis ?? [],
    );
    const ids = new Set<string>();
    for (const k of kpisBySeed) for (const item of k) ids.add(item.id);
    for (const id of ids) {
      const vals = kpisBySeed.map((k) => k.find((it) => it.id === id));
      const present = vals.filter((v) => v != null);
      if (present.length === 0) continue;
      const values = present.map((v) => v!.value);
      const bands = present.map((v) => v!.band);
      const range = Math.max(...values) - Math.min(...values);
      const allSameBand = bands.every((b) => b === bands[0]);
      console.log(
        `  ${id.padEnd(24)} values=[${values.join(", ")}] range=${range} bands=[${bands.join(",")}] ${allSameBand ? "✓" : "⚠ band-drift"}`,
      );
    }
  }

  if (args.abstain) {
    console.log("\n[probe-sleep] abstain check");
    for (let i = 0; i < runs.length; i++) {
      const p = runs[i].parsed as { abstain?: boolean; abstain_reason?: string | null } | null;
      console.log(
        `  seed ${1000 + i}: abstain=${p?.abstain ?? "n/a"} reason="${p?.abstain_reason ?? ""}"`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
