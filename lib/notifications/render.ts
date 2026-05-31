import "server-only";

import type {
  NotifyHint,
  NotifyIntent,
  NotifyTopic,
  RenderedPush,
} from "./types";

/**
 * Render an intent into the final {title, body, url, topic} payload.
 *
 * Two paths:
 *   1. `intent.hint` is present AND passes the language guard
 *      (no '!', no emoji, length sane) — use it verbatim.
 *   2. Otherwise, build deterministic German prose from `intent.context`
 *      per-topic. The fallback never exclaims, never emoji-flair, never
 *      imperative ("Trink mehr!"). Observational, terse.
 *
 * Either path can fail (e.g. fallback has no context). Returns null in that
 * case — the caller suppresses with reason='render_failed'.
 */

const TITLE_MAX = 40;
const BODY_MAX = 90;
const FORBIDDEN_TITLE = /[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function isValidHint(hint: NotifyHint): boolean {
  if (!hint.title || !hint.body) return false;
  if (hint.title.length > TITLE_MAX) return false;
  if (hint.body.length > BODY_MAX) return false;
  if (FORBIDDEN_TITLE.test(hint.title)) return false;
  if (FORBIDDEN_TITLE.test(hint.body)) return false;
  if (!hint.url || !hint.url.startsWith("/")) return false;
  return true;
}

function defaultUrl(topic: NotifyTopic, intent: NotifyIntent): string {
  if (intent.url) return intent.url;
  switch (topic) {
    case "meal_classified":
      return `/nutrition`;
    case "day_finalized":
      return `/day/${intent.periodKey}`;
    case "sleep_complete":
      return `/sleep`;
    case "workout_complete":
      return `/workouts`;
    case "pattern_detected":
      return `/explore`;
    case "safety_anomaly":
      return `/log`;
    case "coach_quote":
      return `/coach`;
    case "test":
      return `/`;
  }
}

function defaultDedupeKey(topic: NotifyTopic, intent: NotifyIntent): string {
  return intent.dedupeKey ?? `${topic}:${intent.periodKey}`;
}

/**
 * Deterministic fallback prose per topic. German, observational.
 * Returns null when context is too thin to compose anything sensible —
 * caller should skip rather than ship a content-less push.
 */
function fallback(
  topic: NotifyTopic,
  ctx: Record<string, unknown>,
): { title: string; body: string } | null {
  switch (topic) {
    case "meal_classified": {
      const name = pickStr(ctx, "name");
      const kcal = pickNum(ctx, "kcal");
      const protein = pickNum(ctx, "protein_g");
      if (!name) return null;
      const body =
        kcal != null && protein != null
          ? `${name} · ${Math.round(kcal)} kcal · ${Math.round(protein)} g Protein`
          : name;
      return { title: "Mahlzeit erkannt", body: clamp(body, BODY_MAX) };
    }
    case "day_finalized": {
      const headline = pickStr(ctx, "headline");
      const nextAction = pickStr(ctx, "next_action");
      const rating = pickStr(ctx, "rating");
      const title = headline ? clamp(headline, TITLE_MAX) : "Tag fertig";
      const body =
        nextAction ?? (rating ? `Tag bewertet: ${rating}` : "Zusammenfassung verfügbar.");
      return { title, body: clamp(body, BODY_MAX) };
    }
    case "sleep_complete": {
      const total = pickNum(ctx, "total_min");
      const deep = pickNum(ctx, "deep_min");
      const rem = pickNum(ctx, "rem_min");
      if (total == null) return null;
      const h = Math.floor(total / 60);
      const m = total % 60;
      const parts: string[] = [];
      if (deep != null) parts.push(`Tief ${deep}min`);
      if (rem != null) parts.push(`REM ${rem}min`);
      return {
        title: `Schlaf ${h}h ${m}min`,
        body: parts.length > 0 ? parts.join(" · ") : "Schlaf-Daten verfügbar.",
      };
    }
    case "workout_complete": {
      const type = pickStr(ctx, "type") ?? "Workout";
      const km = pickNum(ctx, "distance_km");
      const kcal = pickNum(ctx, "kcal");
      const title = km != null ? `${type} ${km.toFixed(1)} km` : type;
      const body =
        kcal != null ? `Aktiv ${Math.round(kcal)} kcal` : "Workout aufgezeichnet.";
      return { title: clamp(title, TITLE_MAX), body: clamp(body, BODY_MAX) };
    }
    case "pattern_detected": {
      const label = pickStr(ctx, "label");
      const count = pickNum(ctx, "occurrence_count");
      if (!label) return null;
      return {
        title: clamp(label, TITLE_MAX),
        body: count != null ? `${count} Vorkommen erkannt.` : "Neues Muster erkannt.",
      };
    }
    case "safety_anomaly": {
      const text = pickStr(ctx, "text");
      return {
        title: "Hinweis",
        body: clamp(text ?? "Auffälliger Wert erkannt.", BODY_MAX),
      };
    }
    case "coach_quote": {
      const text = pickStr(ctx, "text");
      const author = pickStr(ctx, "author");
      if (!text) return null;
      return {
        title: author ? clamp(author, TITLE_MAX) : "Coach",
        body: clamp(text, BODY_MAX),
      };
    }
    case "test":
      return { title: "Pulse Test", body: "Push funktioniert." };
  }
}

function pickStr(ctx: Record<string, unknown>, key: string): string | null {
  const v = ctx[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNum(ctx: Record<string, unknown>, key: string): number | null {
  const v = ctx[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  // Trim at word boundary if possible; ellipsis otherwise.
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max - 12 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function render(intent: NotifyIntent): RenderedPush | null {
  const topic = intent.hint?.topic ?? intent.topic;

  if (intent.hint && isValidHint(intent.hint)) {
    return {
      title: intent.hint.title,
      body: intent.hint.body,
      url: intent.hint.url,
      topic,
      dedupeKey: intent.hint.dedupeKey ?? defaultDedupeKey(topic, intent),
      ttlMinutes: intent.hint.ttlMinutes ?? 60,
      priority: intent.hint.priority ?? intent.priority ?? "normal",
    };
  }

  const fb = fallback(topic, intent.context ?? {});
  if (!fb) return null;

  return {
    title: fb.title,
    body: fb.body,
    url: defaultUrl(topic, intent),
    topic,
    dedupeKey: defaultDedupeKey(topic, intent),
    ttlMinutes: 60,
    priority: intent.priority ?? "normal",
  };
}
