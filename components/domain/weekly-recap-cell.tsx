"use client";

import Link from "next/link";

import { DerivedCell } from "@/components/derived/DerivedCell";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import type { WeeklyRecapPayload } from "@/runner/clusters/weekly_recap/types";

/**
 * Weekly-recap surface backed by the `weekly_recap` JobCell.
 *
 * Two render paths during the migration window:
 *  1. JobCell path (primary): DerivedCell polls /api/jobs/weekly_recap/<weekKey>
 *     and renders the trajectory/patterns/streaks/experiment block as the
 *     LLM finishes.
 *  2. Legacy fallback: if the cell is `never_computed` AND the server
 *     pre-loaded a payload from the on-disk `weekly.json`, render that
 *     payload directly. The legacy file is still produced by both the
 *     cluster's prose-stage dual-write AND the legacy stageW-weekly
 *     caller in v2-orchestrator, so existing readers stay alive.
 */
export function WeeklyRecapCell({
  weekKey,
  fallbackPayload,
}: {
  weekKey: string;
  fallbackPayload: WeeklyRecapPayload | null;
}) {
  return (
    <DerivedCell<WeeklyRecapPayload>
      cluster="weekly_recap"
      cellKey={weekKey}
      scope="weekly"
      emptyCtaLabel="Wochen-Recap anfordern"
      fallback={
        fallbackPayload ? <WeeklyRecapBody payload={fallbackPayload} /> : <WeeklyRecapSkeleton />
      }
      // Weekly LLM calls take ~30-60s on qwen3.6 — poll a bit faster than
      // the default so the user sees the result land promptly.
      activeIntervalMs={1500}
      render={(payload) => <WeeklyRecapBody payload={payload} />}
    />
  );
}

function WeeklyRecapSkeleton() {
  return (
    <Card variant="soft">
      <CardBody className="p-5">
        <Eyebrow>Wochen-Recap</Eyebrow>
        <p className="text-body-sm text-muted mt-2">
          Recap wird vorbereitet …
        </p>
      </CardBody>
    </Card>
  );
}

