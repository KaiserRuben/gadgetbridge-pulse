"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { PipelineHealthBadge } from "@/components/view/PipelineHealthBadge";
import { SlotStatusPill } from "@/components/view/SlotStatusPill";
import { SlotRetryButton } from "@/components/view/SlotRetryButton";
import { useViewState } from "@/lib/view-state/context";
import type {
  DailySlotId,
  PostWorkoutSlotEntry,
  AnomalyExplainSlotEntry,
  SlotEntry,
  ViewStateDaily,
} from "@/runner/v4/types.ts";

/**
 * V4 daemon health panel — surfaces the live ViewState meta + tier1 + per-slot
 * status for today's view doc. Heartbeat + pipeline health come from
 * `view.meta`; slot grid uses the same five fixed daily slots the daemon
 * schedules. Retry buttons reuse `SlotRetryButton` (POST /api/view/.../retry).
 *
 * Outbox queue depth is intentionally not surfaced here — see comment in
 * `OutboxDeferredNote`. Adding that requires a runner-side HTTP endpoint
 * (the `outbox-v4/` volume isn't reachable from the Pi web process today).
 */

const DAILY_SLOT_TITLES: Record<DailySlotId, string> = {
  night_review: "Nacht-Review",
  morning_briefing: "Morgen-Brief",
  midday_check: "Mittags-Check",
  evening_review: "Abend-Review",
  day_synthesis: "Tages-Synthese",
};

export function DaemonHealthPanel() {
  const { view, connected, error } = useViewState();

  if (view == null || view.scope !== "daily") {
    return (
      <Section eyebrow="Daemon" title="v4 Pipeline">
        <Card variant="soft">
          <CardBody>
            <div className="text-sm text-foreground/60">
              Heute liegt noch kein view_state vor — der Daemon schreibt
              tier1 + Slots beim nächsten Tick.
              {error ? (
                <span className="ml-2 text-[var(--color-band-down)]">
                  {error}
                </span>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </Section>
    );
  }

  const daily = view as ViewStateDaily;
  const meta = daily.meta;
  const tier1 = daily.tier1;
  const events = daily.events;

  return (
    <Section
      eyebrow="Daemon"
      title="v4 Pipeline"
      trailing={
        <div className="flex items-center gap-2">
          <PipelineHealthBadge />
          <Pill tone={connected ? "up" : "low"} size="sm">
            {connected ? "live" : "offline"}
          </Pill>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Card variant="soft">
          <CardBody>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetaRow label="Letzter Heartbeat" value={fmtAge(meta.last_runner_heartbeat)} />
              <MetaRow label="Tier1 berechnet" value={fmtAge(tier1.computed_at)} />
              <MetaRow label="Nächster Refresh" value={fmtTimeDe(meta.next_refresh_at)} />
              <MetaRow
                label="Letzter Phone-Sync"
                value={meta.last_phone_sync_at ? fmtAge(meta.last_phone_sync_at) : "—"}
              />
              <MetaRow label="View-Version" value={`v${daily.version}`} />
              <MetaRow
                label="Held-back"
                value={
                  meta.held_back.length === 0
                    ? "—"
                    : meta.held_back.map((h) => h.slot_id).join(", ")
                }
              />
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-2">
          {(Object.keys(DAILY_SLOT_TITLES) as DailySlotId[]).map((id) => {
            const entry = daily.slots[id] as SlotEntry;
            return (
              <SlotStatusRow
                key={id}
                slot_id={id}
                title={DAILY_SLOT_TITLES[id]}
                entry={entry}
              />
            );
          })}
        </div>

        <Card variant="soft">
          <CardBody>
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex flex-col">
                <Eyebrow>Event-Slots</Eyebrow>
                <div className="text-sm text-foreground/80">
                  post_workout: {events.post_workout.length} ·
                  {" "}anomaly_explain: {events.anomaly_explain.length}
                </div>
              </div>
              <div className="text-xs text-foreground/50">
                {countByStatus(events.post_workout, "errored") +
                  countByStatus(events.anomaly_explain, "errored")}{" "}
                errored
              </div>
            </div>
          </CardBody>
        </Card>

        <OutboxDeferredNote />
      </div>
    </Section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <Eyebrow>{label}</Eyebrow>
      <span className="text-sm text-foreground/90 num-mono">{value}</span>
    </div>
  );
}

function SlotStatusRow({
  slot_id,
  title,
  entry,
}: {
  slot_id: DailySlotId;
  title: string;
  entry: SlotEntry;
}) {
  const retryable =
    entry.status === "errored" ||
    entry.status === "stale" ||
    entry.status === "missed";
  return (
    <Card variant="soft">
      <CardBody>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{slot_id}</Eyebrow>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-foreground/60">
              {entry.computed_at
                ? `berechnet ${fmtAge(entry.computed_at)}`
                : `geplant ${fmtTimeDe(entry.scheduled_for)}`}
              {" · "}v{entry.version}
              {entry.error ? ` · ${entry.error.code}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SlotStatusPill status={entry.status} />
            {retryable ? <SlotRetryButton slot_id={slot_id} /> : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function OutboxDeferredNote() {
  return (
    <Card variant="soft" className="border-dashed">
      <CardBody>
        <div className="flex flex-col gap-1">
          <Eyebrow>Outbox</Eyebrow>
          <span className="text-xs text-foreground/60">
            Queue-Tiefe + Drain-Quote stehen erst zur Verfügung, wenn der
            Runner eine Health-Route exponiert. Aktuell nur Slot-Versionen
            zeigen, ob die Mac→Pi-Übertragung läuft.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function countByStatus(
  list: Array<PostWorkoutSlotEntry | AnomalyExplainSlotEntry>,
  status: SlotEntry["status"],
): number {
  return list.reduce((n, e) => n + (e.status === status ? 1 : 0), 0);
}

function fmtTimeDe(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const dt = Date.now() - t;
  if (dt < 60_000) return `vor ${Math.max(1, Math.round(dt / 1000))}s`;
  if (dt < 3_600_000) return `vor ${Math.round(dt / 60_000)}min`;
  if (dt < 86_400_000) return `vor ${(dt / 3_600_000).toFixed(1)}h`;
  return `vor ${Math.round(dt / 86_400_000)}d`;
}
