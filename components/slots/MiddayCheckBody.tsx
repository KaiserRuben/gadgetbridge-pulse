"use client";

import { Pill } from "@/components/ui/pill";
import { AbstainNote } from "./_AbstainNote";
import { ProseBody } from "./_ProseBody";
import type {
  MiddayCheckPayload,
  MiddayStatusLabel,
} from "@/runner/v4/slots/midday-check/types.ts";

const statusTone: Record<MiddayStatusLabel, Parameters<typeof Pill>[0]["tone"]> = {
  on_track: "up",
  ahead: "activity",
  behind: "steady",
  deviated: "down",
  no_signal: "neutral",
};

const statusLabel: Record<MiddayStatusLabel, string> = {
  on_track: "auf Kurs",
  ahead: "voraus",
  behind: "hinten",
  deviated: "abgewichen",
  no_signal: "kein Signal",
};

export function MiddayCheckBody({ payload }: { payload: MiddayCheckPayload }) {
  if (payload.abstain) return <AbstainNote reason={payload.abstain_reason} />;
  const cc = payload.course_correction;
  return (
    <ProseBody
      headline={payload.headline}
      summary_short={payload.summary_short}
      paragraphs={
        payload.next_window
          ? [{ label: "Fenster", text: payload.next_window }]
          : undefined
      }
      extras={
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Pill tone={statusTone[payload.status.label]} size="sm">
              {statusLabel[payload.status.label]}
            </Pill>
            <span className="text-[var(--color-text-muted)]">
              {payload.status.reasoning}
            </span>
          </div>
          {cc ? (
            <div className="rounded-md bg-[var(--color-surface-soft)] p-2 text-xs">
              <div className="font-medium text-[var(--color-text)]">{cc.tiny}</div>
              <div className="text-[var(--color-text-muted)]">
                {cc.anchor} · {cc.why}
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
