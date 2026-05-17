/**
 * End-to-end smoke test for the v3 orchestrator.
 *
 * Usage:
 *   tsx runner/src/v3/test/probe-orchestrator.ts [--date YYYY-MM-DD] [--live] [--model qwen3.6:latest]
 *
 * --live: skip LLM stages, write packages + day_score only.
 */

import { runV3 } from "../../v3-orchestrator.ts";
import { config } from "../../config.ts";

interface Args {
  date: string | null;
  live: boolean;
  model: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { date: null, live: false, model: config.model };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") out.date = argv[++i];
    else if (a === "--live") out.live = true;
    else if (a === "--model") out.model = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.date) {
    console.error("--date YYYY-MM-DD required");
    process.exit(1);
  }
  console.log(`[probe-orchestrator] date=${args.date} live=${args.live} model=${args.model}`);

  const result = await runV3({
    periodKey: args.date,
    liveOnly: args.live,
    model: args.model,
  });

  console.log("\n[probe-orchestrator] result");
  console.log(`  ok: ${result.ok}`);
  console.log(`  total: ${result.totalMs}ms`);
  console.log(`  stage_b: ${result.stage_b_ms}ms`);
  console.log(`  stage_l: ${result.stage_l_ms}ms`);
  console.log(`  stage_s: ${result.stage_s_ms}ms`);
  console.log(`  stage_w: ${result.stage_w_ms}ms`);
  console.log(`  errors: ${result.errors.length === 0 ? "none" : result.errors.join("; ")}`);
  console.log(`  artifacts:`);
  for (const a of result.artifacts) console.log(`    ${a}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
