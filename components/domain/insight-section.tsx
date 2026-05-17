import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { ScoreRing } from "@/components/ui/score-ring";
import type {
  SleepInsightV3,
  RecoveryInsightV3,
  ActivityInsightV3,
  KpiItem,
  SuggestionToday,
  SuggestionLongTerm,
  Band,
} from "@/lib/types/v3";

type AnyInsight = SleepInsightV3 | RecoveryInsightV3 | ActivityInsightV3;

/**
 * Drill-down insight panel: hero KPI + analysis_today + analysis_context +
 * KPI list (with per-item reasoning) + suggestions stack (today + long_term).
 *
 * Used at the top of /sleep/[date], /recovery/[date], /activity/[date].
 */
export function InsightSection({
  insight,
  domainLabel,
}: {
  insight: AnyInsight | null;
  domainLabel: string;
}) {
  if (!insight || !Array.isArray(insight.kpis)) {
    return (
      <Card>
        <CardBody className="p-5">
          <Eyebrow>{domainLabel}</Eyebrow>
          <p className="text-body-sm text-muted mt-2">
            Noch keine Analyse für diesen Tag.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (insight.abstain) {
    return (
      <Card>
        <CardBody className="p-5 flex flex-col gap-2">
          <Eyebrow>{domainLabel}</Eyebrow>
          <Pill tone="low" size="sm">
            Wenig Signal
          </Pill>
          <p className="text-body-sm text-muted">
            {insight.abstain_reason ??
              "Nicht genug Daten für eine Analyse heute."}
          </p>
        </CardBody>
      </Card>
    );
  }

  const coreKpi = insight.kpis[0];
  const restKpis = insight.kpis.slice(1);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <Card glow={bandGlow(coreKpi?.band ?? null)}>
        <CardBody className="p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
          <div className="flex flex-col items-center gap-2 lg:w-[200px]">
            <ScoreRing score={coreKpi?.value ?? 0} band={coreKpi?.band ?? null} size={160} />
            <Pill tone={bandTone(coreKpi?.band ?? null)} size="sm">
              {coreKpi?.label_de ?? domainLabel}
            </Pill>
          </div>
          <div className="flex flex-col gap-3">
            <Eyebrow>{domainLabel}</Eyebrow>
            {insight.headline && (
              <h1 className="text-h1">{insight.headline}</h1>
            )}
            {insight.summary_long && (
              <p className="text-body text-muted max-w-[64ch]">
                {insight.summary_long}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Analysis ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {insight.analysis_today && (
          <AnalysisCard title="Heute" body={insight.analysis_today} />
        )}
        {insight.analysis_context && (
          <AnalysisCard title="Im Kontext" body={insight.analysis_context} />
        )}
      </div>

      {/* ── KPIs (rest, with reasoning) ─────────────────────────────────── */}
      {restKpis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {restKpis.map((k) => (
            <KpiDetailCard key={k.id} kpi={k} />
          ))}
        </div>
      )}

      {/* ── Suggestions today ───────────────────────────────────────────── */}
      {Array.isArray(insight.suggestions_today) && insight.suggestions_today.length > 0 && (
        <SuggestionStack
          title="Heute klein"
          horizonLabel="heute"
          suggestions={insight.suggestions_today}
        />
      )}

      {/* ── Suggestions long-term ───────────────────────────────────────── */}
      {Array.isArray(insight.suggestions_long_term) && insight.suggestions_long_term.length > 0 && (
        <LongTermStack suggestions={insight.suggestions_long_term} />
      )}
    </div>
  );
}

function AnalysisCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardBody className="p-5 flex flex-col gap-2">
        <Eyebrow>{title}</Eyebrow>
        <p className="text-body-sm">{body}</p>
      </CardBody>
    </Card>
  );
}

function KpiDetailCard({ kpi }: { kpi: KpiItem }) {
  return (
    <Card glow={bandGlow(kpi.band)}>
      <CardBody className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-h4 font-medium">{kpi.label_de}</h3>
          <span className="num text-h3 font-semibold tabular-nums">
            {kpi.value}
          </span>
        </div>
        <Pill tone={bandTone(kpi.band)} size="sm">
          {bandLabel(kpi.band)}
        </Pill>
        <p className="text-body-sm text-muted">{kpi.reasoning}</p>
      </CardBody>
    </Card>
  );
}

function SuggestionStack({
  title,
  horizonLabel,
  suggestions,
}: {
  title: string;
  horizonLabel: string;
  suggestions: SuggestionToday[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-h3 font-medium">{title}</h2>
        <Pill tone="low" size="sm">
          {horizonLabel}
        </Pill>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.map((s, i) => (
          <Card key={i} glow="activity">
            <CardBody className="p-4 flex flex-col gap-1.5">
              <Eyebrow>⚓ {s.anchor}</Eyebrow>
              <p className="text-body font-medium">{s.tiny}</p>
              <p className="text-body-sm text-muted">{s.why}</p>
              <details className="mt-1 text-caption text-muted cursor-pointer">
                <summary>Begründung</summary>
                <p className="mt-1">{s.reasoning}</p>
              </details>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function LongTermStack({ suggestions }: { suggestions: SuggestionLongTerm[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h3 font-medium">Längerfristig</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.map((s, i) => (
          <Card key={i}>
            <CardBody className="p-4 flex flex-col gap-1.5">
              <Pill tone="low" size="sm">
                {horizonLabel(s.horizon)}
              </Pill>
              <p className="text-body font-medium">{s.action}</p>
              <p className="text-body-sm text-muted">{s.why}</p>
              <details className="mt-1 text-caption text-muted cursor-pointer">
                <summary>Begründung</summary>
                <p className="mt-1">{s.reasoning}</p>
              </details>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function horizonLabel(h: SuggestionLongTerm["horizon"]): string {
  return h === "this_week" ? "Diese Woche" : "Diesen Monat";
}

function bandLabel(b: Band | null): string {
  return b === "above_usual"
    ? "Über Normal"
    : b === "below_usual"
      ? "Unter Normal"
      : b === "steady"
        ? "Stabil"
        : "—";
}

function bandTone(b: Band | null): "up" | "down" | "steady" | "low" {
  return b === "above_usual"
    ? "up"
    : b === "below_usual"
      ? "down"
      : b === "steady"
        ? "steady"
        : "low";
}

function bandGlow(b: Band | null): "activity" | "stress" | "sleep" {
  return b === "above_usual" ? "activity" : b === "below_usual" ? "stress" : "sleep";
}
