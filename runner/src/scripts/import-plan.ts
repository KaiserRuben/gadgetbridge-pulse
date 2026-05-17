#!/usr/bin/env tsx
/**
 * One-shot Reconditioning 2026 import.
 *
 * Usage:
 *   tsx runner/src/scripts/import-plan.ts [--url=http://pi.local:3030]
 *
 * Calls the Pi-side `POST /api/training/plan/import` endpoint, which:
 *   - upserts the seed exercise library (idempotent),
 *   - imports plan_v1 only when PULSE_TRAINING_PLAN is empty (so re-runs
 *     after the seed are no-ops on the plan side).
 *
 * The plan payload is built server-side from `lib/training/plan-builder.ts`,
 * so this script just triggers the POST and prints the response.
 *
 * Default URL: PULSE_DASHBOARD_URL env, or http://localhost:3030.
 */

const DEFAULT_URL = process.env.PULSE_DASHBOARD_URL ?? "http://localhost:3030";

function parseArgs(argv: string[]): { url: string } {
  let url = DEFAULT_URL;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
    } else if (arg === "--help" || arg === "-h") {
      // eslint-disable-next-line no-console
      console.log(`usage: tsx runner/src/scripts/import-plan.ts [--url=http://host:port]`);
      process.exit(0);
    }
  }
  return { url: url.replace(/\/+$/, "") };
}

async function main(): Promise<void> {
  const { url } = parseArgs(process.argv);
  const endpoint = `${url}/api/training/plan/import`;
  // eslint-disable-next-line no-console
  console.log(`[import-plan] POST ${endpoint}`);
  const res = await fetch(endpoint, { method: "POST" });
  const body = (await res.json()) as { ok?: boolean; error?: string; mode?: string; [k: string]: unknown };
  if (!res.ok || !body.ok) {
    // eslint-disable-next-line no-console
    console.error(`[import-plan] HTTP ${res.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[import-plan] ok (${body.mode}):`, JSON.stringify(body, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
