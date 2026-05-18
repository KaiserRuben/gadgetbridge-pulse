/**
 * anomaly_explain — Stage 0 (extract). Deterministic, no LLM.
 *
 * Driver mode: load the observation clause from `daily.json` for the period.
 * Spike mode:  synthesise a one-shot observation text from the nearest
 *              wearable sample in a ±15-minute window around `ts_ms`.
 *
 * Either path emits a `PulseDataPackage` with an empty `hypotheses` array;
 * `prose()` fills the hypotheses via the existing `explainAnomaly()` LLM call.
 *
 * Cell-key convention (also see `parseAnomalyInputFromKey`):
 *   driver: `<observation_id>`            (matches daily.json driver evidence_ids)
 *   spike:  `manual_<metric>_<ts_ms>`     (stable for re-clicks on the same chart point)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../../config.ts";
import type { ClusterContext } from "../index.ts";
import type { PulseDataPackage, ProvenanceTag } from "../../jobs/types.ts";

import type {
  AnomalyExplanationContext,
  AnomalyExplanationPayload,
  AnomalyExtractInput,
  AnomalyMode,
} from "./types.ts";

const SPIKE_KEY_RE = /^manual_(hr|rhr|hrv|spo2|stress|steps|temp)_(\d+)$/;
const DRIVER_KEY_RE = /^[a-z0-9_]+$/;

const SPIKE_METRICS = new Set<NonNullable<AnomalyExtractInput["metric"]>>([
  "hr",
  "rhr",
  "hrv",
  "spo2",
  "stress",
  "steps",
  "temp",
]);

/**
 * Round-trip helper used by the worker: a cell-key alone tells us whether
 * to call extract in driver or spike mode and what the synthetic inputs
 * are. Returns null if the key shape is unrecognised.
 */
export function parseAnomalyInputFromKey(key: string): AnomalyExtractInput | null {
  const spike = SPIKE_KEY_RE.exec(key);
  if (spike) {
    return {
      metric: spike[1] as AnomalyExtractInput["metric"],
      ts_ms: Number.parseInt(spike[2], 10),
    };
  }
  if (DRIVER_KEY_RE.test(key) && !key.startsWith("manual_")) {
    return { observation_id: key };
  }
  return null;
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

/** Trailing 7-day window ending on `periodKey`, oldest first. */
async function loadFactsWindow(periodKey: string): Promise<object[]> {
  const dates = [periodKey, ...priorDates(periodKey, 6)];
  const out: object[] = [];
  for (const d of dates) {
    const fp = path.join(config.insightsRoot, "daily", d, "_facts.json");
    const facts = await readJsonOrNull<object>(fp);
    if (facts) out.push(facts);
  }
  return out;
}

interface DailyDriverRow {
  clause?: string;
  delta_text?: string;
  evidence_ids?: string[];
}

async function loadDriverObservationText(
  periodKey: string,
  observationId: string,
): Promise<string | null> {
  const dailyPath = path.join(config.insightsRoot, "daily", periodKey, "daily.json");
  const daily = await readJsonOrNull<{ drivers?: DailyDriverRow[] }>(dailyPath);
  if (!daily || !Array.isArray(daily.drivers)) return null;
  const driver = daily.drivers.find(
    (d) => Array.isArray(d.evidence_ids) && d.evidence_ids.includes(observationId),
  );
  if (!driver) return null;
  return `${driver.clause ?? ""}${driver.delta_text ? ` (${driver.delta_text})` : ""}`.trim();
}

/**
 * Spike-mode observation text. We query Gadgetbridge.db directly for the
 * nearest sample inside a ±15 min window. This duplicates a small slice of
 * the dashboard's `lib/queries/*` so the runner-side worker doesn't depend
 * on dashboard read handles.
 *
 * Returns null when no sample is found — the worker reports a deterministic
 * extraction failure rather than calling the LLM with a guessed value.
 */
async function buildSpikeObservationText(
  metric: NonNullable<AnomalyExtractInput["metric"]>,
  tsMs: number,
): Promise<string | null> {
  // Lazy import: the runner DB module performs filesystem stat at import,
  // and unit tests don't need it.
  const { db: openDb } = await import("../../db.ts");
  let dbHandle: ReturnType<typeof openDb>;
  try {
    dbHandle = openDb();
  } catch {
    return null;
  }

  const tsSec = Math.round(tsMs / 1000);
  const fifteenMin = 15 * 60;
  const since = tsSec - fifteenMin;
  const until = tsSec + fifteenMin;
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
  }).format(new Date(tsMs));

  // HUAWEI_ACTIVITY_SAMPLE covers hr/rhr/spo2/steps. HR signed-byte overflow
  // matters — apply the same +256 patch the dashboard uses.
  if (metric === "hr" || metric === "rhr") {
    interface Row {
      ts: number;
      hr: number;
    }
    const rows = dbHandle
      .prepare<[number, number], Row>(
        `SELECT TIMESTAMP AS ts,
                CASE WHEN HEART_RATE < 0 AND HEART_RATE != -1 THEN 256 + HEART_RATE ELSE HEART_RATE END AS hr
           FROM HUAWEI_ACTIVITY_SAMPLE
          WHERE OTHER_TIMESTAMP > TIMESTAMP
            AND TIMESTAMP BETWEEN ? AND ?`,
      )
      .all(since, until)
      .filter((r) => r.hr > 30 && r.hr < 220);
    if (rows.length === 0) return null;
    const closest = rows.reduce((p, c) =>
      Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p,
    );
    return `Punktuelle Herzfrequenz von ${closest.hr} bpm um ${hhmm}.`;
  }

  if (metric === "spo2") {
    interface Row {
      ts: number;
      spo2: number;
    }
    const rows = dbHandle
      .prepare<[number, number], Row>(
        `SELECT TIMESTAMP AS ts, SPO AS spo2
           FROM HUAWEI_ACTIVITY_SAMPLE
          WHERE OTHER_TIMESTAMP > TIMESTAMP
            AND TIMESTAMP BETWEEN ? AND ?
            AND SPO > 50 AND SPO <= 100`,
      )
      .all(since, until);
    if (rows.length === 0) return null;
    const closest = rows.reduce((p, c) =>
      Math.abs(c.ts - tsSec) < Math.abs(p.ts - tsSec) ? c : p,
    );
    return `SpO₂ von ${closest.spo2}% um ${hhmm}.`;
  }

  if (metric === "steps") {
    interface Row {
      total_steps: number;
    }
    const row = dbHandle
      .prepare<[number, number], Row>(
        `SELECT COALESCE(SUM(CASE WHEN STEPS > 0 THEN STEPS ELSE 0 END), 0) AS total_steps
           FROM HUAWEI_ACTIVITY_SAMPLE
          WHERE OTHER_TIMESTAMP > TIMESTAMP
            AND TIMESTAMP BETWEEN ? AND ?`,
      )
      .get(since, until);
    const total = row?.total_steps ?? 0;
    if (total === 0) return null;
    return `${total} Schritte im 30-Minuten-Fenster um ${hhmm}.`;
  }

  // hrv / stress / temp live in separate tables (HUAWEI_HRV_SAMPLE,
  // HUAWEI_STRESS_SAMPLE, HUAWEI_TEMPERATURE_SAMPLE). We don't ship per-table
  // queries from the runner yet; surface a generic text so the LLM still
  // gets a grounded prompt rather than refusing the request.
  return `Auffällige Messung von ${metric} um ${hhmm}.`;
}

