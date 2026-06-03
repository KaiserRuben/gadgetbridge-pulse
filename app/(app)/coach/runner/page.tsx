import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { readViewState } from "@/lib/view-state/fetcher";
import { ViewStateProvider } from "@/lib/view-state/context";
import { Section } from "@/components/ui/section";
import { PageHeader } from "@/components/ui/page-header";
import { DaemonHealthPanel } from "@/components/coach/daemon-health-panel";
import { RunnerStatusPanel } from "@/components/coach/runner-status-panel";
import { todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CoachRunnerPage() {
  noStore();
  const today = todayKey();
  const initial = await readViewState(today).catch(() => null);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="System"
        title="Runner"
        sub={`v4 Daemon-Health, Slot-Status und Retries für heute (${today}).`}
      />

      <ViewStateProvider period_key={today} scope="daily" initial={initial}>
        <DaemonHealthPanel />
      </ViewStateProvider>

      <Section
        eyebrow="Legacy"
        title="v3 Cluster-Runner"
        trailing={
          <span className="text-xs text-[var(--color-text-subtle)]">
            wird mit v4-Cutover entfernt
          </span>
        }
      >
        <RunnerStatusPanel />
      </Section>
    </main>
  );
}
