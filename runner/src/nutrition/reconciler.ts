/**
 * Nutrition reconciler — pulls the meal classify queue from the Pi.
 *
 * Replaces the inbox-sidecar watcher. The queue lives in PULSE_MEAL on the
 * Pi (status='pending' / 'processing'); the Mac runner pulls it, claims one
 * meal at a time, runs the orchestrator, and posts the terminal status back.
 *
 * Trigger sources:
 *   - hourly tick (resilience fallback)
 *   - boot (catch-up — same query, drains anything missed while down)
 *   - manual via the bus event `meal_logged_pending` (optional low-latency
 *     hook — Pi POSTs after upload; not yet wired)
 *
 * Drain semantics: each tick pulls a page, processes all photos-ready meals
 * sequentially, then re-pulls. Loop exits when the page comes back empty.
 * Meals whose photos haven't synced from Pi yet stay in `pending` and are
 * tried again on the next tick — we don't claim them until the bytes
 * are on disk, so there is no "stuck in processing" state.
 *
 * Concurrency: a global semaphore prevents two ticks from interleaving on
 * the same runner (boot + first hourly + bus event would otherwise race).
 * Different Mac instances aren't supported here — pulse.db single-writer
 * is the Pi, but the GPU lane is single-tenant per Mac.
 */

import { stat } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.ts";
import { log } from "../logger.ts";
import { claimMeal, fetchPendingMeals, pushMeal } from "../ingest/client.ts";
import { runMeal } from "./orchestrator.ts";
import type { MealJob } from "./types.ts";

const PAGE_SIZE = 8;
const EMPTY_TOTALS = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

let inFlight: Promise<void> | null = null;

/**
 * Single reconcile tick: drain the pending queue until no more photos-ready
 * meals remain. Re-entrant-safe — overlapping calls share the same promise
 * so a hourly tick that lands mid-drain just awaits the existing run.
 */
export function reconcileMeals(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await drain();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function drain(): Promise<void> {
  let totalProcessed = 0;
  let totalSkipped = 0;
  while (true) {
    const page = await fetchPendingMeals(PAGE_SIZE);
    if (page.length === 0) break;
    let didWork = false;
    for (const dto of page) {
      const photosReady = await photosOnDisk(dto.photos.map((p) => p.path));
      if (!photosReady) {
        totalSkipped++;
        continue;
      }
      const claim = await claimMeal(dto.meal_id);
      if (!claim.ok || !claim.meal) {
        log.info("reconciler", `${dto.meal_id} claim conflict: ${claim.reason ?? "?"}`);
        continue;
      }
      didWork = true;
      totalProcessed++;
      await processClaimedMeal(claim.meal);
    }
    // If the whole page was photos-not-ready, no progress can happen until
    // Syncthing lands the bytes. Bail out and wait for the next tick.
    if (!didWork) break;
  }
  if (totalProcessed > 0 || totalSkipped > 0) {
    log.info(
      "reconciler",
      `drain done processed=${totalProcessed} skipped=${totalSkipped}`,
    );
  }
}

async function processClaimedMeal(dto: {
  meal_id: string;
  period_key: string;
  user_meal_at: string;
  user_text: string | null;
  notes: string | null;
  photos: Array<{
    ord: number;
    path: string;
    mime: string | null;
    kind: "meal" | "label" | "context" | null;
  }>;
}): Promise<void> {
  const job: MealJob = {
    meal_id: dto.meal_id,
    period_key: dto.period_key,
    user_meal_at: dto.user_meal_at,
    user_text: dto.user_text,
    notes: dto.notes,
    photos: dto.photos
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((p) => ({ ord: p.ord, path: p.path, mime: p.mime, kind: p.kind })),
  };
  try {
    const r = await runMeal(job);
    if (r.ok) return; // persist.ts already pushed status='classified'
    await markFailed(job.meal_id, r.error ?? "unknown_error");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("reconciler", `${job.meal_id} crashed: ${msg}`);
    await markFailed(job.meal_id, `crashed: ${msg}`);
  }
}

async function markFailed(mealId: string, reason: string): Promise<void> {
  // pushMeal carries the failed transition back to the Pi, which short-
  // circuits to failMeal() and clears the lease. kind/totals/components are
  // required by the schema but ignored on the failed branch — we send
  // harmless defaults so the request validates.
  const r = await pushMeal({
    id: mealId,
    status: "failed",
    kind: "snack",
    classified_at: new Date().toISOString(),
    totals: EMPTY_TOTALS,
    components: [],
    error_reason: reason,
  });
  if (!r.ok && !r.queued) {
    log.error("reconciler", `markFailed ${mealId}: ${r.error ?? "?"}`);
  }
}

async function photosOnDisk(relPaths: string[]): Promise<boolean> {
  for (const rel of relPaths) {
    const abs = path.join(config.mealsRoot, rel);
    try {
      await stat(abs);
    } catch {
      return false;
    }
  }
  return true;
}
