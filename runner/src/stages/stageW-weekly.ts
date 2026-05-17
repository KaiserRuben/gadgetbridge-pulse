/**
 * Stage W — Weekly recap.
 *
 * Loads 7 daily.json + 7 _facts.json from `insights/daily/`, derives
 * a deterministic CONTEXT object (streaks, records, recurring tags),
 * calls the LLM with the weekly/v2 schema, validates, writes
 * `insights/weekly/<weekKey>/weekly.json` atomically.
 *
 * Failure modes:
 *   - <4 days with data → synthetic abstain payload.
 *   - LLM 3× fail → synthetic abstain payload (no throw).
 *
 * Catastrophic failure here MUST NOT fail the daily pipeline.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import type {
  DailyInsightV2,
  FactsBundleV2,
  WeeklyRecapV2,
} from "@/lib/types/generated";

import { config } from "../config.ts";
import { callOllama } from "../ollama.ts";
import {
  WEEKLY_SYSTEM_PROMPT,
  buildWeeklyUser,
  type WeeklyContext,
} from "../prompts/weekly.ts";
import { weeklySchema } from "../schemas/v2/index.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateWeekly = ajv.compile(weeklySchema);

const MAX_ATTEMPTS = 3;
const TEMPERATURES = [0.2, 0.15, 0.1];

export interface StageWeeklyResult {
  ok: boolean;
  weekKey: string;
  attempts: number;
  weekly: WeeklyRecapV2 | null;
  error: string | null;
}

/** ISO week key like `2026-W19` from a `YYYY-MM-DD` date. */
export function weekKeyFromDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dow = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dow + 3);
  const isoYear = target.getUTCFullYear();
  const ft = new Date(Date.UTC(isoYear, 0, 4));
  const ftDow = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - ftDow + 3);
  const weekNum = 1 + Math.round((target.getTime() - ft.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

function isoWeekStart(weekKey: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) throw new Error(`bad weekKey ${weekKey}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return target.toISOString().slice(0, 10);
}

function shiftDateKey(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

function buildContext(
  weekKey: string,
  dates: string[],
  facts: Array<FactsBundleV2 | null>,
  dailies: Array<DailyInsightV2 | null>,
): WeeklyContext {
  const present = facts.filter((f): f is FactsBundleV2 => f != null);
  const avg = (xs: Array<number | null | undefined>): number | null => {
    const ok = xs.filter((v): v is number => typeof v === "number");
    if (ok.length === 0) return null;
    return +(ok.reduce((s, v) => s + v, 0) / ok.length).toFixed(1);
  };
  const sum = (xs: Array<number | null | undefined>): number =>
    xs.filter((v): v is number => typeof v === "number").reduce((s, v) => s + v, 0);

  const aggregates = {
    rhr_mean: avg(present.map((f) => f.cardio?.metrics?.rhr_day_bpm)),
    tst_min_mean: avg(present.map((f) => f.sleep?.metrics?.tst_min)),
    sleep_efficiency_mean: avg(present.map((f) => f.sleep?.metrics?.sleep_efficiency_pct)),
    steps_total: sum(present.map((f) => f.activity?.metrics?.steps)),
    active_min_total: sum(present.map((f) => f.activity?.metrics?.active_minutes)),
    stress_mean: avg(present.map((f) => f.stress?.metrics?.stress_mean)),
    high_stress_min_total: sum(present.map((f) => f.stress?.metrics?.high_stress_minutes)),
  };

  // Streaks: consecutive days hitting a threshold.
  const streaks: WeeklyContext["streaks"] = [];
  const stepsByDate = dates.map((d, i) => ({
    date: d,
    value: facts[i]?.activity?.metrics?.steps ?? null,
  }));
  const stepStreak = longestRun(stepsByDate.map((p) => (p.value != null && p.value >= 8000 ? 1 : 0)));
  if (stepStreak >= 3) {
    streaks.push({
      id: "step_goal_streak",
      label: `${stepStreak} Tage in Folge ≥8000 Schritte`,
      length_days: stepStreak,
      metric_id: "activity.metrics.steps",
    });
  }
  const sleepEffStreak = longestRun(
    dates.map((_, i) => {
      const v = facts[i]?.sleep?.metrics?.sleep_efficiency_pct;
      return v != null && v >= 85 ? 1 : 0;
    }),
  );
  if (sleepEffStreak >= 3) {
    streaks.push({
      id: "sleep_eff_streak",
      label: `${sleepEffStreak} Tage Schlafeffizienz ≥85%`,
      length_days: sleepEffStreak,
      metric_id: "sleep.metrics.sleep_efficiency_pct",
    });
  }

  // Records: best/worst on a small list of headline metrics.
  const records: WeeklyContext["records"] = { best: [], worst: [] };
  pickRecords(records, dates, facts, "activity.metrics.steps", (f) => f.activity?.metrics?.steps ?? null, "max");
  pickRecords(records, dates, facts, "sleep.metrics.tst_min", (f) => f.sleep?.metrics?.tst_min ?? null, "max");
  pickRecords(records, dates, facts, "cardio.metrics.rhr_day_bpm", (f) => f.cardio?.metrics?.rhr_day_bpm ?? null, "min");
  pickRecords(records, dates, facts, "stress.metrics.stress_mean", (f) => f.stress?.metrics?.stress_mean ?? null, "min");

  // Recurring observations: aggregate driver clauses by metric_id across the week.
  // Driver schema doesn't carry a `domain` field — we infer one from the
  // metric_id prefix (sleep.* / cardio.* / activity.* / etc.).
  const tagCount = new Map<string, { tag: string; domain: string; days: Set<string> }>();
  for (let i = 0; i < dates.length; i++) {
    const drv = dailies[i]?.drivers ?? [];
    for (const d of drv) {
      const key = d.metric_id;
      const inferredDomain = key.split(".")[0] ?? "unknown";
      const entry = tagCount.get(key) ?? {
        tag: key,
        domain: inferredDomain,
        days: new Set(),
      };
      entry.days.add(dates[i]);
      tagCount.set(key, entry);
    }
  }
  const recurring: WeeklyContext["recurring_observations"] = [];
  for (const e of tagCount.values()) {
    if (e.days.size >= 2) {
      recurring.push({
        tag: e.tag,
        domain: e.domain,
        occurrences: e.days.size,
        days: [...e.days].sort(),
      });
    }
  }
  recurring.sort((a, b) => b.occurrences - a.occurrences);

  return {
    week_key: weekKey,
    date_range: { from: dates[0], to: dates[dates.length - 1] },
    days_with_data: present.length,
    aggregates,
    streaks,
    records,
    recurring_observations: recurring.slice(0, 8),
  };
}

function longestRun(arr: number[]): number {
  let best = 0;
  let cur = 0;
  for (const v of arr) {
    if (v) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

function pickRecords(
  records: WeeklyContext["records"],
  dates: string[],
  facts: Array<FactsBundleV2 | null>,
  metricId: string,
  read: (f: FactsBundleV2) => number | null,
  direction: "max" | "min",
): void {
  let bestVal: number | null = null;
  let bestDate: string | null = null;
  let worstVal: number | null = null;
  let worstDate: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const f = facts[i];
    if (!f) continue;
    const v = read(f);
    if (v == null) continue;
    if (bestVal == null) {
      bestVal = v; bestDate = dates[i];
      worstVal = v; worstDate = dates[i];
      continue;
    }
    if (direction === "max") {
      if (v > bestVal) { bestVal = v; bestDate = dates[i]; }
      if (v < (worstVal as number)) { worstVal = v; worstDate = dates[i]; }
    } else {
      if (v < bestVal) { bestVal = v; bestDate = dates[i]; }
      if (v > (worstVal as number)) { worstVal = v; worstDate = dates[i]; }
    }
  }
  if (bestVal != null && bestDate) {
    records.best.push({ metric_id: metricId, value: +bestVal.toFixed(2), date: bestDate });
  }
  if (worstVal != null && worstDate && worstDate !== bestDate) {
    records.worst.push({ metric_id: metricId, value: +worstVal.toFixed(2), date: worstDate });
  }
}

function abstainPayload(weekKey: string, reason: string): WeeklyRecapV2 {
  return {
    reasoning_trace: `Abstain: ${reason}. Datenfenster zu klein für vertrauenswürdige Wochen-Aussage.`,
    schema_version: "weekly/v2",
    language: "de",
    abstain: true,
    abstain_reason: reason,
    trajectory_headline: {
      recovery: "Datenlücke",
      activity: "Datenlücke",
      stress: "Datenlücke",
    },
    chart_refs: [],
    pattern_callouts: [],
    streaks: [],
    personal_best: null,
    personal_worst: null,
    micro_experiment: null,
    confidence: { value: 0, calc: "abstain", factors: [reason] },
  };
}

export interface RunStageWeeklyOpts {
  /** Anchor date (any day in the target week). */
  date: string;
  /** Insights root, defaults to config. */
  insightsRoot?: string;
  /** Skip the Ollama call and return abstain (testing). */
  dryRun?: boolean;
}

export async function runStageWeekly(
  opts: RunStageWeeklyOpts,
): Promise<StageWeeklyResult> {
  const insightsRoot = opts.insightsRoot ?? config.insightsRoot;
  const weekKey = weekKeyFromDate(opts.date);
  const monday = isoWeekStart(weekKey);
  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(monday, i));

  const [facts, dailies] = await Promise.all([
    Promise.all(
      dates.map((d) =>
        readJson<FactsBundleV2>(path.join(insightsRoot, "daily", d, "_facts.json")),
      ),
    ),
    Promise.all(
      dates.map((d) =>
        readJson<DailyInsightV2>(path.join(insightsRoot, "daily", d, "daily.json")),
      ),
    ),
  ]);

  const context = buildContext(weekKey, dates, facts, dailies);

  // Abstain shortcut.
  if (context.days_with_data < 4) {
    const weekly = abstainPayload(weekKey, "insufficient_data");
    if (!opts.dryRun) await writeWeeklyAtomic(weekly, weekKey, insightsRoot);
    return { ok: true, weekKey, attempts: 0, weekly, error: null };
  }

  if (opts.dryRun) {
    return { ok: true, weekKey, attempts: 0, weekly: null, error: null };
  }

  const factsCompact = facts.filter((f): f is FactsBundleV2 => f != null);
  const dailiesPaired = dailies
    .map((insight, i) => insight ? { date: dates[i], insight } : null)
    .filter((x): x is { date: string; insight: DailyInsightV2 } => x !== null);

  let lastError: string | null = null;
  let lastRaw: string | null = null;
  let feedback: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = TEMPERATURES[attempt] ?? 0.1;
    const userPrompt = buildWeeklyUser(
      context,
      factsCompact,
      dailiesPaired,
      feedback,
    );
    let result;
    try {
      result = await callOllama({
        model: config.model,
        system: WEEKLY_SYSTEM_PROMPT,
        user: userPrompt,
        tag: "stageW_weekly",
        format: weeklySchema,
        options: { temperature, num_ctx: 16384, num_predict: 6000 },
      });
    } catch (err) {
      lastError = `HTTP error: ${err instanceof Error ? err.message : String(err)}`;
      feedback = [`HTTP-Fehler beim letzten Versuch: ${lastError}. Erneut senden.`];
      console.warn(`[stageW] attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    lastRaw = result.content;
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch (err) {
      lastError = `JSON parse: ${err instanceof Error ? err.message : String(err)}`;
      feedback = [
        "Vorheriger Output war kein gültiges JSON. Liefere ein einziges JSON-Objekt ohne Markdown.",
      ];
      console.warn(`[stageW] attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    parsed = repairWeekly(parsed);
    if (!validateWeekly(parsed)) {
      lastError = ajv.errorsText(validateWeekly.errors);
      feedback = (validateWeekly.errors ?? []).slice(0, 6).map((e) => {
        const path = e.instancePath || "/";
        return `Schema-Verstoß bei ${path}: ${e.message ?? "unbekannt"}`;
      });
      console.warn(`[stageW] attempt ${attempt + 1}/${MAX_ATTEMPTS} schema fail: ${lastError}`);
      continue;
    }
    const weekly = parsed as WeeklyRecapV2;
    if (weekly.reasoning_trace.length < 60) {
      lastError = `reasoning_trace too short (${weekly.reasoning_trace.length})`;
      feedback = [
        `reasoning_trace war zu kurz (${weekly.reasoning_trace.length} Zeichen, mind. 60). Schreibe einen ausführlicheren Kettenschritt.`,
      ];
      console.warn(`[stageW] attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    await writeWeeklyAtomic(weekly, weekKey, insightsRoot);
    console.log(`[stageW] wrote weekly/${weekKey}/weekly.json (attempt ${attempt + 1})`);
    return { ok: true, weekKey, attempts: attempt + 1, weekly, error: null };
  }

  // All attempts failed → write abstain payload so the UI gets something.
  // Also dump the last raw model output + error for offline debugging.
  await writeFailDiagnostics(weekKey, insightsRoot, lastRaw, lastError);
  const weekly = abstainPayload(weekKey, "llm_schema_fail");
  await writeWeeklyAtomic(weekly, weekKey, insightsRoot);
  return { ok: false, weekKey, attempts: MAX_ATTEMPTS, weekly, error: lastError };
}

/**
 * Best-effort repair of LLM output before schema validation. Targets the
 * recurring failure modes observed in the live runs:
 *   - missing `abstain_reason` (LLM omits when null)
 *   - empty `domains` / `days` arrays inside pattern_callouts
 *   - missing `action_or_note` on personal_worst
 *   - duration_days outside 1..28
 *   - trajectory_headline strings exceeding the 60-char schema cap
 *   - micro_experiment.* string fields exceeding 80-char cap
 *
 * Extra unknown keys on top-level objects are not stripped here — the schema's
 * additionalProperties:false surfaces those as a separate retry signal so the
 * model has the chance to fix them.
 */
function repairWeekly(input: unknown): unknown {
  if (input == null || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;

  // abstain_reason is required + nullable. Most LLM outputs omit when null.
  if (!("abstain_reason" in obj)) {
    obj.abstain_reason = null;
  }

  // confidence must have {value, calc, factors}. The schema is strict
  // (additionalProperties:false). Models occasionally drop `calc` when they
  // think "factors" alone is enough. Coerce: if missing, derive `calc` from
  // factors, drop unknown keys.
  if (obj.confidence != null && typeof obj.confidence === "object") {
    const c = obj.confidence as Record<string, unknown>;
    const value = typeof c.value === "number" ? c.value : 0;
    const factorsRaw = Array.isArray(c.factors) ? c.factors : [];
    const factors = factorsRaw.filter((f): f is string => typeof f === "string");
    let calc: string;
    if (typeof c.calc === "string" && c.calc.length > 0) {
      calc = c.calc;
    } else {
      // Build "0.4*0.x + 0.3*0.y + 0.3*0.z = sum" if we can parse it; else
      // fall back to the bare value as a string.
      const parts: string[] = [];
      let sum = 0;
      for (const f of factors) {
        const w = f.match(/w\s*=\s*(-?\d+(?:\.\d+)?)/);
        const s = f.match(/s\s*=\s*(-?\d+(?:\.\d+)?)/);
        if (w && s) {
          parts.push(`${w[1]}*${s[1]}`);
          sum += Number(w[1]) * Number(s[1]);
        }
      }
      calc = parts.length > 0
        ? `${parts.join(" + ")} = ${sum.toFixed(2)}`
        : value.toFixed(2);
    }
    obj.confidence = { value, calc, factors };
  }

  // trajectory_headline values capped at 60 chars in schema.
  if (obj.trajectory_headline != null && typeof obj.trajectory_headline === "object") {
    const th = obj.trajectory_headline as Record<string, unknown>;
    for (const k of ["recovery", "activity", "stress"]) {
      const v = th[k];
      if (typeof v === "string" && v.length > 60) th[k] = v.slice(0, 57) + "…";
    }
  }

  if (Array.isArray(obj.pattern_callouts)) {
    obj.pattern_callouts = obj.pattern_callouts
      .map((p): unknown => {
        if (p == null || typeof p !== "object") return null;
        const pc = { ...(p as Record<string, unknown>) };
        if (!Array.isArray(pc.domains)) pc.domains = [];
        if (!Array.isArray(pc.days)) pc.days = [];
        if (typeof pc.description === "string" && pc.description.length > 200) {
          pc.description = pc.description.slice(0, 197) + "…";
        }
        return pc;
      })
      .filter((x: unknown) => x != null);
  }

  if (obj.personal_worst != null && typeof obj.personal_worst === "object") {
    const pw = obj.personal_worst as Record<string, unknown>;
    if (typeof pw.action_or_note !== "string" || pw.action_or_note.length === 0) {
      pw.action_or_note = "fortlaufend beobachten";
    } else if (pw.action_or_note.length > 200) {
      pw.action_or_note = (pw.action_or_note as string).slice(0, 197) + "…";
    }
  }

  if (obj.micro_experiment != null && typeof obj.micro_experiment === "object") {
    const me = obj.micro_experiment as Record<string, unknown>;
    const dur = me.duration_days;
    if (typeof dur === "number") {
      if (dur < 1) me.duration_days = 3;
      else if (dur > 28) me.duration_days = 14;
    }
    for (const [k, max] of [
      ["hypothesis", 200],
      ["anchor", 80],
      ["tiny", 80],
      ["fallback", 80],
    ] as const) {
      const v = me[k];
      if (typeof v === "string" && v.length > max) me[k] = v.slice(0, max - 1) + "…";
    }
  }

  return obj;
}

async function writeFailDiagnostics(
  weekKey: string,
  insightsRoot: string,
  raw: string | null,
  error: string | null,
): Promise<void> {
  try {
    const dir = path.join(insightsRoot, "weekly", weekKey);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(
      path.join(dir, `_last_fail_${stamp}.json`),
      JSON.stringify({ error, raw }, null, 2),
      "utf8",
    );
  } catch {
    // best-effort; never throw from diagnostics.
  }
}

async function writeWeeklyAtomic(
  weekly: WeeklyRecapV2,
  weekKey: string,
  insightsRoot: string,
): Promise<void> {
  const dir = path.join(insightsRoot, "weekly", weekKey);
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, "weekly.json");
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(weekly, null, 2), "utf8");
  await rename(tempPath, finalPath);
}
