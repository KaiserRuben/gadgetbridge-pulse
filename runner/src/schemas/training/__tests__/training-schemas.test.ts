/**
 * Phase A round-trip: each training schema must (a) parse as JSON, (b)
 * compile in Ajv with formats, and (c) validate a hand-built fixture that
 * exercises the non-trivial fields. Catches accidental enum drift between
 * the schema and the M008 migration's CHECK constraints.
 */

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import {
  trainingPlanSchema,
  exerciseSchema,
  plannedSessionSchema,
  actualSessionSchema,
  setLogSchema,
  painFlagSchema,
  adjustmentProposalSchema,
  trainingInsightSchema,
  chatMessageSchema,
} from "../index.ts";

function buildAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(trainingPlanSchema, "training-plan.schema.json");
  ajv.addSchema(exerciseSchema, "exercise.schema.json");
  ajv.addSchema(plannedSessionSchema, "planned-session.schema.json");
  ajv.addSchema(actualSessionSchema, "actual-session.schema.json");
  ajv.addSchema(setLogSchema, "set-log.schema.json");
  ajv.addSchema(painFlagSchema, "pain-flag.schema.json");
  ajv.addSchema(adjustmentProposalSchema, "adjustment-proposal.schema.json");
  ajv.addSchema(trainingInsightSchema, "training-insight.schema.json");
  ajv.addSchema(chatMessageSchema, "chat-message.schema.json");
  return ajv;
}

const ajv = buildAjv();

