import "server-only";

import type {
  TrainingExerciseV1,
  TrainingPlanV1,
} from "../types/generated";
import { readPlanVersion } from "./plan";
import { listExercises } from "./exercise";
import { lastTimeByExercise, type LastTimeSet } from "./last-time";
import { listPainForSession, type PainFlagRow } from "./pain";
import { listSetsForSession, type SetLogRow } from "./set-log";
import { readSession, type SessionRow } from "./session";

/**
 * Bundle every piece the in-session page needs in one server-side function.
 * Keeps the runner shell small and avoids N+1 between client and server.
 */

type SessionTemplate = NonNullable<
  TrainingPlanV1["phases"][number]["session_templates"]
>[number];

export interface SessionViewBundle {
  session: SessionRow;
  template: SessionTemplate | null;
  /** Exercises referenced by the template, in template order. */
  prescribed: Array<{
    exercise: TrainingExerciseV1;
    prescription: SessionTemplate["exercises"][number]["prescription"];
    notes: string | null;
    order_idx: number;
    warmup_only: boolean;
  }>;
  /** Free-pick fallback when session has no template (deviation). */
  freePickAllowed: boolean;
  sets: SetLogRow[];
  pain: PainFlagRow[];
  lastTime: Record<string, LastTimeSet[]>;
  exerciseLibrary: TrainingExerciseV1[];
}

export function loadSessionView(id: string): SessionViewBundle | null {
  const session = readSession(id);
  if (!session) return null;

  const planRow = readPlanVersion(session.plan_version);
  const template =
    planRow && session.session_template_id
      ? findTemplate(planRow.payload, session.session_template_id)
      : null;

  const library = listExercises();
  const libIndex = new Map(library.map((e) => [e.id, e]));

  const prescribed = template
    ? template.exercises.map((ex) => {
        const libEntry =
          libIndex.get(ex.exercise_id) ??
          ({
            schema_version: "training/exercise/v1",
            id: ex.exercise_id,
            display_de: ex.exercise_id,
            movement_pattern: "isolation_upper",
            equipment: ["other"],
          } as TrainingExerciseV1);
        return {
          exercise: libEntry,
          prescription: ex.prescription,
          notes: ex.notes ?? null,
          order_idx: ex.order_idx,
          warmup_only: Boolean(ex.warmup_only),
        };
      })
    : [];

  const exerciseIds = prescribed.map((p) => p.exercise.id);
  const lastTime = lastTimeByExercise(exerciseIds, { excludeSessionId: id });

  return {
    session,
    template,
    prescribed,
    freePickAllowed: !template,
    sets: listSetsForSession(id),
    pain: listPainForSession(id),
    lastTime,
    exerciseLibrary: library,
  };
}

function findTemplate(
  plan: TrainingPlanV1,
  templateId: string,
): SessionTemplate | null {
  for (const phase of plan.phases) {
    const t = phase.session_templates.find((x) => x.id === templateId);
    if (t) return t;
  }
  return null;
}
