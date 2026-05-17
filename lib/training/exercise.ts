import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type { TrainingExerciseV1 } from "../types/generated";

/**
 * PULSE_EXERCISE access. The library is the stable reference for plan
 * prescriptions and set logs — exercise_id is a foreign key in those tables.
 * Schema: `runner/src/schemas/training/exercise.schema.json`.
 */

interface ExerciseRow {
  id: string;
  display_de: string;
  display_en: string | null;
  movement_pattern: string;
  primary_muscles_json: string;
  equipment_json: string;
  substitutes_json: string;
  contraindications_json: string;
  unilateral: number;
  tags_json: string;
  notes_de: string | null;
}

function rowToExercise(r: ExerciseRow): TrainingExerciseV1 {
  return {
    schema_version: "training/exercise/v1",
    id: r.id,
    display_de: r.display_de,
    display_en: r.display_en,
    movement_pattern: r.movement_pattern as TrainingExerciseV1["movement_pattern"],
    primary_muscles: JSON.parse(r.primary_muscles_json) as string[],
    equipment: JSON.parse(r.equipment_json) as TrainingExerciseV1["equipment"],
    substitutes: JSON.parse(r.substitutes_json) as string[],
    contraindications: JSON.parse(r.contraindications_json) as TrainingExerciseV1["contraindications"],
    unilateral: r.unilateral === 1,
    tags: JSON.parse(r.tags_json) as string[],
    notes_de: r.notes_de,
  };
}

const SELECT_COLUMNS = `
  id, display_de, display_en, movement_pattern,
  primary_muscles_json, equipment_json, substitutes_json, contraindications_json,
  unilateral, tags_json, notes_de
`;

export function readExercise(id: string): TrainingExerciseV1 | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], ExerciseRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_EXERCISE WHERE id = ?`,
      )
      .get(id);
    return row ? rowToExercise(row) : null;
  } catch {
    return null;
  }
}

export function listExercises(opts?: { movement_pattern?: string }): TrainingExerciseV1[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    if (opts?.movement_pattern) {
      const rows = db
        .prepare<[string], ExerciseRow>(
          `SELECT ${SELECT_COLUMNS} FROM PULSE_EXERCISE WHERE movement_pattern = ? ORDER BY id`,
        )
        .all(opts.movement_pattern);
      return rows.map(rowToExercise);
    }
    const rows = db
      .prepare<[], ExerciseRow>(
        `SELECT ${SELECT_COLUMNS} FROM PULSE_EXERCISE ORDER BY id`,
      )
      .all();
    return rows.map(rowToExercise);
  } catch {
    return [];
  }
}

export type ExerciseUpsert = Omit<TrainingExerciseV1, "schema_version">;

/**
 * Upsert one or more exercises. Idempotent: re-running with the same payloads
 * is a no-op semantically (rows reshape but content is identical). Used by
 * the seed-library importer.
 */
export function upsertExercises(items: ExerciseUpsert[]): number {
  if (items.length === 0) return 0;
  const db = getWritableDb();
  const stmt = db.prepare(
    `INSERT INTO PULSE_EXERCISE
       (id, display_de, display_en, movement_pattern,
        primary_muscles_json, equipment_json, substitutes_json, contraindications_json,
        unilateral, tags_json, notes_de, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_de = excluded.display_de,
       display_en = excluded.display_en,
       movement_pattern = excluded.movement_pattern,
       primary_muscles_json = excluded.primary_muscles_json,
       equipment_json = excluded.equipment_json,
       substitutes_json = excluded.substitutes_json,
       contraindications_json = excluded.contraindications_json,
       unilateral = excluded.unilateral,
       tags_json = excluded.tags_json,
       notes_de = excluded.notes_de,
       updated_at = excluded.updated_at`,
  );
  const nowIso = new Date().toISOString();

  const tx = db.transaction((rows: ExerciseUpsert[]) => {
    let written = 0;
    for (const e of rows) {
      stmt.run(
        e.id,
        e.display_de,
        e.display_en ?? null,
        e.movement_pattern,
        JSON.stringify(e.primary_muscles ?? []),
        JSON.stringify(e.equipment),
        JSON.stringify(e.substitutes ?? []),
        JSON.stringify(e.contraindications ?? []),
        e.unilateral ? 1 : 0,
        JSON.stringify(e.tags ?? []),
        e.notes_de ?? null,
        nowIso,
      );
      written += 1;
    }
    return written;
  });
  return tx(items);
}
