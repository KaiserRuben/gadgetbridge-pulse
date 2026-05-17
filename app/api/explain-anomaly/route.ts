import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DailyInsightV2 } from "@/lib/types/generated";
import { getActivityMinutes, getDaySummary } from "@/lib/queries/activity";
import { getStress, getTemperature, getHrv } from "@/lib/queries/biometrics";
import { windowForDate } from "@/lib/time";
import {
  explainAnomaly,
  type AnomalyExplanationInput,
} from "@/runner/analyzer/anomaly-explanation.ts";
import { validateExplanation } from "@/runner/analyzer/anomaly-validator.ts";
import {
  readCachedExplanation,
  writeCachedExplanation,
} from "@/runner/analyzer/explanation-cache.ts";

export const dynamic = "force-dynamic";

const SYNC_ROOT = process.env.PULSE_ROOT ?? "./pulse";
const INSIGHTS_ROOT = process.env.INSIGHTS_ROOT ?? path.join(SYNC_ROOT, "insights");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9_]+$/;
const METRIC_RE = /^(hr|rhr|hrv|spo2|stress|steps|temp)$/;

type DriverMode = { mode: "driver"; observation_id: string; date: string };
type SpikeMode = { mode: "spike"; ts: number; metric: string; date: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function tsToBerlinDate(ts: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date(ts));
}

function validateBody(input: unknown): DriverMode | SpikeMode | string {
  if (!isObject(input)) return "body must be a JSON object";
  // Spike mode: { ts, metric, date? }
  if (typeof input.ts === "number" && Number.isFinite(input.ts) && input.ts > 0) {
    const metric = input.metric;
    if (typeof metric !== "string" || !METRIC_RE.test(metric)) {
      return "metric must be one of: hr, rhr, hrv, spo2, stress, steps, temp";
    }
    const dateRaw = input.date;
    let date: string;
    if (typeof dateRaw === "string" && DATE_RE.test(dateRaw)) {
      date = dateRaw;
    } else {
      date = tsToBerlinDate(input.ts);
    }
    return { mode: "spike", ts: input.ts, metric, date };
  }
  // Driver mode: { observation_id, date }
  const { observation_id, date } = input;
  if (typeof observation_id !== "string" || !ID_RE.test(observation_id)) {
    return "observation_id must be a [a-z0-9_]+ string (or pass {ts, metric} for spike mode)";
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return "date must be YYYY-MM-DD";
  }
  return { mode: "driver", observation_id, date };
}

