/**
 * Surprise ranking — Phase 3 (PROBE_pattern_naming_and_surprise.md).
 *
 * Two-step pipeline:
 *   1. `computeSurpriseCandidates(periodKey)` — pure deterministic. Reads
 *      30 days of `_facts.json` ending at `periodKey`, projects each metric,
 *      computes (today − trailing-14d-mean) / std for each, hard-bands the
 *      label by |z|, returns the top |z| candidates. NO LLM call here.
 *   2. `frameSurpriseInsight(candidate)` — ONE Ollama call per candidate,
 *      sequential. Writes ≤60 char headline + ≤80 char reason. Schema-enforced
 *      maxLength. Anti-diagnostic system rule.
 *
 * Locked architecture per probe: math computes, LLM only frames. The probe
 * found the LLM unstable on free-text label categoricals (z=0.85 → low ↔
 * medium across reruns), so the surprise_label is computed deterministically
 * here and passed *into* the LLM prompt as ground truth — the LLM is NEVER
 * asked to choose the band.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FactsBundleV2 } from "@/lib/types/generated";
import { callOllama } from "../ollama.ts";

export type SurpriseLabel = "high" | "medium" | "low";
export type SurpriseDirection = "up" | "down";

export interface SurpriseCandidate {
  metric: string;
  metric_label_de: string;
  today_value: number;
  baseline_mean: number;
  baseline_std: number;
  z_score: number;
  surprise_label: SurpriseLabel;
  direction: SurpriseDirection;
  n_baseline: number;
  fragile: boolean;
}

export interface SurpriseInsight extends SurpriseCandidate {
  /** LLM-written, ≤60 chars. */
  headline_de: string;
  /** LLM-written, ≤80 chars. */
  reason_de: string;
}

export interface FrameSurpriseOptions {
  model?: string;
  ollamaUrl?: string;
  /**
   * TODO: no longer wired. `callOllama` uses a long-run dispatcher with
   * timeouts disabled. Kept for source compatibility.
   */
  timeoutMs?: number;
  /** YYYY-MM-DD anchor for the deterministic seed. */
  periodKey?: string;
}

interface MetricSpec {
  id: string;
  label_de: string;
  /** Project a `_facts.json` payload to a numeric value or null. */
  extract: (f: FactsBundleV2) => number | null;
}

const METRICS: readonly MetricSpec[] = [
  {
    id: "rhr_day_bpm",
    label_de: "Ruhepuls (Tag)",
    extract: (f) => num(f.cardio.metrics.rhr_day_bpm),
  },
  {
    id: "hr_max_bpm",
    label_de: "Maximalpuls",
    extract: (f) => num(f.cardio.metrics.hr_max_bpm),
  },
  {
    id: "hr_mean_bpm",
    label_de: "Durchschnittspuls",
    extract: (f) => num(f.cardio.metrics.hr_mean_bpm),
  },
  {
    id: "spo2_mean_pct",
    label_de: "SpO₂ Mittel",
    extract: (f) => num(f.cardio.metrics.spo2_mean_pct),
  },
  {
    id: "sleep_efficiency_pct",
    label_de: "Schlafeffizienz",
    extract: (f) => num(f.sleep?.metrics.sleep_efficiency_pct),
  },
  {
    id: "tst_min",
    label_de: "Schlafdauer",
    extract: (f) => num(f.sleep?.metrics.tst_min),
  },
  {
    id: "sleep_latency_min",
    label_de: "Einschlaflatenz",
    extract: (f) => num(f.sleep?.metrics.sleep_latency_min),
  },
  {
    id: "breath_rate_mean",
    label_de: "Atemfrequenz",
    extract: (f) => num(f.sleep?.metrics.breath_rate_mean),
  },
  {
    id: "rdi",
    label_de: "RDI",
    extract: (f) => num(f.sleep?.metrics.rdi),
  },
  {
    id: "steps",
    label_de: "Schritte",
    extract: (f) => num(f.activity.metrics.steps),
  },
  {
    id: "active_minutes",
    label_de: "Aktive Minuten",
    extract: (f) => num(f.activity.metrics.active_minutes),
  },
  {
    id: "stress_mean",
    label_de: "Stress-Mittel",
    extract: (f) => num(f.stress.metrics.stress_mean),
  },
];

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Iterate dates ending at `periodKey` going back `daysBack` (inclusive).
 * Returned in chronological ascending order.
 */
function priorDatesInclusive(periodKey: string, daysBack: number): string[] {
  const out: string[] = [];
  const base = new Date(`${periodKey}T00:00:00Z`);
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function readFactsOrNull(
  insightsRoot: string,
  date: string,
): Promise<FactsBundleV2 | null> {
  const p = path.join(insightsRoot, "daily", date, "_facts.json");
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as FactsBundleV2;
  } catch {
    return null;
  }
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, std: 0 };
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function bandLabel(zAbs: number): SurpriseLabel {
  if (zAbs >= 3) return "high";
  if (zAbs >= 1.5) return "medium";
  return "low";
}

/**
 * Read 30 days of `_facts.json` ending at `periodKey`. For each tracked
 * metric, compute today's value vs trailing 14-day mean+std (skip nulls).
 * Hard z-band: |z|≥3 → "high", ≥1.5 → "medium", else "low". Skip "low"
 * candidates from output. Returns top `topN` (default 5) by |z|.
 *
 * fragile: n_baseline < 5. We return the candidate but force its label to
 * "low" if fragile (prevents amplifying noise from a 2-sample baseline).
 */
