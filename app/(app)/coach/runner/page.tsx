import "server-only";
import { unstable_noStore as noStore } from "next/cache";

import { RunnerStatusPanel } from "@/components/coach/runner-status-panel";

export default async function CoachRunnerPage() {
  noStore();
  return (
    <main className="container mx-auto max-w-3xl py-6">
      <header className="mb-6">
        <h1 className="text-title">Runner</h1>
        <p className="text-sm text-foreground/60">
          Live PULSE_RUN view — what is running now, what finished, what failed.
        </p>
      </header>
      <RunnerStatusPanel />
    </main>
  );
}
