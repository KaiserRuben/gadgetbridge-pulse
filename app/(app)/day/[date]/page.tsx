import "server-only";

import Link from "next/link";

import { ViewStateProvider } from "@/lib/view-state/context";
import { detectScope, readViewState } from "@/lib/view-state/fetcher";
import { SlotDrillSection } from "@/components/slots/drill/SlotDrillSection";
import { EventSlotDrillCard } from "@/components/slots/drill/EventSlotDrillCard";
import { NightReviewDrillBody } from "@/components/slots/drill/NightReviewDrillBody";
import { MorningBriefingDrillBody } from "@/components/slots/drill/MorningBriefingDrillBody";
import { MiddayCheckDrillBody } from "@/components/slots/drill/MiddayCheckDrillBody";
import { EveningReviewDrillBody } from "@/components/slots/drill/EveningReviewDrillBody";
import { DaySynthesisDrillBody } from "@/components/slots/drill/DaySynthesisDrillBody";
import { PostWorkoutDrillBody } from "@/components/slots/drill/PostWorkoutDrillBody";
import { AnomalyExplainDrillBody } from "@/components/slots/drill/AnomalyExplainDrillBody";
import type {
  AnomalyExplainSlotEntry,
  PostWorkoutSlotEntry,
  ViewStateDaily,
} from "@/runner/v4/types.ts";
import type { AnomalyExplainPayload } from "@/runner/v4/slots/anomaly-explain/types.ts";
import type { PostWorkoutPayload } from "@/runner/v4/slots/post-workout/types.ts";

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
      <main className="space-y-4">
        <h1 className="text-xl font-semibold">Tagesdetail</h1>
        <p className="text-sm text-[var(--color-band-down)]">
          ungültiger Datums-Key: <code>{date}</code>
        </p>
      </main>
    );
  }

  const view = (await readViewState(date)) as ViewStateDaily | null;

  return (
    <ViewStateProvider period_key={date} scope="daily" initial={view}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-10">
        <nav className="flex items-center gap-2 text-[0.75rem] text-[var(--color-text-muted)]">
          <Link
            href={`/v4?d=${date}`}
            className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-2.5 py-1 ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
          >
            ← Übersicht
          </Link>
        </nav>

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Tag {date}
          </h1>
          <p className="text-[0.75rem] text-[var(--color-text-muted)]">
            Vollständige Slot-Aufschlüsselung mit Belegen und Quellen.
          </p>
        </header>

        {view == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            view_state für {date} noch nicht geschrieben.
            Daemon (<code>pulse v4-daemon</code>) muss laufen.
          </p>
        ) : (
          <>
            <SlotDrillSection
              slot_id="night_review"
              entry={view.slots.night_review}
              title="Nacht-Review"
              eyebrow="Letzte Nacht"
              Body={NightReviewDrillBody as (props: { payload: unknown }) => React.ReactNode}
              glow="sleep"
            />
            <SlotDrillSection
              slot_id="morning_briefing"
              entry={view.slots.morning_briefing}
              title="Morgen-Brief"
              eyebrow="Heute"
              Body={MorningBriefingDrillBody as (props: { payload: unknown }) => React.ReactNode}
            />
            <SlotDrillSection
              slot_id="midday_check"
              entry={view.slots.midday_check}
              title="Mittags-Check"
              eyebrow="Tagverlauf"
              Body={MiddayCheckDrillBody as (props: { payload: unknown }) => React.ReactNode}
            />
            <SlotDrillSection
              slot_id="evening_review"
              entry={view.slots.evening_review}
              title="Abend-Review"
              eyebrow="Tag bisher"
              Body={EveningReviewDrillBody as (props: { payload: unknown }) => React.ReactNode}
              glow="activity"
            />
            <SlotDrillSection
              slot_id="day_synthesis"
              entry={view.slots.day_synthesis}
              title="Tages-Synthese"
              eyebrow="Reflexion"
              Body={DaySynthesisDrillBody as (props: { payload: unknown }) => React.ReactNode}
            />

            {view.events.post_workout.map((e: PostWorkoutSlotEntry) => (
              <EventSlotDrillCard
                key={e.event_id}
                slot_id="post_workout"
                event_id={e.event_id}
                anchor={`post_workout-${e.event_id}`}
                entry={e}
                title="Post-Workout"
                eyebrow={`${fmtRange(e.workout_ref.ts_start_iso, e.workout_ref.ts_end_iso)}`}
                glow="activity"
                Body={({ payload }) => (
                  <PostWorkoutDrillBody payload={payload as PostWorkoutPayload} />
                )}
              />
            ))}

            {view.events.anomaly_explain.map((e: AnomalyExplainSlotEntry) => (
              <EventSlotDrillCard
                key={e.event_id}
                slot_id="anomaly_explain"
                event_id={e.event_id}
                observation_id={e.observation_id}
                anchor={`anomaly_explain-${e.event_id}`}
                entry={e}
                title="Anomalie-Erklärung"
                eyebrow={`Beobachtung ${e.observation_id}`}
                Body={({ payload }) => (
                  <AnomalyExplainDrillBody
                    payload={payload as AnomalyExplainPayload}
                    observation_id={e.observation_id}
                  />
                )}
              />
            ))}
          </>
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