/**
 * Build the extract package. `input` carries either an observation_id
 * (driver mode) or metric+ts_ms (spike mode). The worker derives the input
 * from the cell key — see `parseAnomalyInputFromKey`.
 */
export async function extract(
  ctx: ClusterContext,
  input: AnomalyExtractInput = {},
): Promise<PulseDataPackage<AnomalyExplanationPayload>> {
  let mode: AnomalyMode;
  let observationId: string;
  let observationText: string;
  let metric: string | undefined;
  let tsMs: number | undefined;
  let provenanceSource: ProvenanceTag["source"];

  if (input.observation_id) {
    mode = "driver";
    observationId = input.observation_id;
    const text = await loadDriverObservationText(ctx.periodKey, observationId);
    if (!text) {
      throw new Error(
        `anomaly_explain.extract: observation '${observationId}' not found in daily.json for ${ctx.periodKey}`,
      );
    }
    observationText = text;
    provenanceSource = "rule_computed";
  } else if (input.metric && typeof input.ts_ms === "number" && SPIKE_METRICS.has(input.metric)) {
    mode = "spike";
    metric = input.metric;
    tsMs = input.ts_ms;
    observationId = `manual_${input.metric}_${input.ts_ms}`;
    const text = await buildSpikeObservationText(input.metric, input.ts_ms);
    if (!text) {
      throw new Error(
        `anomaly_explain.extract: no DB samples around ts=${input.ts_ms} for metric=${input.metric}`,
      );
    }
    observationText = text;
    provenanceSource = "wearable_sensor";
  } else {
    throw new Error(
      "anomaly_explain.extract: input must be {observation_id} or {metric, ts_ms}",
    );
  }

  const factsWindow = await loadFactsWindow(ctx.periodKey);
  if (factsWindow.length === 0) {
    throw new Error(
      `anomaly_explain.extract: no _facts.json found in 7-day window ending ${ctx.periodKey}`,
    );
  }

  const context: AnomalyExplanationContext = {
    mode,
    observation_text: observationText,
    facts_window_size: factsWindow.length,
    ...(metric ? { metric } : {}),
    ...(tsMs !== undefined ? { ts_ms: tsMs } : {}),
  };

  const payload: AnomalyExplanationPayload = {
    observation_id: observationId,
    period_key: ctx.periodKey,
    context,
    hypotheses: [],
  };

  return {
    cluster: "anomaly_explain",
    key: observationId,
    scope: "daily",
    generated_at: new Date().toISOString(),
    payload,
    provenance: [
      {
        field_path: "context.observation_text",
        source: provenanceSource,
      },
    ],
    deps: [],
    package_version: 1,
  };
}

/**
 * Side-channel: prose() needs the same 7-day facts window the extract
 * loaded. Re-running the file reads in prose is cheap (cached page cache)
 * and avoids stuffing the array into the payload (which the schema does
 * not allow).
 */
export async function loadAnomalyFactsWindow(periodKey: string): Promise<object[]> {
  return loadFactsWindow(periodKey);
}
