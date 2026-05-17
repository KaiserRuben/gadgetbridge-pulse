/**
 * M008 round-trip: open an in-memory pulse.db, run migrations through M008,
 * exercise each new table with a representative INSERT, and read back.
 * Catches schema/migration drift early.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import { runMigrations, listMigrationIds } from "../../../db-migrations.ts";

type Db = BetterSqlite3.Database;

describe("M008_training migration", () => {
  let db: Db;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = MEMORY");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("registers M008_training in PULSE_MIGRATIONS", () => {
    const row = db
      .prepare<[string], { id: string }>(`SELECT id FROM PULSE_MIGRATIONS WHERE id = ?`)
      .get("M008_training");
    expect(row).toBeTruthy();
  });

  it("listMigrationIds includes M008_training", () => {
    expect(listMigrationIds()).toContain("M008_training");
  });

  it("creates all expected training tables", () => {
    const wanted = [
      "PULSE_TRAINING_PLAN",
      "PULSE_EXERCISE",
      "PULSE_PLANNED_SESSION",
      "PULSE_ACTUAL_SESSION",
      "PULSE_SET_LOG",
      "PULSE_SET_LOG_AUDIT",
      "PULSE_PAIN_FLAG",
      "PULSE_ADJUSTMENT_PROPOSAL",
      "PULSE_CHAT_THREAD",
      "PULSE_CHAT_MESSAGE",
    ];
    for (const name of wanted) {
      const row = db
        .prepare<[string], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        )
        .get(name);
      expect(row?.name, `table ${name} missing`).toBe(name);
    }
  });

  it("plan + session + set round-trip with FK constraints", () => {
    db.prepare(
      `INSERT INTO PULSE_TRAINING_PLAN (created_by, parent_version, change_summary, is_active, payload_json, payload_sha256)
       VALUES ('seed', NULL, NULL, 1, ?, 'sha-stub')`,
    ).run(JSON.stringify({ schema_version: "training/plan/v1" }));

    db.prepare(
      `INSERT INTO PULSE_EXERCISE (id, display_de, movement_pattern, equipment_json)
       VALUES ('goblet_squat', 'Goblet Squat', 'squat', '["dumbbell"]')`,
    ).run();

    db.prepare(
      `INSERT INTO PULSE_ACTUAL_SESSION (id, period_key, plan_version, state, started_at)
       VALUES (?, ?, 1, 'in_progress', ?)`,
    ).run("11111111-2222-3333-4444-555555555555", "2026-05-16", "2026-05-16T17:00:00Z");

    db.prepare(
      `INSERT INTO PULSE_SET_LOG (actual_session_id, exercise_id, set_idx, reps, weight_kg, rpe)
       VALUES (?, 'goblet_squat', 1, 10, 16, 6)`,
    ).run("11111111-2222-3333-4444-555555555555");

    const sets = db
      .prepare<[], { reps: number; weight_kg: number; rpe: number }>(
        `SELECT reps, weight_kg, rpe FROM PULSE_SET_LOG`,
      )
      .all();
    expect(sets).toHaveLength(1);
    expect(sets[0].reps).toBe(10);
    expect(sets[0].weight_kg).toBe(16);
  });

  it("pain_flag CHECK rejects unknown location_code", () => {
    db.prepare(
      `INSERT INTO PULSE_TRAINING_PLAN (created_by, change_summary, is_active, payload_json, payload_sha256)
       VALUES ('seed', NULL, 1, '{}', 'sha')`,
    ).run();
    db.prepare(
      `INSERT INTO PULSE_ACTUAL_SESSION (id, period_key, plan_version, state, started_at)
       VALUES (?, '2026-05-16', 1, 'in_progress', '2026-05-16T17:00:00Z')`,
    ).run("11111111-2222-3333-4444-555555555555");

    expect(() =>
      db
        .prepare(
          `INSERT INTO PULSE_PAIN_FLAG (actual_session_id, location_code, side, severity)
           VALUES (?, 'bogus_region', 'left', 'mild')`,
        )
        .run("11111111-2222-3333-4444-555555555555"),
    ).toThrow();
  });

  it("single-active partial index enforces one active plan", () => {
    db.prepare(
      `INSERT INTO PULSE_TRAINING_PLAN (created_by, change_summary, is_active, payload_json, payload_sha256)
       VALUES ('seed', NULL, 1, '{}', 'sha1')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO PULSE_TRAINING_PLAN (created_by, parent_version, change_summary, is_active, payload_json, payload_sha256)
           VALUES ('user', 1, 'second', 1, '{}', 'sha2')`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it("set_log cascade deletes when session removed", () => {
    db.prepare(
      `INSERT INTO PULSE_TRAINING_PLAN (created_by, change_summary, is_active, payload_json, payload_sha256)
       VALUES ('seed', NULL, 1, '{}', 'sha')`,
    ).run();
    db.prepare(
      `INSERT INTO PULSE_EXERCISE (id, display_de, movement_pattern, equipment_json)
       VALUES ('plank', 'Plank', 'core_anti_extension', '["bodyweight"]')`,
    ).run();
    db.prepare(
      `INSERT INTO PULSE_ACTUAL_SESSION (id, period_key, plan_version, state, started_at)
       VALUES (?, '2026-05-16', 1, 'completed', '2026-05-16T17:00:00Z')`,
    ).run("11111111-2222-3333-4444-555555555555");
    db.prepare(
      `INSERT INTO PULSE_SET_LOG (actual_session_id, exercise_id, set_idx, duration_sec)
       VALUES (?, 'plank', 1, 30)`,
    ).run("11111111-2222-3333-4444-555555555555");

    db.prepare(`DELETE FROM PULSE_ACTUAL_SESSION WHERE id = ?`).run(
      "11111111-2222-3333-4444-555555555555",
    );

    const remaining = db.prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM PULSE_SET_LOG`).get();
    expect(remaining?.c).toBe(0);
  });

  it("re-running migrations is a no-op", () => {
    const before = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM PULSE_MIGRATIONS`)
      .get();
    runMigrations(db);
    const after = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM PULSE_MIGRATIONS`)
      .get();
    expect(after?.c).toBe(before?.c);
  });
});
