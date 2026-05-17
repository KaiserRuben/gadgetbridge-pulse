import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import type { AlarmEvent } from "@/lib/types/generated";
import { alarmTargetUrl } from "@/lib/alarm-target";

export function AnomalyInbox({
  events,
  hint,
}: {
  events: AlarmEvent[];
  hint?: string;
}) {
  const top = events.slice(0, 4);
  if (top.length === 0) {
    return (
      <Card variant="soft" className="h-full">
        <CardBody className="p-5 flex flex-col gap-3 h-full">
          <Eyebrow>Signale</Eyebrow>
          <EmptyState hint={hint} />
        </CardBody>
      </Card>
    );
  }
  return (
    <Card className="h-full">
      <CardBody className="p-5 flex flex-col gap-3 h-full">
        <div className="flex items-center justify-between">
          <Eyebrow>Signale · {events.length} aktiv</Eyebrow>
          <Link href="/alarms" className="text-caption hover:text-[var(--color-text)]">
            Alle →
          </Link>
        </div>
        <ul className="flex flex-col gap-2">
          {top.map((ev) => {
            const tone = ev.tier === "S1" ? "s1" : ev.tier === "S2" ? "s2" : "s3";
            return (
              <li key={ev.fired_at + ev.alarm_id}>
                <Link
                  href={alarmTargetUrl(ev)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--color-surface-2)]/40 hover:bg-[var(--color-surface-2)] border border-transparent hover:border-[var(--color-border)] transition-colors"
                >
                  <Pill tone={tone} size="sm" className="num-mono">{ev.tier}</Pill>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-[0.875rem] truncate">{labelize(ev.alarm_id)}</span>
                    <span className="text-caption">
                      {fmtTime(ev.fired_at)} · {ev.metric}
                    </span>
                  </div>
                  <Glyph name="ChevronRight" size={14} className="text-faint" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function EmptyState({ hint }: { hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 flex-1 py-8 text-center">
      <span className="size-8 grid place-items-center rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)]">
        <Glyph name="Bell" size={14} className="text-subtle" />
      </span>
      <p className="text-caption max-w-[24ch]">{hint ?? "Keine offenen Signale."}</p>
    </div>
  );
}

function labelize(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
