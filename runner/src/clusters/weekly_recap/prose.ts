/**
 * weekly_recap — Stage 1 (prose). Wraps the existing weekly LLM prompt
 * so the JobCell layer reuses the locked schema + system prompt.
 *
 * Dual-write transitional behaviour: after a successful prose pass we
 * also write the legacy `weekly.json` file under
 * `$INSIGHTS_ROOT/weekly/<weekKey>/weekly.json` via an atomic rename so
 * the existing `loadWeekly()` reader path stays alive for Pi-only
 * surfaces. Single-deletion later: drop the `writeWeeklyJson(...)` call
 * once every reader speaks JobCell.
 *
 * Abstain shortcut: when the extract package already has
 * `payload.abstain === true`, we skip the LLM entirely and return the
 * package as-is (with refreshed `generated_at`). The legacy stage's
 * `abstainPayload` writes the same body; here we let the abstain object
 * flow straight through, then dual-write it.
 *
 * Critic pass: Phase 4 work. We log when the setting is on and
 * short-circuit to a single-model run. The plumbing (`ctx.criticModel`,
 * model-tag composition) is in place so the wiring drops in cleanly.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DailyInsightV2, FactsBundleV2, WeeklyRecapV2 } from "@/lib/types/generated";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { callOllama } from "../../ollama.ts";
import {
  WEEKLY_SYSTEM_PROMPT,
  buildWeeklyUser,
  type WeeklyContext,
} from "../../prompts/weekly.ts";
import { weeklySchema } from "../../schemas/v2/index.ts";
import type { ProseContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import { loadWeeklyWindow } from "./extract.ts";
import type { WeeklyRecapPayload } from "./types.ts";

const MAX_ATTEMPTS = 3;
const TEMPERATURES = [0.2, 0.15, 0.1];

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateWeekly = ajv.compile(weeklySchema);

/**
 * Build the deterministic CONTEXT object the prompt expects. Mirrors the
 * `buildContext()` helper in the legacy stage so the LLM sees the same
 * shape it was trained against. Streaks and personal-best/worst from the
 * extract package take precedence over freshly recomputed values — they
 * may already be cached on the cell row.
 */
function buildPromptContext(
  pkg: PulseDataPackage<WeeklyRecapPayload>,
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

  // Reuse the streaks already computed in extract — they're stable across
  // re-runs and saving them avoids one more `longestRun` pass.
  const streaks = pkg.payload.streaks.map((s) => ({
    id: s.id,
    label: s.label,
    length_days: s.length_days,
    metric_id: s.metric_id,
  }));

  // Records → CONTEXT shape. The legacy prompt wants {best, worst}
  // arrays; we flatten the cluster's single best/worst back into them.
  const records = {
    best: pkg.payload.personal_best
      ? [
          {
            metric_id: pkg.payload.personal_best.metric_id,
            value: pkg.payload.personal_best.value,
            date: pkg.payload.personal_best.date,
          },
        ]
      : [],
    worst: pkg.payload.personal_worst
      ? [
          {
            metric_id: pkg.payload.personal_worst.metric_id,
            value: pkg.payload.personal_worst.value,
            date: pkg.payload.personal_worst.date,
          },
        ]
      : [],
  };

  // Recurring observations: aggregate driver clauses by metric_id across
  // the dailies window. Lifted verbatim from the legacy stage.
  const tagCount = new Map<
    string,
    { tag: string; domain: string; days: Set<string> }
  >();
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
    week_key: pkg.payload.week_key,
    date_range: { from: dates[0], to: dates[dates.length - 1] },
    days_with_data: present.length,
    aggregates,
    streaks,
    records,
    recurring_observations: recurring.slice(0, 8),
  };
}

/**
 * Same repair surface as the legacy stage. The LLM regularly omits
 * `abstain_reason`, swallows `calc`, or overshoots length caps; we patch
 * the common cases before schema validation so the regen loop is a last
 * resort, not the first.
 */
