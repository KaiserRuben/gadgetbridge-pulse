/**
 * Alarm persistence — append-only per-month event log.
 *
 * Filters rule-engine observations to tier-bearing, non-suppressed alarms,
 * deduplicates against already-recorded events (idempotent on re-runs), and
 * atomically appends to <alarmsRoot>/<YYYY-MM>/alarms.json.
 *
 * Single-writer: only this module writes alarms.json files.
 * alarm_state.json is written by writeAlarmStateAtomic() in stage7-write.
 */

import { mkdir, readFile, rename, writeFile, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AlarmEvent, AlarmsV2 } from "@/lib/types/generated";
import type { Observation, AlarmStateV1 } from "../rules/types.ts";
import { STAGING_ROOT } from "../stages/stage7-write.ts";
import { log } from "../logger.ts";

const ABSOLUTE_IDS = new Set([
  "rhr_tachycardia_safety",
  "spo2_critical_low",
  "sleep_apnea_safety",
  "sleep_total_time_critical",
  "sleep_efficiency_low_critical",
  "sleep_latency_high_critical",
]);
const Z_SCORE_IDS = new Set(["hrv_low_acute", "skin_temp_pre_illness"]);
const DURATION_IDS = new Set(["sleep_latency_high", "sleep_latency_extreme"]);
const PATTERN_IDS = new Set([
  "hrv_trend_falling",
  "hrv_cv_rising",
  "rhr_drift_rising",
  "rhr_drift_falling",
  "sleep_regularity_poor",
  "sleep_regularity_fair",
  "sleep_total_time_low_pattern",
  "sleep_efficiency_low_pattern",
  "sleep_apnea_pattern",
  "stress_chronicity_high",
  "stress_single_day_spike",
  "activity_steps_low_pattern",
  "activity_sedentary_high",
]);

function inferGateTriggered(id: string): AlarmEvent["gate_triggered"] {
  if (ABSOLUTE_IDS.has(id)) return "absolute";
  if (Z_SCORE_IDS.has(id)) return "z_score";
  if (DURATION_IDS.has(id)) return "duration";
  if (PATTERN_IDS.has(id)) return "pattern";
  return "compound";
}

type EvidenceEntry = { period_key: string; value: number | null };

function buildAlarmEvent(obs: Observation, periodKey: string, firedAt: string): AlarmEvent {
  const tier = obs.tier as "S1" | "S2" | "S3";
  const ew: [EvidenceEntry] = [{ period_key: periodKey, value: null }];
  return {
    alarm_id: obs.id,
    fired_at: firedAt,
    period_key: periodKey,
    tier,
    domain: obs.domain,
    metric: obs.metric_id,
    severity_label: tier === "S1" ? "hard" : "soft",
    gate_triggered: inferGateTriggered(obs.id),
    z_score: null,
    evidence_window: ew as AlarmEvent["evidence_window"],
    dismissed: false,
    dismissed_at: null,
    dismissed_reason: null,
  };
}

async function atomicMove(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw err;
    const tmp = `${dst}.tmp.${process.pid}.${Date.now()}`;
    await copyFile(src, tmp);
    await rename(tmp, dst);
    await unlink(src);
  }
}

export interface PersistAlarmsResult {
  appended: AlarmEvent[];
  updatedState: AlarmStateV1;
}

/**
 * Persist alarms for `periodKey`. Idempotent: re-running for the same
 * periodKey will not produce duplicate events.
 */
export async function persistAlarms(
  observations: Observation[],
  periodKey: string,
  alarmState: AlarmStateV1,
  alarmsRoot: string,
): Promise<PersistAlarmsResult> {
  const today = periodKey;

  const candidates = observations.filter((obs) => {
    if (!obs.tier) return false;
    if (obs.suppressed_by && obs.suppressed_by.length > 0) return false;
    if (alarmState.muted_topics.includes(obs.id)) return false;
    const snooze = alarmState.snooze_until[obs.id];
    if (snooze && today <= snooze) return false;
    const dismissed = alarmState.dismissed_counts[obs.id] ?? 0;
    if (dismissed >= 2) return false;
    return true;
  });

  if (candidates.length === 0) return { appended: [], updatedState: alarmState };

  const monthKey = periodKey.slice(0, 7);
  const monthDir = path.join(alarmsRoot, monthKey);
  const alarmsFile = path.join(monthDir, "alarms.json");

  let existing: AlarmsV2 = { schema_version: "alarms/v2", month_key: monthKey, events: [] };
  try {
    existing = JSON.parse(await readFile(alarmsFile, "utf8")) as AlarmsV2;
  } catch {
    // File does not exist yet — starting fresh.
  }

  const recorded = new Set(existing.events.map((ev) => `${ev.alarm_id}::${ev.period_key}`));
  const firedAt = new Date().toISOString();
  const newEvents: AlarmEvent[] = [];
  for (const obs of candidates) {
    if (recorded.has(`${obs.id}::${periodKey}`)) continue;
    newEvents.push(buildAlarmEvent(obs, periodKey, firedAt));
  }

  if (newEvents.length === 0) return { appended: [], updatedState: alarmState };

  const updated: AlarmsV2 = {
    schema_version: "alarms/v2",
    month_key: monthKey,
    events: [...existing.events, ...newEvents],
  };

  const stagingDir = path.join(STAGING_ROOT, `alarms-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(monthDir, { recursive: true });
  const stageFile = path.join(stagingDir, "alarms.json");
  await writeFile(stageFile, JSON.stringify(updated, null, 2), "utf8");
  await atomicMove(stageFile, alarmsFile);

  log.info(
    "alarms",
    `persisted ${newEvents.length} event(s) for ${periodKey}: ${newEvents
      .map((e) => `${e.alarm_id}(${e.tier})`).join(", ")}`,
  );

  return { appended: newEvents, updatedState: alarmState };
}
