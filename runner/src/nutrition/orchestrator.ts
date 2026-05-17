/**
 * Per-meal pipeline orchestrator: Stage A (classify) → B (enrich) → C (persist).
 *
 * Driven by the nutrition reconciler, which pulls `MealJob`s from the Pi's
 * pulse.db queue (`status='pending'`, atomically claimed → `processing`).
 * The pre-queue inbox-sidecar path is gone — pulse.db is the source of truth.
 *
 * Failures bubble up so the reconciler can flip `status='failed'` with the
 * reason text. Photo prep, classify, enrich, and persist each surface a
 * distinct error prefix so the dashboard can tell them apart.
 */

import path from "node:path";

import { config } from "../config.ts";
import { log } from "../logger.ts";
import { classifyMeal, type ClassifyImage } from "./stages/classify-vlm.ts";
import { enrichComponents } from "./stages/enrich.ts";
import { persistMeal } from "./stages/persist.ts";
import { prepareImage } from "./image-prep.ts";
import type { MealJob } from "./types.ts";

const STAGE_A_IMAGE_LONG_EDGE = 1024;

export interface RunMealResult {
  ok: boolean;
  mealId: string;
  totalMs: number;
  classifyMs?: number;
  unresolved?: string[];
  error?: string;
}

export async function runMeal(job: MealJob): Promise<RunMealResult> {
  const start = Date.now();
  log.info("nutrition", `runMeal ${job.meal_id} → start`);

  // Prepare every photo attached to the meal. Each photo is resized to a
  // 1024 long-edge JPEG before being passed to the VLM so we don't blow the
  // model's context with a 4000px label scan.
  const preparedImages: ClassifyImage[] = [];
  for (const p of job.photos) {
    try {
      const abs = path.join(config.mealsRoot, p.path);
      const prepared = await prepareImage(abs, STAGE_A_IMAGE_LONG_EDGE);
      preparedImages.push({ base64: prepared.base64, kind: p.kind, ord: p.ord });
    } catch (err) {
      const msg = `photo prep failed (#${p.ord} ${p.path}): ${err instanceof Error ? err.message : err}`;
      log.error("nutrition", `runMeal ${job.meal_id} ${msg}`);
      return { ok: false, mealId: job.meal_id, totalMs: Date.now() - start, error: msg };
    }
  }

  let classifyResult;
  try {
    classifyResult = await classifyMeal({ job, images: preparedImages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("nutrition", `runMeal ${job.meal_id} classify failed: ${msg}`);
    return { ok: false, mealId: job.meal_id, totalMs: Date.now() - start, error: `classify: ${msg}` };
  }

  const enriched = await enrichComponents(classifyResult.output);

  const kind = classifyResult.output.meal_kind;
  const classifiedAt = new Date().toISOString();

  try {
    await persistMeal({
      job,
      kind,
      totals: enriched.totals,
      components: enriched.components,
      classifiedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("nutrition", `runMeal ${job.meal_id} persist failed: ${msg}`);
    return { ok: false, mealId: job.meal_id, totalMs: Date.now() - start, error: `persist: ${msg}` };
  }

  const totalMs = Date.now() - start;
  log.info("nutrition", `runMeal ${job.meal_id} ok ${totalMs}ms`);
  return {
    ok: true,
    mealId: job.meal_id,
    totalMs,
    classifyMs: classifyResult.latencyMs,
    unresolved: enriched.unresolved,
  };
}
