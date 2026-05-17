/**
 * Stage 0 — Build the deterministic daily facts bundle (FactsV2).
 *
 * Pipeline:
 *   1. Build the local-day window.
 *   2. Run all per-domain queries against the SQLite DB.
 *   3. Compute baselines (30 days preceding period_key).
 *   4. Compute signal-quality per domain.
 *   5. Assemble FactsBundleV2 and validate against `facts.schema.json`.
 *
 * Per PM resolution: facts.json carries pure data, NO rule decisions
 * (e.g. no `anomalies.detected[]` flags). The rule engine consumes this
 * bundle and produces observations downstream.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import type Database from "better-sqlite3";

import type { FactsBundleV2 } from "@/lib/types/generated";

import { db as openDb } from "../db.ts";
import { config } from "../config.ts";
import { dayWindow } from "./window.ts";
import { querySleep, countSleepRows } from "./queries/sleep.ts";
import { queryCardio } from "./queries/cardio.ts";
import { queryActivity } from "./queries/activity.ts";
import { queryStress } from "./queries/stress.ts";
import { queryBody } from "./queries/body.ts";
import { queryProfile } from "./queries/profile.ts";
import { queryAnomalies } from "./queries/anomalies.ts";
import { queryWorkouts } from "./queries/workouts.ts";
import { computeBaselines } from "./baselines.ts";
import { computeSignalQuality } from "./signal-quality.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Schema-validated builder
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../schemas/v2/facts.schema.json");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
const validateFacts = ajv.compile(schema);

/**
 * Main entry point. Builds and validates a FactsBundleV2 for `periodKey`.
 *
 * Throws if schema validation fails (caller can decide whether to retry or
 * panic-write a partial). Pass an explicit `database` to override the shared
 * connection (used in tests).
 */
export async function buildDailyFacts(
  periodKey: string,
  database?: Database.Database,
): Promise<FactsBundleV2> {
  const handle = database ?? openDb();
  const win = dayWindow(periodKey, config.timezone);
  const generatedAt = new Date().toISOString();

  // ── Profile (no window) ────────────────────────────────────────────────────
  const profile = queryProfile(handle, win);

  // ── Per-domain raw facts ───────────────────────────────────────────────────
  const sleep = querySleep(handle, win);
  const cardio = queryCardio(handle, win);
  const activity = queryActivity(handle, win);
  const stress = queryStress(handle, win);
  const body = queryBody(
    handle,
    win,
    profile.user.height_cm,
    profile.weight_kg,
    periodKey,
    config.timezone,
  );
  const anomalies = queryAnomalies(handle, win);
  const workoutsData = queryWorkouts(handle, win, profile.user.age);

  // ── Signal quality ─────────────────────────────────────────────────────────
  const sqInputs = { sleep, cardio, activity, stress, body };
  const sleepSq = computeSignalQuality("sleep", sqInputs);
  const cardioSq = computeSignalQuality("cardio", sqInputs);
  const activitySq = computeSignalQuality("activity", sqInputs);
  const stressSq = computeSignalQuality("stress", sqInputs);
  const bodySq = computeSignalQuality("body", sqInputs);

  // ── Baselines ──────────────────────────────────────────────────────────────
  const baselines = computeBaselines(periodKey, handle, config.timezone);

  // ── samples_seen ───────────────────────────────────────────────────────────
  const samplesSeen = {
    sleep_rows: countSleepRows(handle, win),
    hr_rows: cardio.hrRowCount,
    spo2_rows: body.spo2RowCount,
    stress_rows: stress.rowCount,
    step_rows: activity.rowCount,
    weight_rows: 0,
  };

  // ── Assemble the bundle ────────────────────────────────────────────────────
  const sleepBlock =
    sleep.rowCount > 0 || sleep.metrics.tst_min !== null
      ? {
          metrics: sleep.metrics,
          baseline: baselines.sleep,
          signal_quality: sleepSq,
        }
      : null;

  const facts: FactsBundleV2 = {
    schema_version: "facts/v2.1",
    period_key: periodKey,
    generated_at: generatedAt,
    data_window: {
      start_iso: new Date((win.startSec as number) * 1000).toISOString(),
      end_iso: new Date((win.endSec as number) * 1000).toISOString(),
      tz: win.tz,
    },
    samples_seen: samplesSeen,
    user: profile.user,
    device: profile.device,
    sleep: sleepBlock,
    cardio: {
      metrics: cardio.metrics,
      baseline: baselines.cardio,
      signal_quality: cardioSq,
      hrv_series: cardio.hrvSeries.length > 0 ? cardio.hrvSeries : null,
    },
    activity: { metrics: activity.metrics, baseline: baselines.activity, signal_quality: activitySq },
    stress: { metrics: stress.metrics, baseline: baselines.stress, signal_quality: stressSq },
    body: { metrics: body.metrics, baseline: baselines.body, signal_quality: bodySq },
    anomalies: profile.wearGapNote
      ? { ...anomalies, data_notes: [...anomalies.data_notes, profile.wearGapNote] }
      : anomalies,
    workouts: workoutsData.length > 0 ? workoutsData : null,
    ecg: null,
    journal: null,
    meal: null,
    cycle: null,
  };

  if (!validateFacts(facts)) {
    const errs = (validateFacts.errors ?? [])
      .slice(0, 5)
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`facts.json failed schema validation: ${errs}`);
  }
  return facts;
}
