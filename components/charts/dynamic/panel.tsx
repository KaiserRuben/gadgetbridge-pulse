"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";
import {
  CHIP_PRESETS,
  parseChartSpec,
  type DynamicChartSpec,
} from "@/lib/chart-spec";
import type { DynamicChartData } from "@/lib/queries/dynamic";
import { DynamicChartFactory } from "./factory";
import { metricColor, metricLabel, metricUnitDisplay } from "./meta";

const STORAGE_KEY = "pulse:chart-spec:v1";
const FALLBACK_PRESET_ID = "sleep_30d_trend";

/**
 * Interactive controller for the LLM-driven dynamic chart. Wraps:
 *   - chip strip (chip presets, no LLM call)
 *   - free-text input (POSTs /api/chart, falls back on chip if endpoint fails)
 *   - chart canvas (DynamicChartFactory)
 *
 * The current spec is mirrored in localStorage so a refresh keeps the same
 * view. Initial render uses `initialData` from the server.
 */
export function DynamicChartPanel({
  initialData,
  initialSpecId,
}: {
  initialData: DynamicChartData;
  initialSpecId?: string;
}) {
  const [data, setData] = useState<DynamicChartData>(initialData);
  const [activeChip, setActiveChip] = useState<string | null>(initialSpecId ?? null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  // Restore last spec on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { spec?: unknown; chip?: string };
      if (parsed.chip && CHIP_PRESETS.find((p) => p.id === parsed.chip)) {
        applyChip(parsed.chip);
      } else if (parsed.spec) {
        const spec = parseChartSpec(parsed.spec);
        if (spec) refetchSpec(spec).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current spec.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ spec: data.spec, chip: activeChip }),
      );
    } catch {
      /* ignore */
    }
  }, [data.spec, activeChip]);

  async function applyChip(id: string) {
    const preset = CHIP_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setActiveChip(id);
    setError(null);
    setBusy(true);
    try {
      const next = await refetchSpec(preset.spec);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPrompt() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setActiveChip(null);
    try {
      const res = await fetch("/api/chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(msg.slice(0, 160));
      }
      const json = (await res.json()) as { spec: DynamicChartSpec; data: DynamicChartData };
      const spec = parseChartSpec(json.spec);
      if (!spec) throw new Error("Antwort ungültig");
      startTransition(() => {
        setData(json.data);
      });
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)) +
          " — fallback auf Chip-Modus.",
      );
      const fallback =
        CHIP_PRESETS.find((p) => p.id === FALLBACK_PRESET_ID) ?? CHIP_PRESETS[0];
      if (fallback) await applyChip(fallback.id);
    } finally {
      setBusy(false);
    }
  }

  const isPending = busy || pending;

  return (
    <Card>
      <CardBody className="p-4 md:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Eyebrow>Pulse Chat</Eyebrow>
            <span className="text-caption text-subtle">{data.spec.reasoning}</span>
          </div>
          <span className="text-caption num-mono text-subtle">
            {data.range.start} → {data.range.end}
          </span>
        </div>

        {data.series.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap text-caption">
            {data.series.map((s) => {
              const unit = metricUnitDisplay(s.metric);
              return (
                <span key={s.metric} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: metricColor(s.metric) }}
                    aria-hidden
                  />
                  <span className="text-[var(--color-text)]">{metricLabel(s.metric)}</span>
                  {unit && <span className="text-subtle num-mono">{unit}</span>}
                </span>
              );
            })}
          </div>
        )}

        <div
          className="-mx-1 px-1 overflow-x-auto snap-x scroll-px-1"
          style={{
            maskImage: "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
          }}
        >
          <div className="flex gap-1.5 min-w-max">
            {CHIP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyChip(p.id)}
                disabled={isPending}
                className={cn(
                  "shrink-0 snap-start inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] text-[0.75rem] font-medium ring-1 ring-inset transition-colors",
                  activeChip === p.id
                    ? "bg-[var(--color-text)]/10 text-[var(--color-text)] ring-[var(--color-text)]/30"
                    : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] ring-[var(--color-border)] hover:text-[var(--color-text)]",
                  isPending && "opacity-50 cursor-not-allowed",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-[240px]">
          {isPending && (
            <div className="absolute inset-0 grid place-items-center bg-[var(--color-surface)]/60 backdrop-blur-sm z-10 text-caption rounded-xl">
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-[var(--color-sleep)] animate-pulse" />
                lade…
              </span>
            </div>
          )}
          <DynamicChartFactory data={data} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor="dynamic-chart-prompt" className="text-caption text-subtle inline-flex items-center gap-1.5">
            <Glyph name="Brain" size={11} />
            Frage stellen — KI generiert ein passendes Diagramm
          </label>
          <div className="flex items-center gap-2">
            <input
              id="dynamic-chart-prompt"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="z. B. Schlaf der letzten 60 Tage vs Vorperiode"
              maxLength={400}
              className="flex-1 h-10 px-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[0.875rem] outline-none focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-[var(--color-text)]/20"
              disabled={isPending}
            />
            <button
              type="submit"
              disabled={isPending || prompt.trim().length === 0}
              className="grid place-items-center size-10 rounded-xl bg-[var(--color-text)] text-[var(--color-bg)] disabled:opacity-30"
              aria-label="Senden"
            >
              <Glyph name="ArrowRight" size={16} />
            </button>
          </div>
        </form>

        {error && (
          <Pill tone="down" size="sm" className="self-start">
            {error}
          </Pill>
        )}
      </CardBody>
    </Card>
  );
}

async function refetchSpec(spec: DynamicChartSpec): Promise<DynamicChartData> {
  // Server already exposes a fetcher via /api/chart (GET-style by spec).
  // To avoid re-running the LLM for chip presets we POST to the same route
  // with `spec` instead of `prompt` — the route accepts either branch.
  const res = await fetch("/api/chart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spec }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(t.slice(0, 160));
  }
  return ((await res.json()) as { data: DynamicChartData }).data;
}
