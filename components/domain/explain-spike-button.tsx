"use client";

import { DerivedCell, type CellState } from "@/components/derived/DerivedCell";
import { Glyph } from "@/components/ui/glyph";
import type { AnomalyExplanationPayload } from "@/runner/clusters/anomaly_explain/types";

/**
 * "Warum?" — anomaly-explanation surface.
 *
 * Thin wrapper over <DerivedCell cluster="anomaly_explain" ...>. The
 * bespoke fetch + 4-state animation logic that used to live here moved
 * into the runner's JobCell pipeline (cluster `anomaly_explain`); this
 * component just selects the right cell key per call site and renders
 * the hypothesis list.
 *
 * Two call shapes:
 *  - Driver mode: `<ExplainSpikeButton observationId="..." date={...} />`
 *  - Spike mode:  `<ExplainSpikeButton metric="hr" ts={1731676800000} date={...} />`
 *
 * `date` is passed through to scope the cell to the wake-date period
 * (currently unused by the cell key itself but reserved for future
 * disambiguation when the same observation_id repeats across periods).
 */

export interface ExplainSpikeButtonProps {
  /** Driver mode: existing observation_id from daily.json drivers. */
  observationId?: string;
  /** Spike mode: metric type for the synthetic observation. */
  metric?: "hr" | "rhr" | "spo2" | "stress" | "hrv" | "steps" | "temp";
  /** Spike mode: unix-ms timestamp on the chart. */
  ts?: number;
  /** YYYY-MM-DD wake-date period the cell belongs to. */
  date: string;
}

export function ExplainSpikeButton(props: ExplainSpikeButtonProps) {
  const { observationId, metric, ts, date } = props;
  const cellKey = observationId ?? (metric && ts != null ? `manual_${metric}_${ts}` : null);
  if (!cellKey) return null;

  return (
    <DerivedCell<AnomalyExplanationPayload>
      cluster="anomaly_explain"
      cellKey={cellKey}
      scope="daily"
      emptyCtaLabel="Warum?"
      fallback={<ExplanationLoading />}
      render={(payload, state) => <HypothesisList payload={payload} state={state} />}
      // Anomaly LLM calls can take ~25s on qwen3.6 — poll a touch faster
      // than the default so the user sees the result land promptly.
      activeIntervalMs={1500}
    />
  );
}

function ExplanationLoading() {
  return (
    <div className="flex items-center gap-2 text-caption text-subtle px-3 py-2">
      <Glyph name="Sparkles" size={14} className="animate-pulse" />
      <span>Werte Anomalie aus…</span>
    </div>
  );
}

function HypothesisList({
  payload,
  state,
}: {
  payload: AnomalyExplanationPayload;
  state: CellState;
}) {
  const hypotheses = payload.hypotheses ?? [];
  if (hypotheses.length === 0) {
    return (
      <div className="text-caption text-subtle">
        Keine Hypothesen verfügbar.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-4 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <span className="eyebrow">LLM-Hypothesen</span>
        {state === "ready_cached" && (
          <span className="text-caption num-mono text-subtle">cache</span>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {hypotheses.map((h, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[0.875rem] font-medium">{h.factor}</span>
              <span className="text-caption num-mono text-subtle">{h.strength}</span>
            </div>
            <p className="text-caption text-muted leading-snug">{h.rationale}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
