import { readFileSync } from "node:fs";
import path from "node:path";
import { CoachSnapshotSchema } from "../../schemas/snapshot/coach.ts";
import { buildSystem } from "../shared.ts";
import type { SnapshotFactsBundle } from "../../facts/snapshot.ts";
import { register } from "./registry.ts";
import { config } from "../../config.ts";

const ADDENDUM = `DOMAIN: coach (top-level synthesiser)

YOU ARE NOT WRITING ANOTHER DOMAIN ANALYSIS.
You read the SIX domain insights below and produce ONE top-level verdict that
prioritises across them. Your output is the user's daily punch line.

INPUT MAP (read each insight; cite from them, do NOT regenerate)
- sleep, cardio, activity, body, stress, anomalies

CONFLICT RESOLUTION (mandatory)
- If sleep says rest and cardio says push, sleep wins (recovery first).
- If anomalies has any "warn" or "critical" active, verdict.next_action MUST be a maintenance / investigation action — never push training load.
- If two domains both rate poor, the one with HIGHER confidence drives the verdict.
- If no negatives surface, focus on a maintenance/progression action.

PATTERNS — CROSS-DOMAIN
- patterns[].involved_metrics MUST contain metric_ids from ≥2 different domain insights when possible (e.g. ["sleep.stats.latency_min", "stress.peak.value"]).
- One pattern should be a synthesis statement: e.g. "high latency + evening stress peak + low HRV all point to autonomic load before bed".

DRIVERS
- Pick exactly 3 from across the input domains. Prefer drivers that already came up in two or more inputs (recurring across domains beats one big single-domain finding).
- driver.metric_id should reference a SOURCE domain prefix when ambiguous, e.g. "sleep.stats.latency_min" or "cardio.hr.max".

NEXT_ACTION
- Pick ONE action — the highest-leverage cross-domain lever.
- next_action.targets_metric MUST point at a SPECIFIC source metric_id from one of the input insights.
- Title is plain English; why cites the strongest 1-2 numbers from the inputs.

UPWARD_SIGNALS
- tags: distil to ≤8 high-signal tags that the user / next-period coach should remember. Aggregate similar tags across domains (e.g. if sleep tags "sleep_latency_high" and stress tags "evening_peak", coach can tag "evening_arousal_load").
- for_coach: keys for higher-period coach prompts (week, month) — pre-aggregated metrics worth tracking.
- for_weekly_trend: 3–5 metric_ids that should be tracked across the rolling week.
- anomalies_flagged: pull through anything from input anomalies/upward_signals.

CONFIDENCE FACTORS (rubric — score each 0..1, weighted)
- inputs_completeness (0.30): present_count / 6 (number of input insight files non-stub).
- inputs_confidence_avg (0.25): mean of the input domains' confidence.value. Coach confidence MUST NOT exceed this avg by more than +0.10.
- cross_domain_agreement (0.20): how many input ratings move in the same direction. All-aligned = 1.0; perfect split = 0.4.
- anomaly_clarity (0.10): 1.0 if no critical/warn active anomalies, or all are typed (data-quality vs biological); lower if ambiguous.
- baseline_available (0.10): 0 if no input has baseline; partial otherwise.
- freshness (0.05): 1.0 if all inputs were generated within 6h.

For snapshot/coach: confidence.value MUST be ≤ 0.70 with ceiling_reason="single_day_window". calc may run higher; value is the capped read.
`;

type DomainInsight = Record<string, unknown> & {
  domain?: string;
  verdict?: { rating?: string; score_0_100?: number; headline?: string };
  confidence?: { value?: number };
  upward_signals?: { tags?: string[] };
};

function loadDomainInsight(periodKey: string, domain: string): DomainInsight | null {
  const p = path.join(config.insightsRoot, "snapshot", periodKey, `${domain}.json`);
  try {
    const txt = readFileSync(p, "utf8");
    return JSON.parse(txt) as DomainInsight;
  } catch {
    return null;
  }
}

const DOMAIN_ORDER = ["sleep", "cardio", "activity", "body", "stress", "anomalies"];

export const CoachSnapshotPrompt = {
  domain: "coach" as const,
  timeframe: "snapshot" as const,
  system: buildSystem(ADDENDUM),
  schema: CoachSnapshotSchema,

  buildUser(facts: SnapshotFactsBundle): string {
    const insights = DOMAIN_ORDER.map((d) => ({
      domain: d,
      insight: loadDomainInsight(facts.period_key, d),
    }));
    const present = insights.filter((x) => x.insight !== null);
    const missing = insights.filter((x) => x.insight === null).map((x) => x.domain);

    if (present.length === 0) {
      return `PERIOD: snapshot · ${facts.period_key}\nNO DOMAIN INSIGHTS PRESENT.\n\nProduce a stub: verdict.rating="poor", verdict.score_0_100=0, verdict.headline="No domain insights to synthesise.", confidence.value=0.0, ceiling_reason="sparse_data", upward_signals.tags=["no_inputs"], next_action=null.`;
    }

    /**
     * Slim each insight to only the fields coach needs. Full bodies blew past
     * num_ctx and the model couldn't emit a complete schema. Coach reads:
     * verdict, top 3 metric_findings, top 3 limiters, all tags, anomalies.
     */
    const slim = present.map(({ domain, insight }) => {
      const v = (insight?.verdict ?? {}) as Record<string, unknown>;
      const c = (insight?.confidence ?? {}) as { value?: number };
      const findings = ((insight?.metric_findings as Array<Record<string, unknown>>) ?? []).slice(
        0,
        3,
      );
      const lims = ((insight?.limiters as Array<Record<string, unknown>>) ?? []).slice(0, 3);
      const tags = (insight?.upward_signals as { tags?: string[] })?.tags ?? [];
      const anomalies =
        (insight?.upward_signals as { anomalies_flagged?: unknown[] })?.anomalies_flagged ?? [];
      return {
        domain,
        rating: v.rating,
        score: v.score_0_100,
        confidence: c.value,
        headline: v.headline,
        drivers: v.drivers,
        next_action: v.next_action,
        top_findings: findings.map((f) => ({
          metric_id: f.metric_id,
          value: f.value,
          unit: f.unit,
          vs_norm: f.vs_norm,
          interpretation: f.interpretation,
        })),
        top_limiters: lims.map((l) => ({ kind: l.kind, text: l.text })),
        tags,
        anomalies,
      };
    });

    return `PERIOD: snapshot · ${facts.period_key}
INPUTS PRESENT: ${present.length}/${DOMAIN_ORDER.length}${missing.length ? ` · MISSING: ${missing.join(", ")}` : ""}

INPUT SUMMARIES (slim — verdict + top findings + tags + anomalies):
${JSON.stringify(slim, null, 2)}

PRODUCE: insights/snapshot/${facts.period_key}/coach.json (envelope is added by the runner; emit only the schema fields). Synthesise across the inputs above; do NOT regenerate per-domain analysis. Reference input metric_ids and tags directly.

EMIT ALL REQUIRED FIELDS: context_summary, observations (≥3), metric_findings (≥3), patterns (≥1), limiters (≥1), evidence (≥2), comparison (object), verdict (object with rating/score_0_100/headline/drivers/next_action), confidence (object with value/calc/math_check_passed/ceiling_reason/factors/reasoning), upward_signals (object).`;
  },
};

register(CoachSnapshotPrompt);
export default CoachSnapshotPrompt;
