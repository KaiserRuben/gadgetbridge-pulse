import { cn } from "@/lib/cn";
import type { PushLogRow } from "@/lib/notifications/log";

interface Props {
  rows: PushLogRow[];
}

const RESULT_LABEL: Record<string, string> = {
  sent: "Gesendet",
  suppressed: "Unterdrückt",
  failed: "Fehler",
};

const REASON_LABEL: Record<string, string> = {
  topic_off: "Topic deaktiviert",
  no_subscriptions: "Keine aktiven Geräte",
  dedup: "Doppelt",
  quiet_hours: "Ruhezeit",
  budget: "Tageslimit erreicht",
  render_failed: "Inhalt zu dünn",
  consent_missing: "Keine Erlaubnis",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Transparency log: every fire and every suppression in the last N. The
 * "Why" column matters as much as the "What" — when a notification was
 * suppressed, the user gets a one-word reason instead of silence.
 */
export function NotificationHistoryList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 p-4">
        <p className="text-body-sm text-muted">Noch keine Aktivität.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 overflow-hidden">
      <ul className="divide-y divide-border/40">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 p-3">
            <div
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                r.result === "sent" ? "bg-foreground" : "bg-muted/60",
              )}
            />
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body-sm font-medium truncate">{r.title}</span>
                <span className="text-caption text-muted tabular-nums shrink-0">
                  {fmtTime(r.sent_at)}
                </span>
              </div>
              <span className="text-caption text-muted truncate">{r.body}</span>
              <span className="text-caption text-muted">
                {RESULT_LABEL[r.result] ?? r.result}
                {r.suppression_reason
                  ? ` · ${REASON_LABEL[r.suppression_reason] ?? r.suppression_reason}`
                  : ""}
                {r.result === "sent" && r.sent_count > 0
                  ? ` · ${r.sent_count} Gerät${r.sent_count === 1 ? "" : "e"}`
                  : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
