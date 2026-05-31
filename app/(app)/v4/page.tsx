import "server-only";

import { readViewState, detectScope } from "@/lib/view-state/fetcher";
import { ViewStateProvider } from "@/lib/view-state/context";
import { Tier1Tile } from "@/components/view/Tier1Tile";
import { SlotStrip } from "@/components/view/SlotStrip";
import { PipelineHealthBadge } from "@/components/view/PipelineHealthBadge";
import { NextRefreshIndicator } from "@/components/view/NextRefreshIndicator";
import { SlotCell } from "@/components/view/SlotCell";
import { NightReviewBody } from "@/components/slots/NightReviewBody";
import { MorningBriefingBody } from "@/components/slots/MorningBriefingBody";
import { MiddayCheckBody } from "@/components/slots/MiddayCheckBody";
import { EveningReviewBody } from "@/components/slots/EveningReviewBody";
import { DaySynthesisBody } from "@/components/slots/DaySynthesisBody";
import { todayKey } from "@/lib/time";
import type {
  ViewStateDaily,
  ViewStateDailySlots,
} from "@/runner/v4/types.ts";

export const dynamic = "force-dynamic";

interface SP {
  d?: string;
}

export default async function V4HomePage({
  searchParams,
}: {
  searchParams?: Promise<SP>;
}) {
  const sp = (await searchParams) ?? {};
  const dateParam = sp.d ?? todayKey();
  const scope = detectScope(dateParam);
  if (!scope) {
    return (
      <main className="space-y-4">
        <h1 className="text-xl font-semibold">v4 dashboard</h1>
        <p className="text-sm text-[var(--color-band-down)]">
          ungültiger Datums-Key: <code>{dateParam}</code>
        </p>
      </main>
    );
  }

  const initial = await readViewState(dateParam);

  return (
    <ViewStateProvider period_key={dateParam} scope={scope} initial={initial}>
      <main className="space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              v4 — {dateParam}
            </h1>
            <NextRefreshIndicator className="text-[0.6875rem] text-[var(--color-text-muted)]" />
          </div>
          <div className="flex items-center gap-2">
            <PipelineHealthBadge />
            <SlotStrip />
          </div>
        </header>

        <Tier1Tile />

        {initial == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            view_state für {dateParam} noch nicht geschrieben.
            Daemon (<code>pulse v4-daemon</code>) muss laufen.
          </p>
        ) : initial.scope === "daily" ? (
          <DailyShell view={initial} />
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            weekly view nicht hier — Wochen-Übersicht unter /week
          </p>
        )}
      </main>
    </ViewStateProvider>
  );
}

function DailyShell({ view }: { view: ViewStateDaily }) {
  const s = view.slots as ViewStateDailySlots;
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SlotCell
        slot_id="night_review"
        entry={s.night_review}
        title="Nacht-Review"
        eyebrow="Letzte Nacht"
        Body={NightReviewBody}
        glow="sleep"
      />
      <SlotCell
        slot_id="morning_briefing"
        entry={s.morning_briefing}
        title="Morgen-Brief"
        eyebrow="Heute"
        Body={MorningBriefingBody}
      />
      <SlotCell
        slot_id="midday_check"
        entry={s.midday_check}
        title="Mittags-Check"
        eyebrow="Tagverlauf"
        Body={MiddayCheckBody}
      />
      <SlotCell
        slot_id="evening_review"
        entry={s.evening_review}
        title="Abend-Review"
        eyebrow="Tag bisher"
        Body={EveningReviewBody}
        glow="activity"
      />
      <SlotCell
        slot_id="day_synthesis"
        entry={s.day_synthesis}
        title="Tages-Synthese"
        eyebrow="Reflexion"
        Body={DaySynthesisBody}
      />
    </section>
  );
}
