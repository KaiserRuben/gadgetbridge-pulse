import "server-only";

import { ViewStateProvider } from "@/lib/view-state/context";
import { detectScope, readViewState } from "@/lib/view-state/fetcher";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { SlotDrillSection } from "@/components/slots/drill/SlotDrillSection";
import { EventSlotDrillCard } from "@/components/slots/drill/EventSlotDrillCard";
import type {
  AnomalyExplainSlotEntry,
  PostWorkoutSlotEntry,
  ViewStateDaily,
} from "@/runner/v4/types.ts";

export const dynamic = "force-dynamic";

export default async function DayDrillPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const scope = detectScope(date);
  if (scope !== "daily") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageHeader back={{ href: "/v4", label: "Übersicht" }} title="Tagesdetail" />
        <p className="text-sm text-[var(--color-band-down)]">
          ungültiger Datums-Key: <code>{date}</code>
        </p>
      </main>
    );
  }

  const view = (await readViewState(date)) as ViewStateDaily | null;

  return (
    <ViewStateProvider period_key={date} scope="daily" initial={view}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageHeader
          back={{ href: `/v4?d=${date}`, label: "Übersicht" }}
          eyebrow={date}
          title="Tagesdetail"
          sub="Vollständige Slot-Aufschlüsselung mit Belegen und Quellen."
        />

        {view == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Für diesen Tag liegen noch keine Ergebnisse vor. Schau später
            nochmal vorbei.
          </p>
        ) : (
          <Stagger className="flex flex-col gap-4" delay={0.04}>
            <StaggerItem>
              <SlotDrillSection
                slot_id="night_review"
                entry={view.slots.night_review}
                title="Nacht-Review"
                eyebrow="Letzte Nacht"
                glow="sleep"
              />
            </StaggerItem>
            <StaggerItem>
              <SlotDrillSection
                slot_id="morning_briefing"
                entry={view.slots.morning_briefing}
                title="Morgen-Brief"
                eyebrow="Heute"
              />
            </StaggerItem>
            <StaggerItem>
              <SlotDrillSection
                slot_id="midday_check"
                entry={view.slots.midday_check}
                title="Mittags-Check"
                eyebrow="Tagverlauf"
              />
            </StaggerItem>
            <StaggerItem>
              <SlotDrillSection
                slot_id="evening_review"
                entry={view.slots.evening_review}
                title="Abend-Review"
                eyebrow="Tag bisher"
                glow="activity"
              />
            </StaggerItem>
            <StaggerItem>
              <SlotDrillSection
                slot_id="day_synthesis"
                entry={view.slots.day_synthesis}
                title="Tages-Synthese"
                eyebrow="Reflexion"
              />
            </StaggerItem>

            {view.events.post_workout.map((e: PostWorkoutSlotEntry) => (
              <StaggerItem key={e.event_id}>
                <EventSlotDrillCard
                  slot_id="post_workout"
                  event_id={e.event_id}
                  anchor={`post_workout-${e.event_id}`}
                  entry={e}
                  title="Post-Workout"
                  eyebrow={`${fmtRange(e.workout_ref.ts_start_iso, e.workout_ref.ts_end_iso)}`}
                  glow="activity"
                />
              </StaggerItem>
            ))}

            {view.events.anomaly_explain.map((e: AnomalyExplainSlotEntry) => (
              <StaggerItem key={e.event_id}>
                <EventSlotDrillCard
                  slot_id="anomaly_explain"
                  event_id={e.event_id}
                  observation_id={e.observation_id}
                  anchor={`anomaly_explain-${e.event_id}`}
                  entry={e}
                  title="Anomalie-Erklärung"
                  eyebrow={`Beobachtung ${e.observation_id}`}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </main>
    </ViewStateProvider>
  );
}

function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${startIso} → ${endIso}`;
  }
  const fmt = (d: Date) =>
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${fmt(s)}–${fmt(e)}`;
}
