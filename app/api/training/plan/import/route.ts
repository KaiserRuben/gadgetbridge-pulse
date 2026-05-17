import { NextResponse } from "next/server";

import {
  planTableIsEmpty,
  readActivePlan,
  writePlanVersion,
} from "@/lib/training/plan";
import { upsertExercises } from "@/lib/training/exercise";
import { buildReconditioning2026 } from "@/lib/training/plan-builder";
import { loadSeedExercises } from "@/lib/training/seed-exercises";
import {
  validateTrainingPlan,
  validateExercise,
} from "@/lib/training/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/plan/import
 *
 * Idempotent seed import:
 *   - Always upserts the seed exercise library (safe to repeat).
 *   - Inserts plan_v1 only when PULSE_TRAINING_PLAN is empty.
 *
 * Body is ignored — the import payload is hard-coded in
 * `lib/training/plan-builder.ts` (the one-shot MD → JSON converter). Subsequent
 * plan edits go through the proposal-accept flow, never this endpoint.
 */
export async function POST() {
  const exercises = loadSeedExercises();
  for (const ex of exercises) {
    const v = validateExercise(ex);
    if (!v.ok) {
      return NextResponse.json(
        { error: `seed exercise ${ex.id} invalid: ${v.errors.join("; ")}` },
        { status: 500 },
      );
    }
  }
  const exerciseCount = upsertExercises(exercises);

  if (!planTableIsEmpty()) {
    const active = readActivePlan();
    return NextResponse.json({
      ok: true,
      mode: "exercises_only",
      exercise_count: exerciseCount,
      active_version: active?.version ?? null,
      message: "plan already imported; exercise library upserted",
    });
  }

  const plan = buildReconditioning2026();
  const v = validateTrainingPlan(plan);
  if (!v.ok) {
    return NextResponse.json(
      { error: `built plan invalid: ${v.errors.slice(0, 5).join("; ")}` },
      { status: 500 },
    );
  }
  const version = writePlanVersion({
    payload: plan,
    created_by: "seed",
    parent_version: null,
    change_summary: null,
    set_active: true,
  });
  return NextResponse.json({
    ok: true,
    mode: "imported",
    exercise_count: exerciseCount,
    version,
    plan_name: plan.name,
  });
}
