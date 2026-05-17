/**
 * Smoke for the Gadgetbridge.db -> pulse.db pivot.
 *
 * Runs `migrate-to-pulse-db.ts` in DRY-RUN mode via `child_process` and prints
 * the resulting summary. No data is mutated.
 *
 * Run: `tsx runner/src/test/probe-migration.ts`
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

function main(): void {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const script = path.resolve(here, "..", "migrate-to-pulse-db.ts");
  console.log(`[probe-migration] running dry-run: ${script}`);
  const r = spawnSync("tsx", [script], {
    stdio: ["ignore", "inherit", "inherit"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`migrate dry-run exited with code ${r.status ?? "<null>"}`);
  }
  console.log(`[probe-migration] OK (dry-run exit 0)`);
}

main();
