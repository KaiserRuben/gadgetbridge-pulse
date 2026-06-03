import "server-only";

import Link from "next/link";

import { readViewState, detectScope } from "@/lib/view-state/fetcher";
import { ViewStateProvider } from "@/lib/view-state/context";
import { HeroHeader } from "@/components/view/HeroHeader";
import { PriorityBanner } from "@/components/view/PriorityBanner";
import { Tier1Tile } from "@/components/view/Tier1Tile";
import { WorkoutsToday } from "@/components/view/WorkoutsToday";
import { DayTimeline, GlanceAside } from "@/components/view/DayTimeline";
import { ConsentCard } from "@/components/notifications/consent-card";
import {
  acceptSoftConsent,
  declineSoftConsent,
} from "../(home)/_consent-actions";
import {
  maybePromoteToEligible,
  shouldShowSoftCard,
} from "@/lib/notifications/consent";
import { isEngagementCriteriaMet } from "@/lib/notifications/eligible";
import { todayKey } from "@/lib/time";

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
      <main className="space-y-4 pb-dock">
        <h1 className="text-hero">Übersicht</h1>
        <p className="text-sm text-[var(--color-band-down)]">
          ungültiger Datums-Key: <code>{dateParam}</code>
        </p>
        <Link
          href="/v4"
          className="inline-block rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-sm ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
        >
          → Zurück zu heute
        </Link>
      </main>
    );
  }

  const initial = await readViewState(dateParam);
  const consentState = maybePromoteToEligible(isEngagementCriteriaMet());
  const showConsentCard = shouldShowSoftCard(consentState);

  return (
    <ViewStateProvider period_key={dateParam} scope={scope} initial={initial}>
      <main className="space-y-6 pb-dock">
        {showConsentCard && (
          <ConsentCard onAccept={acceptSoftConsent} onDecline={declineSoftConsent} />
        )}

        <HeroHeader />
        <PriorityBanner />
        <Tier1Tile />
        <WorkoutsToday />

        {initial == null ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Für diesen Tag liegen noch keine Ergebnisse vor. Die Auswertung läuft
            automatisch — schau später nochmal vorbei.
          </p>
        ) : initial.scope === "daily" ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <DayTimeline />
            <GlanceAside />
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Wochen-Übersicht unter{" "}
            <Link href="/week" className="underline">
              /week
            </Link>
            .
          </p>
        )}
      </main>
    </ViewStateProvider>
  );
}