function priorDates(periodKey: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${periodKey}T00:00:00Z`);
  for (let i = 1; i <= n; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function loadFactsWindow(periodKey: string): Promise<object[]> {
  const dates = [periodKey, ...priorDates(periodKey, 6)];
  const out: object[] = [];
  for (const d of dates) {
    const fp = path.join(INSIGHTS_ROOT, "daily", d, "_facts.json");
    const facts = await readJsonOrNull<object>(fp);
    if (facts) out.push(facts);
  }
  return out;
}

async function loadObservationText(
  periodKey: string,
  observationId: string,
): Promise<string | null> {
  const dailyPath = path.join(INSIGHTS_ROOT, "daily", periodKey, "daily.json");
  const daily = await readJsonOrNull<DailyInsightV2>(dailyPath);
  if (!daily) return null;
  const driver = daily.drivers.find((d) => d.evidence_ids.includes(observationId));
  if (!driver) return null;
  return `${driver.clause} (${driver.delta_text})`;
}

/**
 * Build a synthetic observation_text for an arbitrary HR/RHR/etc. timestamp.
 * Strategy: pull DB samples in a ±15 min window around `ts`, find the local
 * peak (or trough for stress nadir / hr lows), and write a one-sentence
 * description the LLM can ground in the 7-day fact window.
 */
function buildSpikeObservation(
  ts: number,
  metric: string,
  date: string,
): { id: string; text: string } | null {
  const w = windowForDate(date);
  const tsSec = Math.round(ts / 1000);
  const fifteenMin = 15 * 60;
  const since = Math.max(w.since, tsSec - fifteenMin);
  const until = Math.min(w.until, tsSec + fifteenMin);

  let mins;
  let summary;
  try {
    mins = getActivityMinutes({ since, until });
    summary = getDaySummary(w);
  } catch {
    return null;
  }

  const hhmm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", hourCycle: "h23",
  }).format(new Date(ts));

  const id = `manual_${metric}_${ts}`;

  if (metric === "hr" || metric === "rhr") {
    const valid = mins.filter((m) => m.hr > 30 && m.hr < 220);
    if (valid.length === 0) return null;
    const peak = valid.reduce((p, c) => (Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p));
    const dayAvg = summary.hrAvg ?? 0;
    return {
      id,
      text: `Punktuelle Herzfrequenz von ${peak.hr} bpm um ${hhmm} (Tagesmittel ${Math.round(dayAvg)} bpm).`,
    };
  }

  if (metric === "spo2") {
    const valid = mins.filter((m) => m.spo2 > 50 && m.spo2 <= 100);
    if (valid.length === 0) return null;
    const closest = valid.reduce((p, c) => (Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p));
    return {
      id,
      text: `SpO₂ von ${closest.spo2}% um ${hhmm}.`,
    };
  }

  if (metric === "stress") {
    let samples: ReturnType<typeof getStress> = [];
    try { samples = getStress({ since, until }); } catch { samples = []; }
    if (samples.length === 0) return null;
    const closest = samples.reduce((p, c) => (Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p));
    const dayMean = (() => {
      try {
        const all = getStress(w);
        if (all.length === 0) return null;
        return Math.round(all.reduce((s, x) => s + x.stress, 0) / all.length);
      } catch { return null; }
    })();
    return {
      id,
      text: dayMean != null
        ? `Stress-Spitze von ${closest.stress} um ${hhmm} (Tagesmittel ${dayMean}).`
        : `Stress-Wert ${closest.stress} um ${hhmm}.`,
    };
  }

  if (metric === "hrv") {
    let samples: ReturnType<typeof getHrv> = [];
    try { samples = getHrv({ since, until }); } catch { samples = []; }
    if (samples.length === 0) return null;
    const closest = samples.reduce((p, c) => (Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p));
    return {
      id,
      text: `HRV (RMSSD) ${closest.ms.toFixed(1)} ms um ${hhmm}.`,
    };
  }

  if (metric === "temp") {
    let samples: ReturnType<typeof getTemperature> = [];
    try { samples = getTemperature({ since, until }); } catch { samples = []; }
    if (samples.length === 0) return null;
    const closest = samples.reduce((p, c) => (Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p));
    return {
      id,
      text: `Hauttemperatur ${closest.celsius.toFixed(1)} °C um ${hhmm}.`,
    };
  }

  if (metric === "steps") {
    // Cumulative steps in the ±15-minute window.
    const totalSteps = mins.filter((m) => m.steps > 0).reduce((s, m) => s + m.steps, 0);
    const dayTotal = summary.totalSteps ?? 0;
    return {
      id,
      text: `${totalSteps} Schritte zwischen ${fmtClock(since * 1000)}–${fmtClock(until * 1000)} (Tag ${dayTotal}).`,
    };
  }

  // Generic fallback.
  return {
    id,
    text: `Auffällige Messung von ${metric} um ${hhmm} am ${date}.`,
  };
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", hourCycle: "h23",
  });
}

/**
 * POST /api/explain-anomaly
 *
 * Driver mode: { observation_id, date (YYYY-MM-DD) }
 *   — bound to a daily-driver evidence_id; loads the originating driver
 *     clause from daily.json.
 *
 * Spike mode:  { ts (unix ms), metric, date? }
 *   — arbitrary timestamp on a chart. Builds a synthetic observation text
 *     from DB samples around `ts`. observation_id becomes
 *     `manual_<metric>_<ts>` so cache keys are stable per-chart-click.
 *
 * Cache-first either way. Validator runs on cache hits + misses; fact window
 * is the trailing 7 days of `_facts.json` ending on the resolved date.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = validateBody(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  // Resolve observation_id + date for cache key (mode-dependent).
  let observationId: string;
  let date: string;
  let observationText: string | null = null;

  if (parsed.mode === "spike") {
    const built = buildSpikeObservation(parsed.ts, parsed.metric, parsed.date);
    if (!built) {
      return NextResponse.json(
        { error: `no DB samples around ts=${parsed.ts} for metric=${parsed.metric}` },
        { status: 404 },
      );
    }
    observationId = built.id;
    date = parsed.date;
    observationText = built.text;
  } else {
    observationId = parsed.observation_id;
    date = parsed.date;
  }

  // Cache check.
  const cached = await readCachedExplanation(observationId, date, INSIGHTS_ROOT);
  if (cached) {
    const validation = validateExplanation(cached, {
      observation_id: observationId,
      period_key: date,
      observation_text: "",
      context_facts: await loadFactsWindow(date),
    });
    return NextResponse.json(
      { explanation: cached, validation, cache: "hit" },
      { headers: { "X-Cache": "hit" } },
    );
  }

  if (parsed.mode === "driver") {
    observationText = await loadObservationText(date, observationId);
    if (!observationText) {
      return NextResponse.json(
        { error: `observation '${observationId}' not found in daily.json for ${date}` },
        { status: 404 },
      );
    }
  }

  if (!observationText) {
    return NextResponse.json({ error: "no observation text resolved" }, { status: 500 });
  }

  const contextFacts = await loadFactsWindow(date);
  if (contextFacts.length === 0) {
    return NextResponse.json(
      { error: `no _facts.json found in 7-day window ending ${date}` },
      { status: 404 },
    );
  }

  const input: AnomalyExplanationInput = {
    observation_id: observationId,
    period_key: date,
    observation_text: observationText,
    context_facts: contextFacts,
  };

  let explanation;
  try {
    explanation = await explainAnomaly(input, { ollamaUrl: OLLAMA_URL, timeoutMs: 90_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[explain-anomaly] LLM call failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const validation = validateExplanation(explanation, input);
  if (!validation.ok) {
    console.warn(
      `[explain-anomaly] validator warnings for ${observationId}@${date}: ${validation.warnings.join("; ")}`,
    );
  }

  try {
    await writeCachedExplanation(
      observationId,
      date,
      explanation,
      INSIGHTS_ROOT,
    );
  } catch (err) {
    console.error(
      `[explain-anomaly] cache write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Don't fail the request — the explanation is still valid, the next call
    // just won't be able to skip Ollama.
  }

  return NextResponse.json(
    { explanation, validation, cache: "miss" },
    { headers: { "X-Cache": "miss" } },
  );
}
