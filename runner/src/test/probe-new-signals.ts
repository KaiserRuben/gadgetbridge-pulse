/**
 * Offline smoke probe — verifies the v2.1 facts bundle surfaces the
 * previously-ignored Huawei GT 5 Pro signals.
 *
 * Runs `buildDailyFacts` against the local SQLite DB and prints the new
 * fields. Does NOT call the LLM stages.
 *
 * Run: `npx tsx src/test/probe-new-signals.ts [YYYY-MM-DD]`
 */

import { buildDailyFacts } from "../facts/daily.ts";

async function main(): Promise<void> {
  const periodKey = process.argv[2] ?? "2026-05-07";
  console.log(`[probe] building facts for ${periodKey}`);

  const facts = await buildDailyFacts(periodKey);

  const out = {
    schema_version: facts.schema_version,
    period_key: facts.period_key,
    "device.battery": facts.device.battery,
    "sleep.metrics.apnea_events_count": facts.sleep?.metrics.apnea_events_count ?? null,
    "sleep.metrics.apnea_max_level": facts.sleep?.metrics.apnea_max_level ?? null,
    "sleep.metrics.breath_rate_mean": facts.sleep?.metrics.breath_rate_mean ?? null,
    "sleep.metrics.wake_count": facts.sleep?.metrics.wake_count ?? null,
    "sleep.metrics.rdi": facts.sleep?.metrics.rdi ?? null,
    "sleep.metrics.hr_min_sleep": facts.sleep?.metrics.hr_min_sleep ?? null,
    "sleep.metrics.hr_max_sleep": facts.sleep?.metrics.hr_max_sleep ?? null,
    "sleep.metrics.sleep_latency_min": facts.sleep?.metrics.sleep_latency_min ?? null,
    "cardio.hrv_series.length": facts.cardio.hrv_series?.length ?? 0,
    "cardio.hrv_series.head": facts.cardio.hrv_series?.slice(0, 3) ?? null,
    "cardio.hrv_series.tail": facts.cardio.hrv_series?.slice(-3) ?? null,
    "activity.metrics.distance_m": facts.activity.metrics.distance_m,
    "body.metrics.skin_temp_median": facts.body.metrics.skin_temp_median,
    "body.metrics.skin_temp_delta_c": facts.body.metrics.skin_temp_delta_c,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
