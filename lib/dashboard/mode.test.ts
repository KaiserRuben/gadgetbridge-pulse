/**
 * Mode engine snapshot tests. Run with: npx tsx lib/dashboard/mode.test.ts
 *
 * Each case asserts the mode for a fixture input. Failures print expected vs got.
 */

import { computeMode, type ModeInputs, type DashboardMode } from "./mode.ts";

const TZ = "Europe/Berlin";
function hourMs(date: string, hour: number, minute = 0): number {
  // Construct UTC ms then offset for Europe/Berlin (CEST = +2 in May).
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour - 2, minute);
}

interface Case {
  name: string;
  input: ModeInputs;
  expected: DashboardMode;
}

const NOW_07_30 = hourMs("2026-05-11", 7, 30);
const NOW_13_00 = hourMs("2026-05-11", 13);
const NOW_19_30 = hourMs("2026-05-11", 19, 30);
const NOW_23_30 = hourMs("2026-05-11", 23, 30);
const NOW_03_00 = hourMs("2026-05-11", 3);
const WAKE_07_15 = hourMs("2026-05-11", 7, 15);
const WORKOUT_END_18_45 = hourMs("2026-05-11", 18, 45);

const cases: Case[] = [
  {
    name: "morning-fresh: woke 15min ago, insight ready",
    input: {
      now_ms: NOW_07_30,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "morning-fresh",
  },
  {
    name: "morning-stale: woke 15min ago, insight not ready, run in progress",
    input: {
      now_ms: NOW_07_30,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: false,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: true,
    },
    expected: "morning-stale",
  },
  {
    name: "midday: 13:00, no fresh workout",
    input: {
      now_ms: NOW_13_00,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "midday",
  },
  {
    name: "post-workout: workout ended 45min ago at 19:30",
    input: {
      now_ms: NOW_19_30,
      tz: TZ,
      last_workout_end_ms: WORKOUT_END_18_45,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "post-workout",
  },
  {
    name: "evening: 19:30, no fresh workout, synthesis ready",
    input: {
      now_ms: NOW_19_30,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: true,
      day_complete: true,
      run_in_progress: false,
    },
    expected: "evening",
  },
  {
    name: "evening fallback to day-incomplete: synthesis not ready",
    input: {
      now_ms: NOW_19_30,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "day-incomplete",
  },
  {
    name: "late-night: 23:30",
    input: {
      now_ms: NOW_23_30,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: true,
      day_complete: true,
      run_in_progress: false,
    },
    expected: "late-night",
  },
  {
    name: "night: 03:00",
    input: {
      now_ms: NOW_03_00,
      tz: TZ,
      last_workout_end_ms: null,
      last_wake_ms: null,
      sleep_insight_ready: false,
      synthesis_ready: false,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "night",
  },
  {
    name: "post-workout overrides evening",
    input: {
      now_ms: NOW_19_30,
      tz: TZ,
      last_workout_end_ms: WORKOUT_END_18_45,
      last_wake_ms: WAKE_07_15,
      sleep_insight_ready: true,
      synthesis_ready: true,
      day_complete: false,
      run_in_progress: false,
    },
    expected: "post-workout",
  },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const result = computeMode(c.input);
  if (result.mode === c.expected) {
    passed++;
    console.log(`✓ ${c.name} → ${result.mode}`);
  } else {
    failed++;
    console.error(
      `✗ ${c.name}\n  expected: ${c.expected}\n  got:      ${result.mode}\n  reasoning: ${result.reasoning}`,
    );
  }
}

console.log(`\n${passed}/${cases.length} passed${failed > 0 ? `, ${failed} failed` : ""}`);
process.exit(failed > 0 ? 1 : 0);
