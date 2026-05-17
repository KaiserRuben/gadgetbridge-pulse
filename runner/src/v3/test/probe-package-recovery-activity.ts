/**
 * Smoke test for recovery + activity packagers (no LLM call).
 * Usage: tsx runner/src/v3/test/probe-package-recovery-activity.ts [YYYY-MM-DD]
 */

import { db as openDb } from "../../db.ts";
import { config } from "../../config.ts";
import { buildRecoveryPackage } from "../packagers/recovery.ts";
import { buildActivityPackage } from "../packagers/activity.ts";

const date = process.argv[2] ?? "2026-05-09";
const db = openDb();
const insightsRoot = config.insightsRoot;

console.log("=== RECOVERY ===");
const rec = buildRecoveryPackage({ periodKey: date, db, insightsRoot });
const recJson = JSON.stringify(rec, null, 2);
console.log(`bytes=${recJson.length}  approx_tokens=${Math.round(recJson.length / 3.5)}`);
console.log(
  `hrv_points=${rec.today.hrv.hrv_series_today.length} awake_hr_buckets=${rec.today.hr_5min_awake.length}`,
);
console.log(
  `last_2_days=${rec.last_2_days.length} days_3_to_7=${rec.days_3_to_7.length} baselines=${Object.keys(rec.baselines_30d).length} deltas=${Object.keys(rec.deltas_today).length}`,
);
console.log(
  `today_workouts=${rec.context.today_workouts.length} training_load_7d=${rec.context.training_load_7d}`,
);
console.log("--- rhr ---");
console.log(JSON.stringify(rec.today.rhr, null, 2));
console.log("--- deltas ---");
console.log(JSON.stringify(rec.deltas_today, null, 2));

console.log("\n=== ACTIVITY ===");
const act = buildActivityPackage({ periodKey: date, db, insightsRoot });
const actJson = JSON.stringify(act, null, 2);
console.log(`bytes=${actJson.length}  approx_tokens=${Math.round(actJson.length / 3.5)}`);
console.log(
  `workouts=${act.today.workouts.length} steps_total=${act.today.steps.total} steps_hourly=${act.today.steps.hourly.length}`,
);
console.log(
  `sedentary_blocks=${act.today.sedentary_blocks.length} awake_hr_buckets=${act.today.hr_5min_awake.length}`,
);
console.log(
  `last_2_days=${act.last_2_days.length} days_3_to_7=${act.days_3_to_7.length} baselines=${Object.keys(act.baselines_30d).length} deltas=${Object.keys(act.deltas_today).length}`,
);
console.log(`cumulative_load_7d=${act.context.cumulative_load_7d} baseline=${act.context.cumulative_load_baseline_7d}`);
console.log("--- hr_zones ---");
console.log(JSON.stringify(act.today.hr_zones, null, 2));
console.log("--- deltas ---");
console.log(JSON.stringify(act.deltas_today, null, 2));
