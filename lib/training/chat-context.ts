import "server-only";

import { readActivePlan } from "./plan";
import { listSessions } from "./session";
import { listSetsForSession } from "./set-log";
import { listPainForSession } from "./pain";

export interface ChatContextBundle {
  plan: {
    version: number | null;
    name: string | null;
    current_phase_id: string | null;
    current_phase_label: string | null;
    constraints: string[];
  };
  recent_sessions: Array<{
    id: string;
    period_key: string;
    state: string;
    session_template_id: string | null;
    started_at: string;
    completed_at: string | null;
    set_count: number;
    rpe_max: number | null;
    pain_locations: string[];
  }>;
  recent_pain_flags: Array<{
    raised_at: string;
    location_code: string;
    side: string;
    severity: string;
    free_text: string | null;
  }>;
  generated_at: string;
}

const RECENT_WINDOW_DAYS = 7;

/**
 * Build the frozen context bundle attached to a chat message. The bundle
 * is persisted on the user row (`context_snapshot_json`) so a queued
 * message still answers about the state-at-send when the remote model
 * eventually picks it up — even if the plan / sessions have since changed.
 *
 * Kept compact (the chat prompt is conversational, not analytical): no
 * full plan payload, no exercise library — just labels + recent activity.
 */
export function buildChatContext(): ChatContextBundle {
  const active = readActivePlan();
  const sessions = listSessions({ limit: 30 });
  const recent = sessions.slice(0, 10);

  const sessionSummaries = recent.map((s) => {
    const sets = listSetsForSession(s.id);
    const pain = listPainForSession(s.id);
    return {
      id: s.id,
      period_key: s.period_key,
      state: s.state,
      session_template_id: s.session_template_id,
      started_at: s.started_at,
      completed_at: s.completed_at,
      set_count: sets.length,
      rpe_max: sets.reduce<number | null>(
        (acc, x) => (x.rpe == null ? acc : Math.max(acc ?? 0, x.rpe)),
        null,
      ),
      pain_locations: Array.from(new Set(pain.map((p) => p.location_code))),
    };
  });

  // Recent pain flags across all sessions in the window.
  const cutoffIso = new Date(
    Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recentPain = sessions
    .filter((s) => s.started_at >= cutoffIso)
    .flatMap((s) => listPainForSession(s.id))
    .sort((a, b) => b.raised_at.localeCompare(a.raised_at))
    .slice(0, 10)
    .map((p) => ({
      raised_at: p.raised_at,
      location_code: p.location_code,
      side: p.side,
      severity: p.severity,
      free_text: p.free_text,
    }));

  const phase = active?.payload.phases.find((p) => p.id === active.payload.current_phase_id) ?? null;
  return {
    plan: {
      version: active?.version ?? null,
      name: active?.payload.name ?? null,
      current_phase_id: active?.payload.current_phase_id ?? null,
      current_phase_label: phase?.label ?? null,
      constraints: active?.payload.global_constraints ?? [],
    },
    recent_sessions: sessionSummaries,
    recent_pain_flags: recentPain,
    generated_at: new Date().toISOString(),
  };
}
