import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import Link from "next/link";

import { loadAlarms, loadAlarmState, getCurrentMonthKey } from "@/lib/insights";
import type { AlarmEvent } from "@/lib/types/generated";
import { alarmTargetUrl } from "@/lib/alarm-target";
import { tSeverity, tGate } from "@/lib/i18n";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";
import { ClearAllButton } from "./clear-all-button";

export default async function AlarmsPage() {
  noStore();
  const monthKey = getCurrentMonthKey();
  const [alarms, state] = await Promise.all([loadAlarms(monthKey), loadAlarmState()]);

  const events = alarms?.events ?? [];
  const muted = new Set(state?.muted_topics ?? []);
  const now = Date.now();

  const active: AlarmEvent[] = [];
  const snoozed: AlarmEvent[] = [];
  const dismissed: AlarmEvent[] = [];

  for (const ev of events) {
    if (ev.dismissed) { dismissed.push(ev); continue; }
    const sn = state?.snooze_until?.[ev.alarm_id];
    if (sn && Date.parse(sn) > now) { snoozed.push(ev); continue; }
    if (muted.has(ev.alarm_id)) { snoozed.push(ev); continue; }
    active.push(ev);
  }

  active.sort((a, b) => Date.parse(b.fired_at) - Date.parse(a.fired_at));

  return (
    <div className="flex flex-col gap-8">
      <FadeRise>
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Eingang · {monthKey}</span>
          <h1 className="text-hero">Signale</h1>
        </div>
      </FadeRise>

      <Section
        eyebrow="Aktiv"
        title={`${active.length} offene Signale`}
        trailing={<ClearAllButton monthKey={monthKey} count={active.length} />}
      >
        {active.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-6 grid place-items-center gap-2 text-center text-caption">
              <Glyph name="Bell" size={18} className="text-subtle" />
              Keine offenen Signale.
            </CardBody>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((ev) => <AlarmRow key={ev.fired_at + ev.alarm_id} ev={ev} />)}
          </ul>
        )}
      </Section>

      {snoozed.length > 0 && (
        <Section eyebrow="Pausiert" title={`${snoozed.length}`}>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3 opacity-70">
            {snoozed.map((ev) => <AlarmRow key={ev.fired_at + ev.alarm_id} ev={ev} muted />)}
          </ul>
        </Section>
      )}

      {dismissed.length > 0 && (
        <Section eyebrow="Erledigt" title={`${dismissed.length}`}>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3 opacity-50">
            {dismissed.slice(0, 12).map((ev) => <AlarmRow key={ev.fired_at + ev.alarm_id} ev={ev} muted />)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function AlarmRow({ ev, muted = false }: { ev: AlarmEvent; muted?: boolean }) {
  const tone = ev.tier === "S1" ? "s1" : ev.tier === "S2" ? "s2" : "s3";
  const href = alarmTargetUrl(ev);
  return (
    <li id={ev.alarm_id}>
      <Link href={href} className="block group">
        <Card variant={muted ? "soft" : "surface"} hoverable>
          <CardBody className="p-4 flex items-start gap-3">
            <Pill tone={tone} size="sm" className="num-mono">{ev.tier}</Pill>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 justify-between">
                <span className="text-[0.9375rem] font-medium">{labelize(ev.alarm_id)}</span>
                <span className="text-caption shrink-0 num-mono">{fmtClock(ev.fired_at)}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-caption">
                <span>{ev.metric}</span>
                <span className="text-faint">·</span>
                <span>{tGate(ev.gate_triggered)}</span>
                {ev.z_score != null && (
                  <>
                    <span className="text-faint">·</span>
                    <span className="num-mono">z={ev.z_score.toFixed(2)}</span>
                  </>
                )}
                <span className="text-faint">·</span>
                <span>{tSeverity(ev.severity_label)}</span>
              </div>
              <div className="flex items-center gap-1 text-caption text-subtle group-hover:text-[var(--color-text)] transition-colors">
                <span>Auf Chart anzeigen</span>
                <Glyph name="ChevronRight" size={12} />
              </div>
            </div>
          </CardBody>
        </Card>
      </Link>
    </li>
  );
}

function labelize(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