function WeeklyRecapBody({ payload }: { payload: WeeklyRecapPayload }) {
  const hasTrajectory =
    !payload.abstain &&
    (payload.trajectory_headline.recovery.trim().length > 0 ||
      payload.trajectory_headline.activity.trim().length > 0 ||
      payload.trajectory_headline.stress.trim().length > 0);

  return (
    <div className="flex flex-col gap-8">
      {hasTrajectory ? (
        <FadeRise>
          <Card glow="sleep">
            <CardBody className="p-5 md:p-6 lg:p-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <TrajectoryTile
                icon="Moon"
                tone="sleep"
                label="Erholung"
                text={payload.trajectory_headline.recovery}
              />
              <TrajectoryTile
                icon="Footprints"
                tone="activity"
                label="Bewegung"
                text={payload.trajectory_headline.activity}
              />
              <TrajectoryTile
                icon="Waves"
                tone="stress"
                label="Stress"
                text={payload.trajectory_headline.stress}
              />
              <div className="md:col-span-3">
                <ConfidenceBar value={payload.confidence.value} />
              </div>
            </CardBody>
          </Card>
        </FadeRise>
      ) : (
        <FadeRise>
          <Card variant="soft">
            <CardBody className="p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Eyebrow>Aggregat</Eyebrow>
                {payload.abstain && (
                  <Pill tone="steady" size="sm">
                    Coach pausiert
                  </Pill>
                )}
              </div>
              <p className="text-body text-muted max-w-[60ch]">
                {payload.abstain_reason ??
                  "Der Wochen-Coach hat noch keinen Recap erzeugt."}
              </p>
            </CardBody>
          </Card>
        </FadeRise>
      )}

      {payload.pattern_callouts && payload.pattern_callouts.length > 0 && (
        <Section
          eyebrow="Muster"
          title={`${payload.pattern_callouts.length} wiederholte Beobachtungen`}
        >
          <Stagger
            className="grid grid-cols-1 lg:grid-cols-2 gap-3"
            step={0.05}
          >
            {payload.pattern_callouts.map((p) => (
              <StaggerItem key={p.id}>
                <Card>
                  <CardBody className="p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <Pill tone="neutral" size="sm">
                        {p.occurrences}× diese Woche
                      </Pill>
                      <span className="text-caption">
                        {p.domains.join(" · ")}
                      </span>
                    </div>
                    <p className="text-[0.9375rem]">{p.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {p.days.map((d) => (
                        <Link
                          key={d}
                          href={`/?d=${d}`}
                          className="num-mono text-caption px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)]"
                        >
                          {fmtMd(d)}
                        </Link>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      )}

      {((payload.streaks?.length ?? 0) > 0 ||
        payload.personal_best ||
        payload.personal_worst) && (
        <Section eyebrow="Höhepunkte" title="Streaks & Rekorde">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {payload.streaks?.map((s) => (
              <Card key={s.id}>
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph
                      name="Flame"
                      size={16}
                      className="text-[var(--color-stress)]"
                    />
                    <Eyebrow>Streak</Eyebrow>
                  </div>
                  <p className="text-[0.9375rem]">{s.label}</p>
                  <div className="flex items-baseline gap-1.5 mt-auto">
                    <span className="num text-[1.625rem] font-semibold">
                      {s.length_days}
                    </span>
                    <span className="text-caption">
                      Tage · {s.metric_id}
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
            {payload.personal_best && (
              <Card glow="activity">
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph
                      name="Trophy"
                      size={16}
                      className="text-[var(--color-activity)]"
                    />
                    <Eyebrow>Bester Tag</Eyebrow>
                  </div>
                  <Link
                    href={`/?d=${payload.personal_best.date}`}
                    className="text-[0.9375rem] hover:underline"
                  >
                    {payload.personal_best.metric_id}:{" "}
                    <span className="num-mono">
                      {payload.personal_best.value.toFixed(1)}
                    </span>
                  </Link>
                  {payload.personal_best.note && (
                    <p className="text-caption text-subtle">
                      {payload.personal_best.note}
                    </p>
                  )}
                  <span className="text-caption mt-auto">
                    {fmtMd(payload.personal_best.date)}
                  </span>
                </CardBody>
              </Card>
            )}
            {payload.personal_worst && (
              <Card>
                <CardBody className="p-5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Glyph
                      name="Mountain"
                      size={16}
                      className="text-[var(--color-heart)]"
                    />
                    <Eyebrow>Schwerster Tag</Eyebrow>
                  </div>
                  <Link
                    href={`/?d=${payload.personal_worst.date}`}
                    className="text-[0.9375rem] hover:underline"
                  >
                    {payload.personal_worst.metric_id}:{" "}
                    <span className="num-mono">
                      {payload.personal_worst.value.toFixed(1)}
                    </span>
                  </Link>
                  <p className="text-caption text-subtle">
                    {payload.personal_worst.action_or_note}
                  </p>
                  <span className="text-caption mt-auto">
                    {fmtMd(payload.personal_worst.date)}
                  </span>
                </CardBody>
              </Card>
            )}
          </div>
        </Section>
      )}

      {payload.micro_experiment && (
        <Section eyebrow="Micro-Experiment" title="Hypothese der Woche">
          <Card glow="sleep">
            <CardBody className="p-5 lg:p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Glyph
                  name="Sparkles"
                  size={16}
                  className="text-[var(--color-sleep)]"
                />
                <Pill tone="sleep" size="sm">
                  {payload.micro_experiment.duration_days} Tage
                </Pill>
                <span className="text-caption">
                  Ziel · {payload.micro_experiment.target_metric_id}
                </span>
              </div>
              <p className="text-[1.0625rem] leading-snug max-w-[60ch]">
                {payload.micro_experiment.hypothesis}
              </p>
              <ol className="flex flex-col gap-2 text-[0.9375rem]">
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">
                    Wenn
                  </span>
                  <span>{payload.micro_experiment.anchor}</span>
                </li>
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">
                    Dann
                  </span>
                  <span>{payload.micro_experiment.tiny}</span>
                </li>
                <li className="flex gap-3 items-baseline">
                  <span className="num-mono text-caption text-subtle w-8">
                    Sonst
                  </span>
                  <span className="text-subtle">
                    {payload.micro_experiment.fallback}
                  </span>
                </li>
              </ol>
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}

function TrajectoryTile({
  icon,
  tone,
  label,
  text,
}: {
  icon: GlyphName;
  tone: "sleep" | "activity" | "stress";
  label: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`grid place-items-center size-10 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-${tone})]`}
      >
        <Glyph name={icon} size={18} />
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <p className="text-[0.9375rem] leading-snug">{text}</p>
      </div>
    </div>
  );
}

function fmtMd(date: string): string {
  if (!date || date.length < 10) return date;
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
