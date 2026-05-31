import "server-only";

import { dispatch } from "../push/dispatcher";
import { recordSent, recordSuppression } from "./log";
import { gate } from "./policy";
import { render } from "./render";
import type { NotifyIntent, NotifyResult } from "./types";

/**
 * Single funnel — every notification path on the Pi ends here.
 *
 *   enrich (caller-side) → render → gate → dispatch → log
 *
 * `enrich` happens before this call: ingest routes pull whatever data the
 * renderer's fallback needs (meal row, sleep summary, verdict) and stuff
 * it into intent.context. Keeping enrichment outside `notify` lets us avoid
 * a circular dep web (the notifier doesn't need to know about queries).
 *
 * The function never throws on policy failures. It returns a structured
 * result that route handlers can log/forward to the client. Only true
 * infrastructure errors (web-push misconfig, etc.) produce { ok: false }.
 */
export async function notify(intent: NotifyIntent): Promise<NotifyResult> {
  const rendered = render(intent);
  if (!rendered) {
    // We have no body to write into the log. Stash the topic so settings
    // history can still show "render_failed" without leaving the user
    // guessing why nothing fired.
    const logId = recordSuppression({
      topic: intent.hint?.topic ?? intent.topic,
      title: "(no title)",
      body: "(render failed)",
      url: intent.url ?? "/",
      dedupeKey: intent.dedupeKey ?? `${intent.topic}:${intent.periodKey}`,
      reason: "render_failed",
    });
    return { ok: true, result: "suppressed", reason: "render_failed", logId };
  }

  const verdict = gate(intent, rendered);
  if (!verdict.send) {
    const logId = recordSuppression({
      topic: rendered.topic,
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      dedupeKey: rendered.dedupeKey,
      reason: verdict.reason,
    });
    return { ok: true, result: "suppressed", reason: verdict.reason, logId };
  }

  try {
    const result = await dispatch({
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      // The web-push dispatcher accepts a fixed union of topics for tag.
      // Cast is safe: the source-of-truth NotifyTopic and PushTopic share
      // values (see lib/push/dispatcher.ts).
      topic: rendered.topic as never,
      // Forwarded as the SW `tag` so repeat sends collapse visually.
      tag: rendered.dedupeKey,
      ttlSeconds: rendered.ttlMinutes * 60,
    });
    const logId = recordSent({
      rendered,
      sent: result.sent,
      pruned: result.pruned,
      failed: result.failed,
      payloadSize:
        rendered.title.length + rendered.body.length + rendered.url.length,
    });
    return {
      ok: true,
      result: "sent",
      sent: result.sent,
      pruned: result.pruned,
      failed: result.failed,
      logId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
