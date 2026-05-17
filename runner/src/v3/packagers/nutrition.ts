/**
 * v3 nutrition packager.
 *
 * Aggregates a period's classified meals into the day-pattern shape via the
 * Stage C multi-image VLM call. Output is persisted to PULSE_INSIGHT
 * cluster='nutrition' so the dashboard's `/api/nutrition/day/<date>` route
 * can return it alongside the meal list.
 *
 * Skips entirely when:
 *   - zero classified meals on the period (nothing to summarise)
 *   - all classified meals lack photos (text-only days — Stage C needs
 *     vision input; fallback to deterministic grouping handled UI-side)
 *
 * Persistence is HTTP-only: `pushInsight()` POSTs to Pi `/api/ingest/insight`,
 * which writes PULSE_INSIGHT. Outbox replay handles offline cases.
 */

import path from "node:path";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { pushInsight } from "../../ingest/client.ts";
import { readMealsForPeriod, type StoredMeal } from "../../nutrition/read.ts";
import { prepareImage } from "../../nutrition/image-prep.ts";
import { aggregateDay, type DayAggregateInput, type DayPatternBlock } from "../../nutrition/stages/day-aggregate.ts";

const STAGE_C_IMAGE_LONG_EDGE = 512;

export interface RunNutritionClusterOpts {
  periodKey: string;
  /**
   * Skip the LLM call when the dashboard is in "live" mode (day not finished).
   * Defaults to inferring from periodKey < today (Berlin local) — past days
   * always run; today runs only when day_complete is true.
   */
  day_complete?: boolean;
  /** Per-nutrient target table for delta computation. */
  targets?: Record<string, number>;
}

export interface NutritionClusterResult {
  ok: boolean;
  periodKey: string;
  meals_count: number;
  events_count: number;
  flags_count: number;
  latencyMs: number;
  retried: boolean;
  skipped: "no_meals" | "no_photos" | null;
  error?: string;
}

const TODAY_TZ_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function berlinToday(): string {
  return TODAY_TZ_FORMATTER.format(new Date());
}

async function loadPhotoBase64(photoRelPath: string): Promise<string | null> {
  try {
    const abs = path.join(config.mealsRoot, photoRelPath);
    const prepared = await prepareImage(abs, STAGE_C_IMAGE_LONG_EDGE);
    return prepared.base64;
  } catch (err) {
    log.warn(
      "nutrition",
      `photo prep failed (${photoRelPath}): ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

function deltaVsTarget(
  totals: Record<string, number | undefined>,
  targets: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, target] of Object.entries(targets)) {
    const actual = totals[k];
    if (typeof actual !== "number") continue;
    out[k] = Math.round((actual - target) * 10) / 10;
  }
  return out;
}

export async function runNutritionCluster(
  opts: RunNutritionClusterOpts,
): Promise<NutritionClusterResult> {
  const t0 = Date.now();
  const { periodKey } = opts;
  const day_complete = opts.day_complete ?? periodKey < berlinToday();

  const meals = readMealsForPeriod(periodKey).filter((m) => m.status !== "pending" && m.status !== "failed");
  if (meals.length === 0) {
    log.info("nutrition", `cluster ${periodKey} skip — no classified meals`);
    return {
      ok: true,
      periodKey,
      meals_count: 0,
      events_count: 0,
      flags_count: 0,
      latencyMs: Date.now() - t0,
      retried: false,
      skipped: "no_meals",
    };
  }

  const photos = await Promise.all(
    meals.map(async (m) => (m.photo_path ? await loadPhotoBase64(m.photo_path) : null)),
  );
  const photosCount = photos.filter(Boolean).length;
  if (photosCount === 0) {
    log.info(
      "nutrition",
      `cluster ${periodKey} skip — ${meals.length} meals, 0 photos (Stage C needs vision)`,
    );
    return {
      ok: true,
      periodKey,
      meals_count: meals.length,
      events_count: 0,
      flags_count: 0,
      latencyMs: Date.now() - t0,
      retried: false,
      skipped: "no_photos",
    };
  }

  const input: DayAggregateInput = {
    period_key: periodKey,
    day_complete,
    meals: meals.map((m, idx): DayAggregateInput["meals"][number] => ({
      meal_id: m.id,
      meal_at: m.user_meal_at,
      kind: m.kind,
      totals: m.totals,
      imageBase64: photos[idx],
    })),
  };

  let result: Awaited<ReturnType<typeof aggregateDay>>;
  try {
    result = await aggregateDay(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("nutrition", `cluster ${periodKey} aggregate failed: ${msg}`);
    return {
      ok: false,
      periodKey,
      meals_count: meals.length,
      events_count: 0,
      flags_count: 0,
      latencyMs: Date.now() - t0,
      retried: false,
      skipped: null,
      error: msg,
    };
  }

  const block: DayPatternBlock = {
    ...result.output,
    delta_vs_target: opts.targets
      ? deltaVsTarget(result.output.totals as unknown as Record<string, number>, opts.targets)
      : {},
  };

  const push = await pushInsight({
    periodKey,
    cluster: "nutrition",
    status: day_complete ? "complete" : "live",
    payload: block,
    source: "runner_v3_nutrition",
  });
  if (!push.ok && !push.queued) {
    return {
      ok: false,
      periodKey,
      meals_count: meals.length,
      events_count: block.events.length,
      flags_count: block.flags.length,
      latencyMs: Date.now() - t0,
      retried: result.retried,
      skipped: null,
      error: `pushInsight failed: ${push.error}`,
    };
  }

  log.info(
    "nutrition",
    `cluster ${periodKey} ok ${result.latencyMs}ms (${meals.length} meals, ${block.events.length} events, ${block.flags.length} flags${result.retried ? ", retried" : ""}${push.queued ? ", queued" : ""})`,
  );
  return {
    ok: true,
    periodKey,
    meals_count: meals.length,
    events_count: block.events.length,
    flags_count: block.flags.length,
    latencyMs: result.latencyMs,
    retried: result.retried,
    skipped: null,
  };
}

export type { StoredMeal };
