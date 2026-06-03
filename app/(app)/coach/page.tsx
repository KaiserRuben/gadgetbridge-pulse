import "server-only";

import Link from "next/link";

import { readViewState } from "@/lib/view-state/fetcher";
import { addDays, todayKey } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { Card, CardBody } from "@/components/ui/card";
import { Confidence } from "@/components/ui/confidence";
import { SlotStatusPill } from "@/components/view/SlotStatusPill";
import { CoachRetryButton } from "@/components/coach/coach-retry-button";
import { friendlySlotError } from "@/components/slots/_friendly-error";
import type { DaySynthesisPayload } from "@/runner/v4/slots/day-synthesis/types.ts";
import type {
  SlotEntry,
  SlotStatus,
  ViewStateDaily,
} from "@/runner/v4/types.ts";

export const dynamic = "force-dynamic";

const PAYLOAD_STATUSES = new Set<SlotStatus>([
  "fresh",
  "aging",
  "stale",
  "degraded",
]);

interface CoachRow {
  date: string;
  entry: SlotEntry<DaySynthesisPayload> | null;
}

export default async function CoachPage(): Promise<React.JSX.Element> {
  const today = todayKey();
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
  const views = await Promise.all(
    dates.map((d) => readViewState(d).catch(() => null)),
  );
  const rows: CoachRow[] = views.map((view, i) => ({
    date: dates[i],
    entry:
      view && view.scope === "daily"
        ? (view as ViewStateDaily).slots.day_synthesis ?? null
        : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Coach"
        title="Coach"
        sub="Tages-Synthese der letzten 14 Tage"
        trailing={
          <Link
            href={`/day/${today}`}
            className="inline-flex h-8 items-center rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 text-xs font-medium ring-1 ring-inset ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            Heute öffnen
          </Link>
        }
      />

      <Card variant="soft">
        <CardBody className="p-0">
          <Stagger className="flex flex-col divide-y divide-[var(--color-border)]/60">
            {rows.map((row) => (
              <StaggerItem key={row.date}>
                <CoachRowItem row={row} />
              </StaggerItem>
            ))}
          </Stagger>
        </CardBody>
      </Card>
    </div>
  );
}

function CoachRowItem({ row }: { row: CoachRow }) {
  const { date, entry } = row;
  const status: SlotStatus | null = entry?.status ?? null;
  const payload = entry?.payload ?? null;
  const hasPayload =
    payload != null && status != null && PAYLOAD_STATUSES.has(status);
  const headline = hasPayload
    ? payload.headline ??
      (payload.summary_short ? truncate(payload.summary_short, 80) : null)
    : null;
  const confidenceValue = hasPayload ? payload.confidence?.value ?? null : null;
  const retryable = status === "errored" || status === "missed";

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link
        href={`/day/${date}#day_synthesis`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sleep)]"
      >
        <span className="w-[110px] shrink-0 num-mono text-caption">
          {fmtDateDe(date)}
        </span>
        <span className="shrink-0">
          {status ? <SlotStatusPill status={status} /> : <MutedDash />}
        </span>
        <span className="min-w-0 flex-1 text-sm text-[var(--color-text)]">
          <CoachRowBody
            status={status}
            headline={headline}
            payload={payload}
            entry={entry}
          />
        </span>
        <span className="shrink-0">
          {confidenceValue != null ? (
            <Confidence value={confidenceValue} mode="pill" />
          ) : null}
        </span>
      </Link>
      {retryable ? (
        <CoachRetryButton
          period_key={date}
          slot_id="day_synthesis"
          className="shrink-0"
        />
      ) : null}
    </div>
  );
}

function CoachRowBody({
  status,
  headline,
  payload,
  entry,
}: {
  status: SlotStatus | null;
  headline: string | null;
  payload: DaySynthesisPayload | null;
  entry: SlotEntry<DaySynthesisPayload> | null;
}) {
  if (status === null) return <MutedDash />;
  if (status === "abstained") {
    return (
      <span className="text-caption text-muted">
        {payload?.abstain_reason ?? "Daten zu dünn — ausgesetzt."}
      </span>
    );
  }
  if (status === "errored") {
    const friendly = friendlySlotError(entry?.error?.message);
    return (
      <span className="truncate block text-caption text-[var(--color-band-down)]">
        {friendly.summary}
      </span>
    );
  }
  if (status === "scheduled" || status === "computing") {
    const when = entry?.scheduled_for ? fmtTimeDe(entry.scheduled_for) : null;
    return (
      <span className="text-caption text-muted">
        {when ? `geplant für ${when}` : "geplant"}
      </span>
    );
  }
  if (status === "missed") {
    return <span className="text-caption text-muted">verpasst</span>;
  }
  if (headline) {
    return <span className="truncate block">{headline}</span>;
  }
  return <MutedDash />;
}

function MutedDash() {
  return <span className="text-caption text-faint">—</span>;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}

function fmtDateDe(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  });
}

function fmtTimeDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
