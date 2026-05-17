/**
 * Smoke test: POST a sentinel row to /api/ingest/state and verify the
 * round trip landed. Use after deploying a new dashboard build.
 *
 *   PULSE_INGEST_BASE_URL=http://<your-pi-host>:3030 \
 *   PULSE_INGEST_TOKEN=... \
 *   npx tsx src/scripts/ingest-smoke.ts
 */

import { config } from "../config.ts";
import { pushState } from "../ingest/client.ts";

async function main() {
  if (!config.ingestBaseUrl) {
    console.error("PULSE_INGEST_BASE_URL not set");
    process.exit(1);
  }
  const stamp = new Date().toISOString();
  const res = await pushState({ key: "smoke", value: { stamp } });
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok && !res.queued) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
