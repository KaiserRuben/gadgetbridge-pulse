/**
 * Sleep packager smoke test — no LLM call. Validates package builds cleanly.
 * Usage: tsx runner/src/v3/test/probe-package-only.ts [YYYY-MM-DD]
 */

import { db as openDb } from "../../db.ts";
import { config } from "../../config.ts";
import { buildSleepPackage } from "../packagers/sleep.ts";

const date = process.argv[2] ?? "2026-05-09";
const pkg = buildSleepPackage({
  periodKey: date,
  db: openDb(),
  insightsRoot: config.insightsRoot,
});
const json = JSON.stringify(pkg, null, 2);
console.log(`bytes=${json.length}  approx_tokens=${Math.round(json.length / 3.5)}`);
console.log(
  `stages=${pkg.today.stages_timeline.length} hr_buckets=${pkg.today.hr_5min.length} spo2_buckets=${pkg.today.spo2_5min.length}`,
);
console.log(
  `workouts_today=${pkg.context.today_workouts.length} yesterday=${pkg.context.yesterday_workouts.length}`,
);
console.log(
  `baselines=${Object.keys(pkg.baselines_30d).length} deltas=${Object.keys(pkg.deltas_today).length}`,
);
console.log(
  `last_2_nights=${pkg.last_2_nights.length} days_3_to_7=${pkg.days_3_to_7.length}`,
);
console.log("--- summary ---");
console.log(JSON.stringify(pkg.today.summary, null, 2));
console.log("--- deltas ---");
console.log(JSON.stringify(pkg.deltas_today, null, 2));
console.log("--- context ---");
console.log(
  JSON.stringify(
    {
      today_workouts: pkg.context.today_workouts,
      yesterday_workouts: pkg.context.yesterday_workouts,
      data_quality: pkg.context.data_quality,
      late_evening_movement: pkg.context.late_evening_movement,
      daytime_hr_mean: pkg.context.daytime_hr_mean,
    },
    null,
    2,
  ),
);
