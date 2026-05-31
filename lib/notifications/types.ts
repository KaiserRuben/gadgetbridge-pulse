import "server-only";

/**
 * Notification types shared between the runner-side ingest contract and the
 * Pi-side dispatch funnel.
 *
 * A NotifyIntent is the platonic intent ("a meal was classified, here is the
 * data the user should see"). Authoring may produce a NotifyHint inline
 * (LLM-authored title/body) or leave it absent (deterministic fallback in
 * render.ts runs against enriched context).
 *
 * Everything flows through notifier.notify(intent) on the Pi. That funnel
 * applies the policy gate (topic enabled, dedupe, quiet hours, budget) and
 * records every attempt — sent or suppressed — in PULSE_PUSH_LOG.
 */

export type NotifyTopic =
  | "meal_classified"
  | "day_finalized"
  | "sleep_complete"
  | "workout_complete"
  | "pattern_detected"
  | "safety_anomaly"
  | "coach_quote"
  | "test";

export type NotifyPriority = "low" | "normal" | "high";

/**
 * Inline-authored fields the runner can attach to an ingest write. Optional —
 * the Pi-side renderer will synthesise a fallback from enriched context if
 * the hint is absent or fails the language guard (no '!', no emoji, length).
 */
export interface NotifyHint {
  topic: NotifyTopic;
  title: string;
  body: string;
  /** Deep link the notification opens. Path-only (no host). */
  url: string;
  /** Stable per-event key. Same key in last hour → suppressed. */
  dedupeKey: string;
  /** Override the dispatcher's default TTL (default 60). */
  ttlMinutes?: number;
  /** Low respects quiet hours strictly; high bypasses (safety only). */
  priority?: NotifyPriority;
}

/**
 * Full intent the Pi's notifier consumes. ALL paths converge here.
 *
 * - `hint`     — author-supplied (LLM or deterministic on the runner side)
 * - `context`  — Pi-side enrichment data (meal row, verdict, sleep summary)
 *
 * Either or both may be set: if `hint` is missing or invalid the renderer
 * uses `context` to build a fallback. If both are present, `hint` wins but
 * the renderer can still sanity-check against `context`.
 */
export interface NotifyIntent {
  topic: NotifyTopic;
  /** Period the event belongs to (YYYY-MM-DD for daily). */
  periodKey: string;
  /** Optional inline hint. Authored on the runner side. */
  hint?: NotifyHint;
  /** Free-form enrichment payload used by the fallback renderer. */
  context?: Record<string, unknown>;
  /** Pre-built deep link override (if neither hint.url nor renderer default). */
  url?: string;
  /** Pre-built dedupe key override (else derived from topic+periodKey). */
  dedupeKey?: string;
  /** Priority hint, default "normal". */
  priority?: NotifyPriority;
}

export interface RenderedPush {
  title: string;
  body: string;
  url: string;
  topic: NotifyTopic;
  dedupeKey: string;
  ttlMinutes: number;
  priority: NotifyPriority;
}

export type SuppressionReason =
  | "topic_off"
  | "no_subscriptions"
  | "dedup"
  | "quiet_hours"
  | "budget"
  | "render_failed"
  | "consent_missing";

export type NotifyResult =
  | {
      ok: true;
      result: "sent";
      sent: number;
      pruned: number;
      failed: number;
      logId: number;
    }
  | {
      ok: true;
      result: "suppressed";
      reason: SuppressionReason;
      logId: number;
    }
  | {
      ok: false;
      error: string;
    };
