/**
 * Cross-slot smoke tests:
 *   1. Schema files load + Ajv compiles them.
 *   2. Slot registry stays aligned with types' SlotId tuples.
 *   3. Every slot's validator rejects an obviously broken payload.
 *
 * Per-slot positive cases live in each slot's own __tests__ dir.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  ALL_SLOT_IDS,
  DAILY_SLOT_IDS,
  WEEKLY_SLOT_IDS,
  EVENT_SLOT_IDS,
} from "../types.ts";
import { DAILY_SLOTS, WEEKLY_SLOTS, EVENT_SLOTS, ALL_SLOTS } from "../slots/_registry.ts";

const SCHEMAS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
);

const SLOT_FILES = [
  "slot-night-review.schema.json",
  "slot-morning-briefing.schema.json",
  "slot-midday-check.schema.json",
  "slot-evening-review.schema.json",
  "slot-day-synthesis.schema.json",
  "slot-post-workout.schema.json",
  "slot-anomaly-explain.schema.json",
  "slot-week-synthesis.schema.json",
];

describe("v4 slot schemas", () => {
  it("compiles every slot schema under Ajv 2020", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const file of SLOT_FILES) {
      const schemaPath = path.join(SCHEMAS_DIR, file);
      const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
      const validator = ajv.compile(schema);
      expect(validator).toBeTypeOf("function");
    }
  });

  it("rejects an empty payload for every slot", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const file of SLOT_FILES) {
      const schemaPath = path.join(SCHEMAS_DIR, file);
      const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
      const validator = ajv.compile(schema);
      expect(validator({})).toBe(false);
    }
  });
});

describe("v4 slot registry", () => {
  it("registry slot_ids match types.ts ALL_SLOT_IDS", () => {
    const registryIds = ALL_SLOTS.map((s) => s.slot_id).sort();
    const typeIds = [...ALL_SLOT_IDS].sort();
    expect(registryIds).toEqual(typeIds);
  });

  it("daily registry matches DAILY_SLOT_IDS", () => {
    const registryIds = DAILY_SLOTS.map((s) => s.slot_id).sort();
    const typeIds = [...DAILY_SLOT_IDS].sort();
    expect(registryIds).toEqual(typeIds);
  });

  it("weekly registry matches WEEKLY_SLOT_IDS", () => {
    const registryIds = WEEKLY_SLOTS.map((s) => s.slot_id).sort();
    const typeIds = [...WEEKLY_SLOT_IDS].sort();
    expect(registryIds).toEqual(typeIds);
  });

  it("event registry matches EVENT_SLOT_IDS", () => {
    const registryIds = EVENT_SLOTS.map((s) => s.slot_id).sort();
    const typeIds = [...EVENT_SLOT_IDS].sort();
    expect(registryIds).toEqual(typeIds);
  });

  it("every depends_on references a known slot_id", () => {
    const known = new Set(ALL_SLOTS.map((s) => s.slot_id));
    for (const slot of ALL_SLOTS) {
      for (const dep of slot.depends_on) {
        expect(known.has(dep)).toBe(true);
      }
    }
  });

  it("daily slots have local_time on default_schedule", () => {
    for (const slot of DAILY_SLOTS) {
      expect(slot.default_schedule.local_time).toBeTypeOf("string");
    }
  });

  it("event slots are auto_schedule=false", () => {
    for (const slot of EVENT_SLOTS) {
      expect(slot.auto_schedule).toBe(false);
    }
  });
});
