"use client";

import Link from "next/link";

import { DerivedCell } from "@/components/derived/DerivedCell";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";

import { HeroV3 } from "@/components/domain/hero-v3";
import { TopActionCard } from "@/components/domain/top-action-card";
import { DomainPointerCard } from "@/components/domain/domain-pointer-card";
import { ContradictionCard } from "@/components/domain/contradiction-card";

import type { DashboardMode } from "@/lib/dashboard/mode";
import type {
  DailyV3Bundle,
  SynthesisInsightV3,
} from "@/lib/types/v3";
import type { SynthesisV3Payload } from "@/runner/clusters/synthesis_v3/types";

type SynthesisPayload = SynthesisV3Payload | SynthesisInsightV3;

/**
 * Synthesis surface backed by the `synthesis_v3` JobCell.
 *
 * This is the highest-visibility surface in the dashboard: home page
 * hero, day-detail page, plus contradictions + domain pointers + top
 * action sub-cards. All of those render from a single cluster payload.
 *
 * Two render paths during the migration window:
 *  1. JobCell path (primary): DerivedCell polls
 *     `/api/jobs/synthesis_v3/<periodKey>` and renders synthesis content
 *     as the LLM finishes.
 *  2. Legacy fallback: when the cell is `never_computed` AND the server
 *     pre-loaded a payload from on-disk `daily_v3.json`, render that
 *     payload directly. The legacy file is still produced by both the
 *     cluster's prose-stage dual-write AND the legacy `runV3` caller in
 *     `events/subscribers.ts`, so existing surfaces stay alive.
 *
 * Variants:
 *  - `"home"`        — composes Hero + (suppressible) TopAction +
 *                      Contradictions + DomainPointers. Page-level
 *                      `topActionSuppressed` controls whether the top
 *                      action competes with the morning briefing.
 *  - `"day-detail"`  — composes Hero + TopAction + Contradictions only;
 *                      the day-detail page renders domain drill-downs
 *                      itself (via the Stagger grid) so we don't double
 *                      up on the pointer cards.
 *
 * The cell payload drives all four sub-cards. The wrapper accepts the
 * non-synthesis bits that HeroV3 needs (`dayScore`, `mode`, `compact`)
 * via props so we don't re-fetch them on the client.
 */
export function SynthesisCell({
  periodKey,
  fallbackPayload,
  variant,
  // ── HeroV3 props (non-synthesis context the cell can't derive) ──
  dayScore,
  mode,
  compact = false,
  responsive = false,
  // ── home-only composition flags ─────────────────────────────────
  topActionSuppressed = false,
  domainDrillHrefBase,
}: {
  periodKey: string;
  fallbackPayload: SynthesisPayload | null;
  variant: "home" | "day-detail";
  dayScore: DailyV3Bundle["day_score"];
  mode: DashboardMode;
  compact?: boolean;
  /**
   * When true, the cell renders both the compact and full Hero variant
   * wrapped in Tailwind `md:hidden` / `hidden md:block` so the home
   * page doesn't have to duplicate the entire `<SynthesisCell>` block.
   * The non-Hero composition (TopAction, Contradictions, DomainPointers)
   * only renders once regardless of viewport.
   */
  responsive?: boolean;
  /**
   * Home page hides TopActionCard when the morning briefing competes
   * for the "do this now" slot. The page decides; we just gate.
   */
  topActionSuppressed?: boolean;
  /**
   * DomainPointerCard navigates to `${base}${periodKey}`. Defaults to
   * the per-domain detail route (`/sleep/${date}` etc.) — the
   * DomainPointerCard wires its own path mapping. We pass the period
   * key explicitly so the cell payload doesn't need to encode it.
   */
  domainDrillHrefBase?: string;
}) {
  return (
    <DerivedCell<SynthesisPayload>
      cluster="synthesis_v3"
      cellKey={periodKey}
      scope="daily"
      emptyCtaLabel="Tages-Insight anfordern"
      provenanceDisplay="row"
      fallback={
        fallbackPayload ? (
          <SynthesisBody
            payload={fallbackPayload}
            periodKey={periodKey}
            variant={variant}
            dayScore={dayScore}
            mode={mode}
            compact={compact}
            responsive={responsive}
            topActionSuppressed={topActionSuppressed}
            domainDrillHrefBase={domainDrillHrefBase}
          />
        ) : (
          <SynthesisSkeleton variant={variant} />
        )
      }
      // qwen3.6 takes ~30-60s for a full synthesis; poll a bit faster
      // than the default so the user sees the result land.
      activeIntervalMs={1500}
      render={(payload) => (
        <SynthesisBody
          payload={payload}
          periodKey={periodKey}
          variant={variant}
          dayScore={dayScore}
          mode={mode}
          compact={compact}
          responsive={responsive}
          topActionSuppressed={topActionSuppressed}
          domainDrillHrefBase={domainDrillHrefBase}
        />
      )}
    />
  );
}

