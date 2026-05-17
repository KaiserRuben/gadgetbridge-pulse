import "server-only";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { PauseStateV1, AlarmStateV1, LabsV1 } from "@/lib/types/generated";

import { readStateKv, writeStateKv } from "@/lib/data/period-store";

const SYNC_ROOT =
  process.env.PULSE_ROOT ?? "./pulse";
const STATE_ROOT = process.env.STATE_ROOT ?? path.join(SYNC_ROOT, "state");

/**
 * Default values used when a state file is missing or unreadable. They MUST
 * satisfy the corresponding generated type so callers don't have to null-check
 * before merging in user-supplied changes.
 */
const DEFAULT_PAUSE: PauseStateV1 = {
  schema_version: "state/v1",
  paused: false,
  i_feel_fine: false,
  i_feel_fine_until_iso: null,
  language: "de",
  step_change_detected_on: null,
};

const DEFAULT_ALARM_STATE: AlarmStateV1 = {
  schema_version: "state/v1",
  snooze_until: {},
  dismissed_counts: {},
  muted_topics: [],
};

const DEFAULT_LABS: LabsV1 = {
  schema_version: "state/v1",
  features: {
    cycle: false,
    training_load: false,
    illness_watch: false,
    similar_day_search: false,
    meal_photo: false,
    voice_journal: false,
    ecg: false,
  },
};

async function readJsonOr<T>(file: string, fallback: T): Promise<T> {
  try {
    const txt = await readFile(file, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

/**
 * Atomic write: serialize to a tmp file in the same directory, then rename
 * onto the target. Same-FS rename is atomic on POSIX, so concurrent readers
 * never see a partially-written file.
 */
async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/**
 * State accessors now hit PULSE_STATE_KV. The legacy JSON files are still
 * read once on first access (cold-migration), but every write lands in
 * pulse.db so the next reader stays consistent.
 */
export async function readPauseState(): Promise<PauseStateV1> {
  const row = readStateKv<PauseStateV1>("pause");
  if (row) return row;
  const legacy = await readJsonOr<PauseStateV1>(path.join(STATE_ROOT, "pause.json"), DEFAULT_PAUSE);
  writeStateKv("pause", legacy);
  return legacy;
}

export async function writePauseState(next: PauseStateV1): Promise<void> {
  writeStateKv("pause", next);
}

export async function readAlarmState(): Promise<AlarmStateV1> {
  const row = readStateKv<AlarmStateV1>("alarm_state");
  if (row) return row;
  const legacy = await readJsonOr<AlarmStateV1>(
    path.join(STATE_ROOT, "alarm_state.json"),
    DEFAULT_ALARM_STATE,
  );
  writeStateKv("alarm_state", legacy);
  return legacy;
}

export async function writeAlarmState(next: AlarmStateV1): Promise<void> {
  writeStateKv("alarm_state", next);
}

export async function readLabs(): Promise<LabsV1> {
  const row = readStateKv<LabsV1>("labs");
  if (row) return row;
  const legacy = await readJsonOr<LabsV1>(path.join(STATE_ROOT, "labs.json"), DEFAULT_LABS);
  writeStateKv("labs", legacy);
  return legacy;
}

export async function writeLabs(next: LabsV1): Promise<void> {
  writeStateKv("labs", next);
}