function repairWeekly(input: unknown): unknown {
  if (input == null || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  if (!("abstain_reason" in obj)) obj.abstain_reason = null;
  if (obj.confidence != null && typeof obj.confidence === "object") {
    const c = obj.confidence as Record<string, unknown>;
    const value = typeof c.value === "number" ? c.value : 0;
    const factorsRaw = Array.isArray(c.factors) ? c.factors : [];
    const factors = factorsRaw.filter((f): f is string => typeof f === "string");
    const calc = typeof c.calc === "string" && c.calc.length > 0 ? c.calc : value.toFixed(2);
    obj.confidence = { value, calc, factors };
  }
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

/**
 * Atomically write the legacy `weekly.json` (the read path used by
 * `loadWeekly()` until every dashboard surface speaks JobCell). Staging
 * file under the same dir → rename so Syncthing never sees a half file.
 */
async function writeWeeklyJson(
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

/**
 * Map a cluster `WeeklyRecapPayload` into the legacy `WeeklyRecapV2`
 * file shape. The two diverge only in that the cluster payload carries
 * `week_key` (cluster cell-key) while `WeeklyRecapV2` keeps the bare
 * shape; we just drop `week_key` and `model` on the way out so the file
 * is a strict subset of the prior schema.
 */
function toWeeklyV2(p: WeeklyRecapPayload): WeeklyRecapV2 {
  // The schema requires `reasoning_trace.minLength === 60`. Abstain
  // payloads in the legacy stage seed a 70-char string; mirror that
  // when the cluster's extract produced an empty trace.
  const reasoning_trace =
    p.reasoning_trace && p.reasoning_trace.length >= 60
      ? p.reasoning_trace
      : `Abstain: ${p.abstain_reason ?? "deterministic_extract"}. Datenfenster zu klein für vertrauenswürdige Wochen-Aussage.`;
  return {
    reasoning_trace,
    schema_version: "weekly/v2",
    language: p.language,
    abstain: p.abstain,
    abstain_reason: p.abstain_reason,
    trajectory_headline: p.trajectory_headline,
    chart_refs: p.chart_refs as WeeklyRecapV2["chart_refs"],
    pattern_callouts: p.pattern_callouts as WeeklyRecapV2["pattern_callouts"],
    streaks: p.streaks as WeeklyRecapV2["streaks"],
    personal_best: p.personal_best,
    personal_worst: p.personal_worst,
    micro_experiment: p.micro_experiment,
    confidence: p.confidence,
  };
}

export async function prose(
  pkg: PulseDataPackage<WeeklyRecapPayload>,
  ctx: ProseContext,
): Promise<PulseDataPackage<WeeklyRecapPayload>> {
  const weekKey = pkg.payload.week_key;
  const baseModel = config.model;

  // ── Abstain shortcut ─────────────────────────────────────────────────
  if (pkg.payload.abstain) {
    if (ctx.criticModel) {
      log.info("weekly_recap", `abstain payload — skipping critic (${ctx.criticModel})`);
    }
    // Dual-write the legacy file so any non-cluster reader still sees
    // the abstain notice. Best-effort: never fail the cell on a write
    // hiccup, the JobCell row is the source of truth.
    try {
      await writeWeeklyJson(toWeeklyV2(pkg.payload), weekKey, config.insightsRoot);
    } catch (err) {
      log.warn("weekly_recap", `dual-write abstain ${weekKey}: ${(err as Error).message}`);
    }
    return {
      ...pkg,
      payload: { ...pkg.payload, model: baseModel },
      generated_at: new Date().toISOString(),
    };
  }

  // ── LLM regen loop ───────────────────────────────────────────────────
  const { dates, facts, dailies } = await loadWeeklyWindow(weekKey);
  const factsCompact = facts.filter((f): f is FactsBundleV2 => f != null);
  const dailiesPaired = dailies
    .map((insight, i) => (insight ? { date: dates[i], insight } : null))
    .filter((x): x is { date: string; insight: DailyInsightV2 } => x !== null);
  const context = buildPromptContext(pkg, dates, facts, dailies);

  if (ctx.criticModel) {
    log.info(
      "weekly_recap",
      `critic enabled (${ctx.criticModel}) — Phase 4 wiring pending, running base only`,
    );
  }

  let weekly: WeeklyRecapV2 | null = null;
  let lastError: string | null = null;
  let feedback: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = TEMPERATURES[attempt] ?? 0.1;
    const userPrompt = buildWeeklyUser(context, factsCompact, dailiesPaired, feedback);
    let result;
    try {
      result = await callOllama({
        model: baseModel,
        system: WEEKLY_SYSTEM_PROMPT,
        user: userPrompt,
        tag: "weekly_recap_prose",
        format: weeklySchema,
        options: { temperature, num_ctx: 16384, num_predict: 6000 },
      });
    } catch (err) {
      lastError = `HTTP error: ${err instanceof Error ? err.message : String(err)}`;
      feedback = [`HTTP-Fehler beim letzten Versuch: ${lastError}. Erneut senden.`];
      log.warn("weekly_recap", `attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch (err) {
      lastError = `JSON parse: ${err instanceof Error ? err.message : String(err)}`;
      feedback = [
        "Vorheriger Output war kein gültiges JSON. Liefere ein einziges JSON-Objekt ohne Markdown.",
      ];
      log.warn("weekly_recap", `attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    parsed = repairWeekly(parsed);
    if (!validateWeekly(parsed)) {
      lastError = ajv.errorsText(validateWeekly.errors);
      feedback = (validateWeekly.errors ?? []).slice(0, 6).map((e) => {
        const at = e.instancePath || "/";
        return `Schema-Verstoß bei ${at}: ${e.message ?? "unbekannt"}`;
      });
      log.warn("weekly_recap", `attempt ${attempt + 1}/${MAX_ATTEMPTS} schema fail: ${lastError}`);
      continue;
    }
    const candidate = parsed as WeeklyRecapV2;
    if (candidate.reasoning_trace.length < 60) {
      lastError = `reasoning_trace too short (${candidate.reasoning_trace.length})`;
      feedback = [
        `reasoning_trace war zu kurz (${candidate.reasoning_trace.length} Zeichen, mind. 60). Schreibe einen ausführlicheren Kettenschritt.`,
      ];
      log.warn("weekly_recap", `attempt ${attempt + 1}/${MAX_ATTEMPTS} ${lastError}`);
      continue;
    }
    weekly = candidate;
    log.info(
      "weekly_recap",
      `prose ok for ${weekKey} (attempt ${attempt + 1})`,
    );
    break;
  }

  // ── Outcome: success path ────────────────────────────────────────────
  if (weekly) {
    const merged: WeeklyRecapPayload = {
      week_key: weekKey,
      schema_version: "weekly/v2",
      language: weekly.language,
      reasoning_trace: weekly.reasoning_trace,
      abstain: weekly.abstain,
      abstain_reason: weekly.abstain_reason,
      trajectory_headline: weekly.trajectory_headline,
      chart_refs: [...weekly.chart_refs],
      pattern_callouts: [...weekly.pattern_callouts],
      streaks: [...weekly.streaks],
      personal_best: weekly.personal_best
        ? {
            metric_id: weekly.personal_best.metric_id,
            value: weekly.personal_best.value,
            date: weekly.personal_best.date,
            note: weekly.personal_best.note,
          }
        : null,
      personal_worst: weekly.personal_worst
        ? {
            metric_id: weekly.personal_worst.metric_id,
            value: weekly.personal_worst.value,
            date: weekly.personal_worst.date,
            action_or_note: weekly.personal_worst.action_or_note,
          }
        : null,
      micro_experiment: weekly.micro_experiment
        ? { ...weekly.micro_experiment }
        : null,
      confidence: {
        value: weekly.confidence.value,
        calc: weekly.confidence.calc,
        factors: [...weekly.confidence.factors],
      },
      model: ctx.criticModel ? `${baseModel}+${ctx.criticModel}` : baseModel,
    };

    const llmProvenance: ProvenanceTag[] = [
      {
        field_path: "trajectory_headline.recovery",
        source: "llm_derived",
        confidence: merged.confidence.value,
      },
      {
        field_path: "trajectory_headline.activity",
        source: "llm_derived",
        confidence: merged.confidence.value,
      },
      {
        field_path: "trajectory_headline.stress",
        source: "llm_derived",
        confidence: merged.confidence.value,
      },
    ];
    merged.pattern_callouts.forEach((_, i) => {
      llmProvenance.push({
        field_path: `pattern_callouts[${i}]`,
        source: "llm_derived",
        confidence: merged.confidence.value,
      });
    });
    if (merged.micro_experiment) {
      llmProvenance.push({
        field_path: "micro_experiment",
        source: "llm_derived",
        confidence: merged.confidence.value,
      });
    }
    if (merged.personal_best?.note) {
      llmProvenance.push({
        field_path: "personal_best.note",
        source: "llm_derived",
      });
    }
    if (
      merged.personal_worst &&
      merged.personal_worst.action_or_note !== "fortlaufend beobachten"
    ) {
      llmProvenance.push({
        field_path: "personal_worst.action_or_note",
        source: "llm_derived",
      });
    }

    // Dual-write — file system. Failure is non-fatal: the JobCell row is
    // the source of truth, the file is for transitional readers only.
    try {
      await writeWeeklyJson(weekly, weekKey, config.insightsRoot);
    } catch (err) {
      log.warn("weekly_recap", `dual-write ${weekKey}: ${(err as Error).message}`);
    }

    return {
      ...pkg,
      payload: merged,
      provenance: [...pkg.provenance, ...llmProvenance],
      generated_at: new Date().toISOString(),
    };
  }

  // ── Outcome: all attempts failed → degrade to abstain ────────────────
  // Same behaviour as the legacy stage's "writeFailDiagnostics + abstain
  // write" path. The JobCell layer doesn't have an abstain status
  // distinct from `partial`, so we surface the LLM failure as a partial
  // release via the caller (the worker passes `error` into `release()`
  // when we throw). To preserve cached-delivery semantics on the
  // dashboard, return a degraded abstain payload AND throw so the worker
  // marks the cell partial. Throwing is the right signal: the worker
  // calls release(...errorText) and surfaces the cached payload if there
  // was one, otherwise an error CTA.
  const degraded: WeeklyRecapPayload = {
    ...pkg.payload,
    abstain: true,
    abstain_reason: "llm_schema_fail",
    trajectory_headline: {
      recovery: "Datenlücke",
      activity: "Datenlücke",
      stress: "Datenlücke",
    },
    pattern_callouts: [],
    micro_experiment: null,
    confidence: {
      value: 0,
      calc: "abstain",
      factors: ["llm_schema_fail"],
    },
    model: baseModel,
  };
  // Best-effort file dual-write so the legacy reader still sees something.
  try {
    await writeWeeklyJson(toWeeklyV2(degraded), weekKey, config.insightsRoot);
  } catch (err) {
    log.warn("weekly_recap", `dual-write degraded ${weekKey}: ${(err as Error).message}`);
  }
  throw new Error(`weekly_recap.prose: all ${MAX_ATTEMPTS} attempts failed: ${lastError ?? "unknown"}`);
}
