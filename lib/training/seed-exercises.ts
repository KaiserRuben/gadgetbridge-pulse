import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { TrainingExerciseV1 } from "../types/generated";

/**
 * Load the canonical exercise seed payload. Lives under
 * `runner/src/schemas/training/exercises-seed.json`; Next.js cannot import
 * it directly because the runner tree is tsconfig-excluded, so we read it
 * via fs at module-load time.
 *
 * Same `process.cwd()`-relative path strategy as `validate.ts` — works
 * because Next dev server + standalone build both run from repo root.
 */

interface SeedFile {
  $schema_version: string;
  exercises: TrainingExerciseV1[];
}

const SEED_PATH = path.resolve(
  process.cwd(),
  "runner",
  "src",
  "schemas",
  "training",
  "exercises-seed.json",
);

let _cached: TrainingExerciseV1[] | null = null;

export function loadSeedExercises(): TrainingExerciseV1[] {
  if (_cached) return _cached;
  const txt = readFileSync(SEED_PATH, "utf8");
  const parsed = JSON.parse(txt) as SeedFile;
  _cached = parsed.exercises;
  return _cached;
}
