import { db as openDb } from "../../db.ts";
import { config } from "../../config.ts";
import { readFactsForDate, pickBaselines } from "../packagers/shared.ts";
import { computeDayScore } from "../day-score.ts";

const date = process.argv[2] ?? "2026-05-09";
const facts = readFactsForDate(config.insightsRoot, date);
if (!facts) {
  console.error("no facts for", date);
  process.exit(1);
}

const sleep = ((facts.sleep as { metrics?: Record<string, number | null> }).metrics) ?? {};
const cardio = ((facts.cardio as { metrics?: Record<string, number | null> }).metrics) ?? {};
const activity = ((facts.activity as { metrics?: Record<string, number | null> }).metrics) ?? {};
const stress = ((facts.stress as { metrics?: Record<string, number | null> }).metrics) ?? {};

const baselines = {
  ...pickBaselines(facts, "sleep", ["sleep_efficiency_pct", "tst_min", "rmssd_ms", "rhr_sleep_bpm"]),
  ...pickBaselines(facts, "cardio", ["rhr_day_bpm"]),
  ...pickBaselines(facts, "stress", ["stress_mean"]),
  ...pickBaselines(facts, "activity", ["steps", "active_minutes"]),
};

const score = computeDayScore(
  {
    sleep_efficiency_pct: sleep.sleep_efficiency_pct ?? null,
    tst_min: sleep.tst_min ?? null,
    rmssd_ms: sleep.rmssd_ms ?? null,
    rhr_day_bpm: cardio.rhr_day_bpm ?? null,
    rhr_sleep_bpm: sleep.rhr_sleep_bpm ?? null,
    stress_mean: stress.stress_mean ?? null,
    steps: activity.steps ?? null,
    active_minutes: activity.active_minutes ?? null,
  },
  baselines,
);

console.log(JSON.stringify(score, null, 2));
