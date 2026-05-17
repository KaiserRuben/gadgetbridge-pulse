/**
 * Stage C — persist classified meal.
 *
 * Three writes:
 *   1. Move every photo from `inbox/<period>/<id>.<ext>` to
 *      `photos/<period>/<id>.<ext>` so the inbox stays a clean queue and
 *      a re-claim can't reprocess a stale path.
 *   2. POST to Pi `/api/ingest/meal` (DB row + components in pulse.db),
 *      including the new photo_path so the dashboard can serve the photo.
 *   3. Atomic JSON snapshot at `$mealsRoot/records/<period>/<id>.json`. The
 *      dashboard reads either source — DB row for live + index, JSON snapshot
 *      for long-term archive and (eventually) v3 packager input.
 *
 * No sidecar parking: the queue lives in pulse.db now, not on disk. The
 * status transition from `processing` → `classified` (via pushMeal) is the
 * "done" signal.
 */

import { mkdir, rename, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import { config } from "../../config.ts";
import { log } from "../../logger.ts";
import { pushMeal } from "../../ingest/client.ts";
import type {
  MealPhotoRef,
  MealComponent,
  MealJob,
  MealKind,
  NutritionFacts,
} from "../types.ts";

export interface PersistInput {
  job: MealJob;
  kind: MealKind;
  totals: NutritionFacts;
  components: MealComponent[];
  classifiedAt: string;
}

export async function persistMeal(input: PersistInput): Promise<void> {
  const { job, kind, totals, components, classifiedAt } = input;

  // 1. Move every photo from inbox/ to photos/. Each meal can carry up to
  //    MAX_PHOTOS_PER_MEAL (4) — meal photo, nutrition label, plate angle,
  //    receipt. The upload route writes them all to `inbox/<period>/...`
  //    and stores the inbox paths in the DB; we relocate to the permanent
  //    `photos/` archive and send the new paths back to the Pi for the
  //    DB update.
  const stagedPhotos = job.photos;
  const movedPhotos: MealPhotoRef[] = [];
  for (const photo of stagedPhotos) {
    const ext = path.extname(photo.path) || ".jpg";
    // Mirror the upload-route naming: ord=0 keeps a bare filename, others
    // get an `_<ord>` suffix. Recompute from the original basename so we
    // don't lose any hash already in there.
    const baseName = path.basename(photo.path, ext);
    const srcAbs = path.join(config.mealsRoot, photo.path);
    const destRel = path.posix.join("photos", job.period_key, `${baseName}${ext}`);
    const destAbs = path.join(config.mealsRoot, destRel);
    try {
      await stat(srcAbs);
      await mkdir(path.dirname(destAbs), { recursive: true });
      await rename(srcAbs, destAbs);
      movedPhotos.push({ ...photo, path: destRel });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Already moved (re-claim) or never landed. If the file exists at
        // the destination already, claim that path; otherwise keep the
        // inbox path so the dashboard read doesn't break.
        try {
          await stat(destAbs);
          movedPhotos.push({ ...photo, path: destRel });
        } catch {
          movedPhotos.push(photo);
        }
      } else {
        log.warn(
          "nutrition",
          `persistMeal: photo move failed for ${job.meal_id}#${photo.ord}: ${
            (err as Error).message
          }`,
        );
        movedPhotos.push(photo);
      }
    }
  }
  const cover = movedPhotos[0] ?? null;

  // 2. POST to Pi (includes the new photo_path + photos[] so the DB row + the
  //    PULSE_MEAL_PHOTO rows point at the permanent location).
  const res = await pushMeal({
    id: job.meal_id,
    status: "classified",
    kind,
    classified_at: classifiedAt,
    totals: totals as unknown as Record<string, number>,
    components: components.map((c) => ({
      ord: c.ord,
      food_key: c.food_key,
      label: c.label,
      grams: c.grams,
      confidence: c.confidence,
      source: c.source,
      nutrition: {
        per100g: c.nutrition.per100g as unknown as Record<string, number>,
        totals: c.nutrition.totals as unknown as Record<string, number>,
      },
    })),
    ...(cover ? { photo_path: cover.path } : {}),
    ...(movedPhotos.length > 0
      ? {
          photos: movedPhotos.map((p) => ({
            path: p.path,
            mime: p.mime,
            kind: p.kind ?? null,
            captured_at: null,
          })),
        }
      : {}),
  });
  if (!res.ok && !res.queued) {
    throw new Error(`persistMeal: ingest failed: ${res.error ?? "unknown"}`);
  }
  if (res.queued) {
    log.warn("nutrition", `persistMeal: queued for replay (Pi unreachable)`);
  }

  // 3. JSON snapshot (long-term archive).
  const recordsDir = path.join(config.mealsRoot, "records", job.period_key);
  await mkdir(recordsDir, { recursive: true });
  const snapshotPath = path.join(recordsDir, `${job.meal_id}.json`);
  const tmpPath = `${snapshotPath}.tmp`;
  const snapshot = {
    schema_version: "nutrition/meal/v2" as const,
    id: job.meal_id,
    user_meal_at: job.user_meal_at,
    period_key: job.period_key,
    photo_path: cover?.path ?? null,
    photo_mime: cover?.mime ?? null,
    photos: movedPhotos,
    user_text: job.user_text,
    notes: job.notes,
    status: "classified" as const,
    source: movedPhotos.length > 0
      ? job.user_text
        ? ("photo+text" as const)
        : ("photo" as const)
      : ("text" as const),
    kind,
    classified_at: classifiedAt,
    edited_at: null,
    components: components.map((c, idx) => ({
      id: `${job.meal_id}-c${idx}`,
      ...c,
    })),
    revisions: [],
    totals,
  };
  await writeFile(tmpPath, JSON.stringify(snapshot, null, 2));
  await rename(tmpPath, snapshotPath);
}