export async function computeSurpriseCandidates(
  periodKey: string,
  insightsRoot: string,
  topN = 5,
): Promise<SurpriseCandidate[]> {
  // 30-day window ending at periodKey, oldest first; index 29 == today.
  const dates = priorDatesInclusive(periodKey, 30);
  const facts = await Promise.all(
    dates.map((d) => readFactsOrNull(insightsRoot, d)),
  );

  // Today (latest day) and trailing 14 days (the 14 days before today).
  // dates length is always 30; today is index 29.
  const todayFacts = facts[29] ?? null;
  if (!todayFacts) return [];
  const trailing = facts.slice(15, 29); // 14 days excluding today

  const candidates: SurpriseCandidate[] = [];
  for (const spec of METRICS) {
    const today = spec.extract(todayFacts);
    if (today === null) continue;

    const baseline: number[] = [];
    for (const f of trailing) {
      if (!f) continue;
      const v = spec.extract(f);
      if (v !== null) baseline.push(v);
    }
    if (baseline.length === 0) continue;

    const { mean, std } = meanStd(baseline);
    if (!Number.isFinite(std) || std === 0) {
      // No spread → no z-score, skip. (PROBE B fragility note.)
      continue;
    }

    const z = (today - mean) / std;
    if (!Number.isFinite(z)) continue;

    const fragile = baseline.length < 5;
    const rawLabel = bandLabel(Math.abs(z));
    // Fragile baselines: never claim "high" or "medium" surprise.
    const label: SurpriseLabel = fragile ? "low" : rawLabel;

    if (label === "low") continue; // skip per spec

    candidates.push({
      metric: spec.id,
      metric_label_de: spec.label_de,
      today_value: today,
      baseline_mean: mean,
      baseline_std: std,
      z_score: z,
      surprise_label: label,
      direction: z >= 0 ? "up" : "down",
      n_baseline: baseline.length,
      fragile,
    });
  }

  candidates.sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));
  return candidates.slice(0, topN);
}

// ── LLM framing ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du beschreibst einen einzelnen überraschenden Datenpunkt aus Gesundheitsdaten. Du diagnostizierst NICHT. Du gibst keine medizinische Empfehlung. Keine Vermutung über Krankheit, akute Belastung oder Substanzen.

Du bekommst einen vorgemerkten Datenpunkt mit Wert, Baseline-Mittel, Baseline-Std, z-Score und einem bereits bestimmten surprise_label. Das Label NICHT verändern, NICHT in der Antwort wiederholen.

Output: JSON {"headline_de": string (≤60 Zeichen, deutsch, zitiere die Zahl), "reason_de": string (≤80 Zeichen, deutsch, beschreibt NUR die Datenabweichung)}.

reason_de nennt die Abweichung in Standardabweichungen oder als Δ zur Baseline. Keine Krankheits-/Belastungs-Vermutungen.`;

const SURPRISE_SCHEMA = {
  type: "object",
  properties: {
    headline_de: { type: "string", maxLength: 60 },
    reason_de: { type: "string", maxLength: 80 },
  },
  required: ["headline_de", "reason_de"],
} as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h | 0;
}

function buildUserMessage(c: SurpriseCandidate): string {
  // Compact JSON keeps the prompt ≤300 tok.
  const payload = {
    metric: c.metric,
    metric_label_de: c.metric_label_de,
    today_value: round(c.today_value, 2),
    baseline_mean: round(c.baseline_mean, 2),
    baseline_std: round(c.baseline_std, 2),
    z_score: round(c.z_score, 2),
    direction: c.direction,
    n_baseline: c.n_baseline,
    fragile: c.fragile,
    surprise_label_fixed: c.surprise_label,
  };
  return `Datenpunkt: ${JSON.stringify(payload)}\n\nWie würdest du diesen einzelnen Wert kurz framen?`;
}

function round(v: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function parseFraming(raw: string): { headline_de: string; reason_de: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `surprise-ranking: invalid JSON content from LLM: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("surprise-ranking: top-level must be an object");
  }
  const obj = parsed as { headline_de?: unknown; reason_de?: unknown };
  if (typeof obj.headline_de !== "string") {
    throw new Error("surprise-ranking: missing headline_de");
  }
  if (typeof obj.reason_de !== "string") {
    throw new Error("surprise-ranking: missing reason_de");
  }
  return { headline_de: obj.headline_de, reason_de: obj.reason_de };
}

/**
 * One sequential Ollama call per candidate. Caller is responsible for
 * serialising calls (single GPU). Hard 60s timeout.
 */
export async function frameSurpriseInsight(
  candidate: SurpriseCandidate,
  opts: FrameSurpriseOptions = {},
): Promise<SurpriseInsight> {
  const model = opts.model ?? "qwen3.6:latest";
  const periodKey = opts.periodKey ?? "";
  const seed = fnv1a(`${candidate.metric}|${periodKey}`);

  const result = await callOllama({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(candidate),
    format: SURPRISE_SCHEMA,
    options: {
      temperature: 0.15,
      num_ctx: 4096,
      num_predict: 256,
      seed,
    },
    baseUrl: opts.ollamaUrl,
    tag: "surprise_ranking",
  });

  const content = result.content;
  if (!content) {
    throw new Error("surprise-ranking: empty content");
  }
  const framing = parseFraming(content);
  // Hard cap (schema enforces but defence-in-depth).
  return {
    ...candidate,
    headline_de: framing.headline_de.slice(0, 60),
    reason_de: framing.reason_de.slice(0, 80),
  };
}
