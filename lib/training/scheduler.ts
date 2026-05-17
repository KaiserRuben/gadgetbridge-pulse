import "server-only";

import type { TrainingPlanV1 } from "../types/generated";

/**
 * Deterministic "what should the user do today" suggestion. Pure function
 * over the active plan + a `Date`. Used by the /training landing page and
 * (later) by the v3 training-prescription packager as a baseline before
 * the LLM frames the justification.
 *
 * The schedule comes from `current_phase.schedule_hint.weekly_pattern[dow]`,
 * which is a 7-element array Mon..Sun. Falls back to the first available
 * strength template when a phase has no schedule_hint (later phases ship
 * without one — `phase_2` / `phase_3` in the seed).
 */

export type SuggestedSlot =
  | { kind: "session_template"; phase_id: string; session_template_id: string }
  | { kind: "cardio"; phase_id: string }
  | { kind: "rest"; phase_id: string }
  | { kind: "flex"; phase_id: string }
  | { kind: "no_plan" }
  | { kind: "no_active_phase"; phase_id: string };

interface SuggestOpts {
  /** Defaults to now. Caller passes a date in the user's local TZ via Intl. */
  now?: Date;
  /** Override 0-6 Mon-Sun. Used by tests. */
  weekdayOverride?: number;
}

/** Mon=0..Sun=6. JS Date.getDay() returns Sun=0..Sat=6, so re-map. */
function mondayBasedDow(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone });
  const wk = fmt.format(d);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wk] ?? 0;
}

const DEFAULT_TZ = "Europe/Berlin";

export function suggestTodaySession(
  plan: TrainingPlanV1 | null,
  opts: SuggestOpts = {},
): SuggestedSlot {
  if (!plan) return { kind: "no_plan" };
  const phase = plan.phases.find((p) => p.id === plan.current_phase_id);
  if (!phase) return { kind: "no_active_phase", phase_id: plan.current_phase_id };

  const dow =
    opts.weekdayOverride ?? mondayBasedDow(opts.now ?? new Date(), DEFAULT_TZ);

  const pattern = phase.schedule_hint?.weekly_pattern;
  let slot: string | undefined = pattern?.[dow];

  // Fallback when the active phase has no schedule_hint yet (phase 2 / 3
  // in the seed): cycle through whatever session templates are defined,
  // mapping consecutive weekdays to consecutive templates and treating
  // gaps as `flex` so the picker still shows everything.
  if (!slot && phase.session_templates.length > 0) {
    const t = phase.session_templates[dow % phase.session_templates.length];
    slot = t.id;
  }

  if (!slot) return { kind: "flex", phase_id: phase.id };
  if (slot === "rest") return { kind: "rest", phase_id: phase.id };
  if (slot === "cardio") return { kind: "cardio", phase_id: phase.id };
  if (slot === "flex") return { kind: "flex", phase_id: phase.id };

  // It's a session_template_id — verify it exists in this phase.
  const tmpl = phase.session_templates.find((t) => t.id === slot);
  if (!tmpl) return { kind: "flex", phase_id: phase.id };

  return {
    kind: "session_template",
    phase_id: phase.id,
    session_template_id: tmpl.id,
  };
}

/**
 * Helper for the picker UI: list every concrete session template defined
 * by the active phase, plus the generic cardio / rest / flex slots so the
 * user can deviate explicitly without inventing one off-plan.
 */
export type PickerOption = {
  kind: SuggestedSlot["kind"];
  session_template_id: string | null;
  label: string;
};

export function listPickerOptions(plan: TrainingPlanV1 | null): PickerOption[] {
  if (!plan) return [];
  const phase = plan.phases.find((p) => p.id === plan.current_phase_id);
  if (!phase) return [];
  const out: PickerOption[] = phase.session_templates.map((t) => ({
    kind: "session_template" as const,
    session_template_id: t.id,
    label: t.label,
  }));
  out.push({ kind: "cardio", session_template_id: null, label: "Cardio" });
  out.push({ kind: "rest", session_template_id: null, label: "Pause" });
  out.push({ kind: "flex", session_template_id: null, label: "Andere Übung" });
  return out;
}
