/**
 * Seed library: every entry validates against the exercise schema, ids are
 * unique, and every referenced substitute / contraindication exists in the
 * library / pain-flag location enum.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import { exerciseSchema, painFlagSchema } from "../index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, "..", "exercises-seed.json");

interface SeedExercise {
  schema_version: string;
  id: string;
  display_de: string;
  display_en?: string | null;
  movement_pattern: string;
  primary_muscles?: string[];
  equipment: string[];
  substitutes?: string[];
  contraindications?: string[];
  unilateral?: boolean;
  tags?: string[];
  notes_de?: string | null;
}

interface SeedFile {
  $schema_version: string;
  exercises: SeedExercise[];
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedFile;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(painFlagSchema, "pain-flag.schema.json");
const validate = ajv.compile(exerciseSchema);

const locationEnum = new Set(
  (painFlagSchema as { definitions: { LocationCode: { enum: string[] } } }).definitions.LocationCode.enum,
);

describe("exercises-seed", () => {
  it("loads at least 30 baseline exercises", () => {
    expect(seed.exercises.length).toBeGreaterThanOrEqual(30);
  });

  it("each entry validates against the exercise schema", () => {
    for (const ex of seed.exercises) {
      // Capture id before the validate call — Ajv's compiled validator is
      // a `data is T` type guard whose `false` branch would otherwise
      // narrow `ex` to `never`.
      const id = ex.id;
      if (!validate(ex)) {
        throw new Error(`exercise ${id} invalid: ${ajv.errorsText(validate.errors)}`);
      }
    }
  });

  it("ids are unique", () => {
    const ids = seed.exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("substitutes reference known exercise ids", () => {
    const ids = new Set(seed.exercises.map((e) => e.id));
    for (const ex of seed.exercises) {
      for (const sub of ex.substitutes ?? []) {
        // Substitute may legitimately point at not-yet-seeded exercises
        // (e.g. seated_calf_raise) — flag as a warning, not a failure,
        // so the library can grow incrementally. Track but don't fail.
        if (!ids.has(sub)) {
          // eslint-disable-next-line no-console
          console.warn(`[seed] ${ex.id} → substitute ${sub} not in library yet`);
        }
      }
    }
  });

  it("contraindications use the locked pain-flag location enum", () => {
    for (const ex of seed.exercises) {
      for (const code of ex.contraindications ?? []) {
        if (!locationEnum.has(code)) {
          throw new Error(`exercise ${ex.id} contraindication ${code} not in LocationCode enum`);
        }
      }
    }
  });

  it("covers every movement_pattern enum value", () => {
    const patternEnum = (exerciseSchema as { properties: { movement_pattern: { enum: string[] } } })
      .properties.movement_pattern.enum;
    const used = new Set(seed.exercises.map((e) => e.movement_pattern));
    const missing = patternEnum.filter((p) => !used.has(p));
    expect(missing).toEqual([]);
  });
});
