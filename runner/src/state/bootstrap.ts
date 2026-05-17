/**
 * State-file bootstrap.
 *
 * On first runner startup any of the user-state files may be missing. This
 * module seeds them with safe defaults via atomic write so the engine has
 * a known-good shape to read on every subsequent run.
 *
 * Files (under `config.stateRoot`):
 *   - pause.json         — PauseStateV1
 *   - labs.json          — LabsV1
 *   - alarm_state.json   — AlarmStateV1
 *
 * NEVER overwrites an existing file.
 */

import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AlarmStateV1,
  LabsV1,
  PauseStateV1,
} from "@/lib/types/generated";
import { config } from "../config.ts";

export interface StateBundle {
  pause: PauseStateV1;
  labs: LabsV1;
  alarmState: AlarmStateV1;
}

const SEED_PAUSE: PauseStateV1 = {
  schema_version: "state/v1",
  paused: false,
  i_feel_fine: false,
  i_feel_fine_until_iso: null,
  language: "de",
  step_change_detected_on: null,
};

const SEED_LABS: LabsV1 = {
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

const SEED_ALARM_STATE: AlarmStateV1 = {
  schema_version: "state/v1",
  snooze_until: {},
  dismissed_counts: {},
  muted_topics: [],
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function seedIfMissing<T>(p: string, seed: T): Promise<void> {
  if (await fileExists(p)) return;
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(seed, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, p);
}

/**
 * Ensure all three state files exist; create with defaults otherwise.
 * Returns the parsed contents.
 */
export async function ensureStateFiles(): Promise<StateBundle> {
  const dir = config.stateRoot;
  const pausePath = path.join(dir, "pause.json");
  const labsPath = path.join(dir, "labs.json");
  const alarmPath = path.join(dir, "alarm_state.json");

  await seedIfMissing(pausePath, SEED_PAUSE);
  await seedIfMissing(labsPath, SEED_LABS);
  await seedIfMissing(alarmPath, SEED_ALARM_STATE);

  return {
    pause: JSON.parse(await readFile(pausePath, "utf8")) as PauseStateV1,
    labs: JSON.parse(await readFile(labsPath, "utf8")) as LabsV1,
    alarmState: JSON.parse(await readFile(alarmPath, "utf8")) as AlarmStateV1,
  };
}