describe("training schemas — compile + fixture round-trip", () => {
  it("plan: minimum valid document compiles + validates", () => {
    const validate = ajv.compile(trainingPlanSchema);
    const doc = {
      schema_version: "training/plan/v1",
      name: "Test plan",
      status: "active",
      created_at: "2026-05-16T00:00:00Z",
      current_phase_id: "phase_1",
      phases: [
        {
          id: "phase_1",
          label: "Phase 1",
          session_templates: [
            {
              id: "phase1_a",
              label: "Day A",
              exercises: [
                {
                  exercise_id: "goblet_squat",
                  order_idx: 0,
                  prescription: { sets: 3, reps_min: 10, reps_max: 10 },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it("plan: injury_protocol references LocationCode via $ref", () => {
    const validate = ajv.compile(trainingPlanSchema);
    const doc = {
      schema_version: "training/plan/v1",
      name: "P",
      status: "active",
      created_at: "2026-05-16T00:00:00Z",
      current_phase_id: "p1",
      phases: [{ id: "p1", label: "P1", session_templates: [] }],
      injury_protocol: [
        {
          symptom: "Knee pain",
          action: "Stop session",
          trigger_location_codes: ["knee"],
          severity: "warn",
        },
      ],
    };
    expect(validate(doc)).toBe(true);

    const bad = { ...doc, injury_protocol: [{ ...doc.injury_protocol[0], trigger_location_codes: ["bogus_region"] }] };
    expect(validate(bad)).toBe(false);
  });

  it("exercise: movement_pattern + equipment enums enforced", () => {
    const validate = ajv.compile(exerciseSchema);
    expect(
      validate({
        schema_version: "training/exercise/v1",
        id: "goblet_squat",
        display_de: "Goblet Squat",
        movement_pattern: "squat",
        equipment: ["dumbbell"],
      }),
    ).toBe(true);
    expect(
      validate({
        schema_version: "training/exercise/v1",
        id: "x",
        display_de: "x",
        movement_pattern: "bogus",
        equipment: ["dumbbell"],
      }),
    ).toBe(false);
  });

  it("exercise: id must be lower_snake_case", () => {
    const validate = ajv.compile(exerciseSchema);
    expect(
      validate({
        schema_version: "training/exercise/v1",
        id: "Goblet-Squat",
        display_de: "x",
        movement_pattern: "squat",
        equipment: ["dumbbell"],
      }),
    ).toBe(false);
  });

  it("actual_session: state + deviation_reason enums", () => {
    const validate = ajv.compile(actualSessionSchema);
    expect(
      validate({
        schema_version: "training/actual_session/v1",
        id: "11111111-2222-3333-4444-555555555555",
        period_key: "2026-05-16",
        plan_version: 1,
        state: "in_progress",
        started_at: "2026-05-16T17:00:00Z",
        deviation_reason: "user_choice",
      }),
    ).toBe(true);
    expect(
      validate({
        schema_version: "training/actual_session/v1",
        id: "11111111-2222-3333-4444-555555555555",
        period_key: "2026-05-16",
        plan_version: 1,
        state: "wibble",
        started_at: "2026-05-16T17:00:00Z",
      }),
    ).toBe(false);
  });

  it("set_log: nullable variant fields", () => {
    const validate = ajv.compile(setLogSchema);
    expect(
      validate({
        schema_version: "training/set_log/v1",
        id: 1,
        actual_session_id: "11111111-2222-3333-4444-555555555555",
        exercise_id: "goblet_squat",
        set_idx: 1,
        reps: 10,
        weight_kg: 16,
        rpe: 6.5,
        logged_at: "2026-05-16T17:05:00Z",
      }),
    ).toBe(true);
    expect(
      validate({
        schema_version: "training/set_log/v1",
        id: 2,
        actual_session_id: "11111111-2222-3333-4444-555555555555",
        exercise_id: "dead_hang",
        set_idx: 1,
        duration_sec: 25,
        logged_at: "2026-05-16T17:30:00Z",
      }),
    ).toBe(true);
  });

  it("pain_flag: location_code + side + severity enums", () => {
    const validate = ajv.compile(painFlagSchema);
    expect(
      validate({
        schema_version: "training/pain_flag/v1",
        id: 1,
        actual_session_id: "11111111-2222-3333-4444-555555555555",
        location_code: "knee",
        side: "left",
        severity: "mild",
        free_text: "leichter Druck nach 2. Satz",
        raised_at: "2026-05-16T17:10:00Z",
      }),
    ).toBe(true);
    expect(
      validate({
        schema_version: "training/pain_flag/v1",
        id: 2,
        actual_session_id: "11111111-2222-3333-4444-555555555555",
        location_code: "left_knee",
        side: "left",
        severity: "mild",
        raised_at: "2026-05-16T17:10:00Z",
      }),
    ).toBe(false);
  });

  it("adjustment_proposal: diff + citation shape", () => {
    const validate = ajv.compile(adjustmentProposalSchema);
    expect(
      validate({
        schema_version: "training/adjustment_proposal/v1",
        id: 1,
        generated_at: "2026-05-17T09:00:00Z",
        target_plan_version: 1,
        scope: "exercise",
        diff: [
          {
            op: "set",
            path: "/phases/0/session_templates/0/exercises/0/prescription/load_kg_min",
            before: 12,
            after: 14,
            human_de: "Goblet Squat von 12 auf 14 kg",
          },
        ],
        reasoning_trace: "RPE 6 over 2 sessions, no symptom.",
        cited_data: [{ kind: "set_log", ref_id: "42", summary: "RPE 6 @ 12 kg" }],
        status: "pending",
      }),
    ).toBe(true);
  });

  it("training_insight: kind + confidence required", () => {
    const validate = ajv.compile(trainingInsightSchema);
    expect(
      validate({
        schema_version: "training/insight/v1",
        kind: "prescription",
        period_key: "2026-05-16",
        language: "de",
        abstain: false,
        confidence: { value: 0.75 },
        prescription: {
          suggested_session_template_id: "phase1_a",
          justification_de: "HRV 78 ms, gut für volle Session.",
        },
      }),
    ).toBe(true);
  });

  it("chat_message: status + role enums", () => {
    const validate = ajv.compile(chatMessageSchema);
    expect(
      validate({
        schema_version: "training/chat_message/v1",
        id: 1,
        thread_id: "11111111-2222-3333-4444-555555555555",
        role: "user",
        created_at: "2026-05-16T20:00:00Z",
        status: "queued",
        content: "Soll ich heute Tag B machen, Rücken fühlt sich angespannt an?",
      }),
    ).toBe(true);
  });
});