function SynthesisSkeleton({ variant }: { variant: "home" | "day-detail" }) {
  return (
    <Card variant="soft">
      <CardBody className="p-5">
        <p className="text-body-sm text-muted">
          {variant === "home"
            ? "Tages-Insight wird vorbereitet …"
            : "Tagesanalyse landet mit dem nächsten Run."}
        </p>
      </CardBody>
    </Card>
  );
}

interface SynthesisBodyProps {
  payload: SynthesisPayload;
  periodKey: string;
  variant: "home" | "day-detail";
  dayScore: DailyV3Bundle["day_score"];
  mode: DashboardMode;
  compact: boolean;
  responsive: boolean;
  topActionSuppressed: boolean;
  domainDrillHrefBase: string | undefined;
}

function SynthesisBody({
  payload,
  periodKey,
  variant,
  dayScore,
  mode,
  compact,
  responsive,
  topActionSuppressed,
  domainDrillHrefBase,
}: SynthesisBodyProps) {
  // HeroV3 reads a `DailyV3Bundle` shape because it needs `daily` (the
  // synthesis insight) plus `day_score` for the ring. We assemble a
  // minimal bundle from the cell payload + the server-passed day_score.
  // Sleep/recovery/activity aren't consumed by HeroV3 so we leave them
  // null. The dashboard's hero-fallback layer already runs server-side
  // before we get here, so `dayScore` is the best-available value for
  // the date in view.
  const heroBundle: DailyV3Bundle = {
    date: periodKey,
    daily: payload as SynthesisInsightV3,
    sleep: null,
    recovery: null,
    activity: null,
    day_score: dayScore,
    complete: payload.abstain === false && (payload as { incomplete?: boolean }).incomplete === false,
  };

  const topAction = payload.top_action_today;
  const contradictions = payload.contradictions ?? [];
  const pointers = payload.domain_pointers ?? [];

  // Home variant: hero + (suppressible) top action + contradictions + pointers.
  // Day-detail variant: hero + top action + contradictions only.
  const showTopAction =
    !!topAction &&
    !topActionSuppressed;
  const showPointers = variant === "home" && pointers.length === 3;

  void domainDrillHrefBase; // reserved for future override; DomainPointerCard
  // currently hard-codes its own per-domain path map.

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      {responsive ? (
        <>
          <div className="md:hidden">
            <FadeRise>
              <HeroV3 bundle={heroBundle} date={periodKey} mode={mode} compact />
            </FadeRise>
          </div>
          <div className="hidden md:block">
            <FadeRise>
              <HeroV3 bundle={heroBundle} date={periodKey} mode={mode} />
            </FadeRise>
          </div>
        </>
      ) : (
        <FadeRise>
          <HeroV3 bundle={heroBundle} date={periodKey} mode={mode} compact={compact} />
        </FadeRise>
      )}

      {showTopAction && topAction && (
        <FadeRise>
          <TopActionCard action={topAction} />
        </FadeRise>
      )}

      {contradictions.length > 0 && (
        <Section eyebrow="Konflikte" title={`${contradictions.length} erkannt`}>
          <div className="flex flex-col gap-3">
            {contradictions.map((c, i) => (
              <ContradictionCard key={i} contradiction={c} />
            ))}
          </div>
        </Section>
      )}

      {showPointers && (() => {
        const allIncomplete = pointers.every((p) => p.callout === "Daten unvollständig");
        return (
          <Section
            eyebrow="Domänen"
            title="Drill-down"
            trailing={
              <Link href={`/?d=${periodKey}`} className="text-caption hover:text-[var(--color-text)]">
                Tagesansicht →
              </Link>
            }
          >
            {allIncomplete ? (
              <Card variant="soft">
                <CardBody className="p-5 flex flex-col gap-2">
                  <Pill tone="low" size="sm">Daten unvollständig</Pill>
                  <p className="text-body-sm text-muted">
                    Domain-Drill-downs werden nach Tagesende final berechnet. Detail-Seiten zeigen aktuelle Rohdaten.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {pointers.map((p) => (
                      <Link
                        key={p.domain}
                        href={`/${
                          p.domain === "activity" ? "activity" : p.domain === "recovery" ? "recovery" : "sleep"
                        }/${periodKey}`}
                        className="text-caption hover:text-[var(--color-text)] underline decoration-dotted"
                      >
                        {p.label_de} →
                      </Link>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {pointers.map((p, i) => (
                  <DomainPointerCard key={i} pointer={p} date={periodKey} />
                ))}
              </div>
            )}
          </Section>
        );
      })()}
    </div>
  );
}
