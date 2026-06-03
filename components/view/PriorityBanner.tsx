"use client";

import { useState } from "react";
import Link from "next/link";

import { FadeRise } from "@/components/motion/fade-rise";
import { useViewState } from "@/lib/view-state/context";
import { cn } from "@/lib/cn";
import type { AnomalyEvent, PainFlag } from "@/runner/v4/types.ts";

/**
 * High-stakes, low-cardinality overlay directly under the hero. Surfaces
 * warn/critical anomalies and active pain flags. Renders nothing when both are
 * empty — no placeholder container, no nag.
 */
export function PriorityBanner() {
  const { view } = useViewState();
  const ctx = view?.tier1?.context;
  const anomalies = (ctx?.anomalies_today ?? []).filter(
    (a) => a.severity === "warn" || a.severity === "critical",
  );
  const pains = ctx?.pain_flags_active ?? [];

  if (anomalies.length === 0 && pains.length === 0) return null;

  return (
    <FadeRise className="flex flex-col gap-2">
      {anomalies.map((a) => (
        <AnomalyRow key={a.code} anomaly={a} />
      ))}
      {pains.map((p, i) => (
        <PainRow key={`${p.region}-${i}`} pain={p} />
      ))}
    </FadeRise>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AnomalyEvent }) {
  const { period_key } = useViewState();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const critical = anomaly.severity === "critical";
  const tone = critical ? "var(--color-tier-s1)" : "var(--color-tier-s2)";

  const explain = async (): Promise<void> => {
    if (busy || done) return;
    setBusy(true);
    try {
      // Fire the anomaly_explain event slot (observation = the anomaly code).
      await fetch(`/api/view/${period_key}/event/anomaly_explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation_id: anomaly.code }),
      });
      setDone(true);
    } catch {
      // best-effort; the slot will also surface via SSE when computed
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border p-3.5"
      style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${tone} 10%, transparent)` }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone }} />
        <div className="min-w-0">
          <p className="text-[0.875rem] font-semibold text-[var(--color-text-strong)]">
            {anomaly.headline_de}
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-[var(--color-text-muted)]">
            {anomaly.message_de}
          </p>
        </div>
      </div>
      {done ? (
        // The explanation renders on the day-detail page (anomaly_explain has no
        // home card); link there so "Warum?" isn't a dead-end. It streams in via
        // SSE on that page once the slot computes.
        <Link
          href={`/day/${period_key}#anomaly_explain-${anomaly.code}`}
          className="shrink-0 rounded-[var(--radius-pill)] px-3 py-1.5 text-[0.75rem] font-medium ring-1 ring-inset ring-[var(--color-border-strong)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          Ansehen →
        </Link>
      ) : (
        <button
          type="button"
          onClick={explain}
          disabled={busy}
          className={cn(
            "shrink-0 rounded-[var(--radius-pill)] px-3 py-1.5 text-[0.75rem] font-medium ring-1 ring-inset transition-colors",
            "ring-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:opacity-50",
          )}
        >
          {busy ? "…" : "Warum?"}
        </button>
      )}
    </div>
  );
}

function PainRow({ pain }: { pain: PainFlag }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[var(--radius-card)] border p-3.5"
      style={{
        borderColor: "color-mix(in srgb, var(--color-temp) 30%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--color-temp) 8%, transparent)",
      }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-temp)]" />
      <p className="text-[0.8125rem] text-[var(--color-text)]">
        Schmerz gemeldet: <span className="font-medium">{pain.region}</span>
        <span className="text-[var(--color-text-subtle)]"> · Stärke {pain.severity}</span>
      </p>
    </div>
  );
}
