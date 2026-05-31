"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";

/**
 * Live view of the runner's PULSE_RUN table — what is running NOW, what
 * finished recently, what failed, and per-cluster p50/p95 baselines.
 *
 * Polling cadence is 5 s. The shape mirrors /api/runner/status; we don't
 * try to subscribe via SSE because the in-flight set is small and the
 * dashboard tab is paused when backgrounded, so polling is plenty.
 */

interface InFlightRun {
  run_id: string;
  cluster: string;
  key: string;
  scope: string;
  stage: string | null;
  attempt: number;
  status: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  elapsed_ms_live: number | null;
  silence_ms: number | null;
  prompt_chars: number | null;
  eval_tokens: number | null;
  error_text: string | null;
  parent_run_id: string | null;
}

interface RecentRun {
  run_id: string;
  cluster: string;
  key: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  error_text: string | null;
  stage: string | null;
  attempt: number;
}

interface ClusterStat {
  cluster: string;
  count: number;
  ok_count: number;
  fail_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

interface StatusPayload {
  ok: true;
  generated_at: string;
  in_flight: InFlightRun[];
  recent: RecentRun[];
  failures: RecentRun[];
  stats: ClusterStat[];
}

const POLL_MS = 5_000;

export function RunnerStatusPanel() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/runner/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatusPayload | { ok: false; error: string };
        if (cancelled) return;
        if (json.ok) {
          setData(json);
          setError(null);
        } else {
          setError(json.error);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLastFetched(Date.now());
          timer = setTimeout(tick, POLL_MS);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const statsByCluster = useMemo(() => {
    const map = new Map<string, ClusterStat>();
    for (const s of data?.stats ?? []) map.set(s.cluster, s);
    return map;
  }, [data?.stats]);

  return (
    <div className="flex flex-col gap-6">
      <Section
        eyebrow="Runner"
        title="Live"
        trailing={
          <span className="text-xs text-foreground/60">
            {lastFetched ? `${ago(lastFetched)} ago` : "—"}
            {error ? ` · ${error}` : ""}
          </span>
        }
      >
        {(data?.in_flight ?? []).length === 0 ? (
          <Card variant="soft">
            <CardBody>
              <div className="text-sm text-foreground/60">Idle — keine laufenden Jobs.</div>
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-3">
            {(data?.in_flight ?? []).map((run) => (
              <InFlightCard
                key={run.run_id}
                run={run}
                stat={statsByCluster.get(run.cluster) ?? null}
              />
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Letzte Fehler" title="Failures">
        {(data?.failures ?? []).length === 0 ? (
          <Card variant="soft">
            <CardBody>
              <div className="text-sm text-foreground/60">Keine Fehler in letzten 20 Läufen.</div>
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-2">
            {(data?.failures ?? []).map((r) => (
              <FailureRow key={r.run_id} run={r} />
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Verlauf" title="Recent">
        <div className="grid gap-2">
          {(data?.recent ?? []).map((r) => (
            <RecentRow key={r.run_id} run={r} />
          ))}
        </div>
      </Section>

      <Section eyebrow="Baselines" title="Per-cluster (last 50)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(data?.stats ?? []).map((s) => (
            <ClusterStatRow key={s.cluster} stat={s} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function InFlightCard({ run, stat }: { run: InFlightRun; stat: ClusterStat | null }) {
  const elapsed = run.elapsed_ms_live ?? 0;
  const p95 = stat?.p95_ms ?? null;
  // Progress is elapsed/p95 capped at 100%. When p95 is null we show a
  // soft pulse strip instead of a bar.
  const pct = p95 && p95 > 0 ? Math.min(100, Math.round((elapsed / p95) * 100)) : null;
  const silenceTooLong = (run.silence_ms ?? 0) > 90_000;
  const overP95 = p95 != null && elapsed > p95;

  return (
    <Card variant="surface">
      <CardBody>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{run.cluster}</Eyebrow>
            <div className="text-sm font-medium">
              {run.key}
              {run.stage && <span className="text-foreground/60"> · {run.stage}</span>}
              {run.attempt > 1 && (
                <span className="text-foreground/60"> · attempt {run.attempt}</span>
              )}
            </div>
          </div>
          <div className="text-xs text-foreground/60 flex items-center gap-2">
            {silenceTooLong && <Pill tone="s2">silent {humanMs(run.silence_ms ?? 0)}</Pill>}
            {overP95 && <Pill tone="s2">over p95</Pill>}
            <span>{humanMs(elapsed)}</span>
            {p95 != null && <span>· p95 {humanMs(p95)}</span>}
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
          {pct != null ? (
            <div
              className={`h-full ${overP95 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-foreground/20" />
          )}
        </div>
        {run.prompt_chars != null && (
          <div className="mt-2 text-xs text-foreground/50">
            prompt_chars={run.prompt_chars.toLocaleString("de-DE")}
            {run.eval_tokens != null && ` · eval=${run.eval_tokens.toLocaleString("de-DE")}`}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FailureRow({ run }: { run: RecentRun }) {
  return (
    <Card variant="soft">
      <CardBody>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{run.cluster}</Eyebrow>
            <div className="text-sm">
              {run.key}
              {run.stage && <span className="text-foreground/60"> · {run.stage}</span>}
              {run.attempt > 1 && (
                <span className="text-foreground/60"> · attempt {run.attempt}</span>
              )}
            </div>
            {run.error_text && (
              <div className="text-xs text-rose-500/90 font-mono truncate max-w-prose">
                {run.error_text}
              </div>
            )}
          </div>
          <div className="text-xs text-foreground/60 shrink-0">
            {run.finished_at && relativeFromIso(run.finished_at)}
            {run.elapsed_ms != null && ` · ${humanMs(run.elapsed_ms)}`}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RecentRow({ run }: { run: RecentRun }) {
  const ok = run.status === "ok";
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm py-1 border-b border-foreground/5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            ok ? "bg-emerald-500" : run.status === "orphaned" ? "bg-amber-500" : "bg-rose-500"
          }`}
        />
        <span className="text-foreground/80">{run.cluster}</span>
        <span className="text-foreground/50">{run.key}</span>
        {run.stage && <span className="text-foreground/40">· {run.stage}</span>}
      </div>
      <div className="text-xs text-foreground/50">
        {run.finished_at && relativeFromIso(run.finished_at)}
        {run.elapsed_ms != null && ` · ${humanMs(run.elapsed_ms)}`}
      </div>
    </div>
  );
}

function ClusterStatRow({ stat }: { stat: ClusterStat }) {
  return (
    <Card variant="soft">
      <CardBody>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col">
            <Eyebrow>{stat.cluster}</Eyebrow>
            <div className="text-xs text-foreground/60">
              {stat.count} runs · {stat.ok_count} ok · {stat.fail_count} fail
            </div>
          </div>
          <div className="text-xs text-foreground/70 font-mono">
            p50 {stat.p50_ms != null ? humanMs(stat.p50_ms) : "—"}
            {" · "}
            p95 {stat.p95_ms != null ? humanMs(stat.p95_ms) : "—"}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function humanMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function ago(ms: number): string {
  const dt = Date.now() - ms;
  if (dt < 1500) return "<1s";
  return humanMs(dt);
}

function relativeFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "?";
  return `${ago(t)} ago`;
}
