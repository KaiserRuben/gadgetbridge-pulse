import "server-only";

import { pulseDb } from "../pulse-db";
import { getWritableDb } from "../db-writable";
import type {
  Meal,
  MealComponent,
  MealKind,
  MealPhoto,
  MealRevision,
  MealSource,
  MealStatus,
  NutritionFacts,
} from "../nutrition/types";

const EMPTY_TOTALS: NutritionFacts = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
};

interface MealRow {
  id: string;
  user_meal_at: string;
  period_key: string;
  photo_path: string | null;
  photo_mime: string | null;
  user_text: string | null;
  notes: string | null;
  status: MealStatus;
  source: MealSource;
  kind: MealKind;
  classified_at: string | null;
  edited_at: string | null;
  error_reason: string | null;
  totals_json: string;
}

interface ComponentRow {
  id: string;
  meal_id: string;
  ord: number;
  food_key: string;
  label: string;
  grams: number;
  confidence: number | null;
  source: MealComponent["source"];
  nutrition_json: string;
}

interface RevisionRow {
  id: string;
  meal_id: string;
  created_at: string;
  diff_summary: string;
  by: "user" | "vlm";
}

interface PhotoRow {
  id: string;
  meal_id: string;
  ord: number;
  path: string;
  mime: string | null;
  kind: "meal" | "label" | "context" | null;
  captured_at: string | null;
}

function parseJSON<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function hydrateMeal(
  row: MealRow,
  components: ComponentRow[],
  revisions: RevisionRow[],
  photos: PhotoRow[],
): Meal {
  const orderedPhotos: MealPhoto[] = photos
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((p) => ({
      id: p.id,
      ord: p.ord,
      path: p.path,
      mime: p.mime,
      kind: p.kind,
      captured_at: p.captured_at,
    }));
  return {
    id: row.id,
    user_meal_at: row.user_meal_at,
    period_key: row.period_key,
    photo_path: row.photo_path,
    photo_mime: row.photo_mime,
    photos: orderedPhotos,
    user_text: row.user_text,
    notes: row.notes,
    status: row.status,
    source: row.source,
    kind: row.kind,
    classified_at: row.classified_at,
    edited_at: row.edited_at,
    error_reason: row.error_reason,
    components: components
      .sort((a, b) => a.ord - b.ord)
      .map((c) => ({
        id: c.id,
        ord: c.ord,
        food_key: c.food_key,
        label: c.label,
        grams: c.grams,
        confidence: c.confidence,
        source: c.source,
        nutrition: parseJSON(c.nutrition_json, { per100g: EMPTY_TOTALS, totals: EMPTY_TOTALS }),
      })),
    revisions: revisions.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      diff_summary: r.diff_summary,
      by: r.by,
    })),
    totals: parseJSON(row.totals_json, EMPTY_TOTALS),
  };
}

function readPhotosFor(mealIds: string[]): PhotoRow[] {
  if (mealIds.length === 0) return [];
  const db = pulseDb();
  if (!db) return [];
  try {
    const placeholders = mealIds.map(() => "?").join(",");
    return db
      .prepare<string[], PhotoRow>(
        `SELECT id, meal_id, ord, path, mime, kind, captured_at
         FROM PULSE_MEAL_PHOTO WHERE meal_id IN (${placeholders}) ORDER BY meal_id, ord`,
      )
      .all(...mealIds);
  } catch {
    // Table not yet migrated on this DB — fall through with no photos.
    return [];
  }
}

export function readMeal(mealId: string): Meal | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], MealRow>(
        `SELECT id, user_meal_at, period_key, photo_path, photo_mime,
                user_text, notes, status, source, kind,
                classified_at, edited_at, error_reason, totals_json
         FROM PULSE_MEAL WHERE id = ?`,
      )
      .get(mealId);
    if (!row) return null;
    const components = db
      .prepare<[string], ComponentRow>(
        `SELECT id, meal_id, ord, food_key, label, grams, confidence, source, nutrition_json
         FROM PULSE_MEAL_COMPONENT WHERE meal_id = ? ORDER BY ord`,
      )
      .all(mealId);
    const revisions = db
      .prepare<[string], RevisionRow>(
        `SELECT id, meal_id, created_at, diff_summary, by
         FROM PULSE_MEAL_REVISION WHERE meal_id = ? ORDER BY created_at DESC`,
      )
      .all(mealId);
    const photos = readPhotosFor([mealId]);
    return hydrateMeal(row, components, revisions, photos);
  } catch {
    return null;
  }
}

export function listMealsForPeriod(periodKey: string): Meal[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[string], MealRow>(
        `SELECT id, user_meal_at, period_key, photo_path, photo_mime,
                user_text, notes, status, source, kind,
                classified_at, edited_at, error_reason, totals_json
         FROM PULSE_MEAL WHERE period_key = ? ORDER BY user_meal_at`,
      )
      .all(periodKey);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const components = db
      .prepare<string[], ComponentRow>(
        `SELECT id, meal_id, ord, food_key, label, grams, confidence, source, nutrition_json
         FROM PULSE_MEAL_COMPONENT WHERE meal_id IN (${placeholders}) ORDER BY meal_id, ord`,
      )
      .all(...ids);
    const revisions = db
      .prepare<string[], RevisionRow>(
        `SELECT id, meal_id, created_at, diff_summary, by
         FROM PULSE_MEAL_REVISION WHERE meal_id IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...ids);
    const photos = readPhotosFor(ids);
    return rows.map((row) =>
      hydrateMeal(
        row,
        components.filter((c) => c.meal_id === row.id),
        revisions.filter((r) => r.meal_id === row.id),
        photos.filter((p) => p.meal_id === row.id),
      ),
    );
  } catch {
    return [];
  }
}

export function listPendingMeals(limit = 32): Meal[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[number], MealRow>(
        `SELECT id, user_meal_at, period_key, photo_path, photo_mime,
                user_text, notes, status, source, kind,
                classified_at, edited_at, error_reason, totals_json
         FROM PULSE_MEAL WHERE status = 'pending' ORDER BY user_meal_at LIMIT ?`,
      )
      .all(limit);
    const photos = readPhotosFor(rows.map((r) => r.id));
    return rows.map((row) =>
      hydrateMeal(
        row,
        [],
        [],
        photos.filter((p) => p.meal_id === row.id),
      ),
    );
  } catch {
    return [];
  }
}

/**
 * Minimal queue DTO returned to the Mac runner: enough to drive the
 * classify→enrich→persist pipeline without joining anything beyond the
 * photo table. `nutrition` totals and components stay empty until the
 * runner posts the classified result back.
 */
export interface PendingMealForRunner {
  meal_id: string;
  period_key: string;
  user_meal_at: string;
  user_text: string | null;
  notes: string | null;
  status: Extract<MealStatus, "pending" | "processing">;
  leased_at: string | null;
  photos: Array<{
    ord: number;
    path: string;
    mime: string | null;
    kind: "meal" | "label" | "context" | null;
  }>;
}

/**
 * Queue read for the runner. Returns oldest-pending-first up to `limit`,
 * each row joined with its photos[]. `status='processing'` rows are
 * deliberately excluded — the runner gets them via a successful claim,
 * not via this list, so re-reading the queue never re-emits an in-flight
 * meal.
 */
export function listPendingForRunner(limit = 16): PendingMealForRunner[] {
  const db = pulseDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare<[number], {
        id: string;
        user_meal_at: string;
        period_key: string;
        user_text: string | null;
        notes: string | null;
        status: "pending" | "processing";
        leased_at: string | null;
      }>(
        `SELECT id, user_meal_at, period_key, user_text, notes, status, leased_at
         FROM PULSE_MEAL
         WHERE status = 'pending'
         ORDER BY user_meal_at
         LIMIT ?`,
      )
      .all(limit);
    if (rows.length === 0) return [];
    const photos = readPhotosFor(rows.map((r) => r.id));
    return rows.map((r) => ({
      meal_id: r.id,
      period_key: r.period_key,
      user_meal_at: r.user_meal_at,
      user_text: r.user_text,
      notes: r.notes,
      status: r.status,
      leased_at: r.leased_at,
      photos: photos
        .filter((p) => p.meal_id === r.id)
        .sort((a, b) => a.ord - b.ord)
        .map((p) => ({ ord: p.ord, path: p.path, mime: p.mime, kind: p.kind })),
    }));
  } catch {
    return [];
  }
}

/**
 * Single-row variant of `listPendingForRunner` — used by the claim route to
 * hand back the just-claimed meal (now in `processing`) without forcing the
 * runner to do a follow-up GET.
 */
export function readPendingForRunner(mealId: string): PendingMealForRunner | null {
  const db = pulseDb();
  if (!db) return null;
  try {
    const row = db
      .prepare<[string], {
        id: string;
        user_meal_at: string;
        period_key: string;
        user_text: string | null;
        notes: string | null;
        status: "pending" | "processing";
        leased_at: string | null;
      }>(
        `SELECT id, user_meal_at, period_key, user_text, notes, status, leased_at
         FROM PULSE_MEAL
         WHERE id = ? AND status IN ('pending','processing')`,
      )
      .get(mealId);
    if (!row) return null;
    const photos = readPhotosFor([row.id]);
    return {
      meal_id: row.id,
      period_key: row.period_key,
      user_meal_at: row.user_meal_at,
      user_text: row.user_text,
      notes: row.notes,
      status: row.status,
      leased_at: row.leased_at,
      photos: photos
        .sort((a, b) => a.ord - b.ord)
        .map((p) => ({ ord: p.ord, path: p.path, mime: p.mime, kind: p.kind })),
    };
  } catch {
    return null;
  }
}

/**
 * Atomic pending→processing transition. Returns true if this caller now
 * owns the meal; false if someone else already claimed it or the meal is
 * not in `pending`. The runner must check the return value before
 * launching the pipeline — a 0-row update is a no-op, not an error.
 */
export function claimPendingMeal(mealId: string): boolean {
  const db = getWritableDb();
  const r = db
    .prepare(
      `UPDATE PULSE_MEAL
          SET status = 'processing',
              leased_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              error_reason = NULL
        WHERE id = ? AND status = 'pending'`,
    )
    .run(mealId);
  return r.changes > 0;
}

/**
 * Terminal failure write. Flips processing→failed and records the reason
 * so the dashboard + retry endpoint can surface it.
 */
export function failMeal(mealId: string, reason: string): void {
  const db = getWritableDb();
  db
    .prepare(
      `UPDATE PULSE_MEAL
          SET status = 'failed',
              leased_at = NULL,
              error_reason = ?
        WHERE id = ?`,
    )
    .run(reason.slice(0, 500), mealId);
}

/**
 * Manual retry: flip a failed meal back to pending so the next reconcile
 * tick picks it up. No-op on rows not in `failed` (already classified or
 * already pending). Returns true if the row was actually flipped.
 */
export function retryFailedMeal(mealId: string): boolean {
  const db = getWritableDb();
  const r = db
    .prepare(
      `UPDATE PULSE_MEAL
          SET status = 'pending',
              leased_at = NULL,
              error_reason = NULL
        WHERE id = ? AND status = 'failed'`,
    )
    .run(mealId);
  return r.changes > 0;
}

/**
 * Stale-lease sweep. Any meal that's been in `processing` longer than
 * `maxAgeMs` is treated as crashed and flipped to `failed` with reason
 * `lease_expired`. Returns the number of rows swept so the caller can
 * log it.
 *
 * Run from the same hourly tick that drives reconcile — the runner can't
 * sweep its own claims (it'd kick itself off a long-running VLM call) so
 * the Pi owns the sweep. Default TTL is 30 min; tune via the caller.
 */
export function sweepStaleLeases(maxAgeMs: number): number {
  const db = getWritableDb();
  const r = db
    .prepare(
      `UPDATE PULSE_MEAL
          SET status = 'failed',
              error_reason = 'lease_expired',
              leased_at = NULL
        WHERE status = 'processing'
          AND leased_at IS NOT NULL
          AND (strftime('%s', 'now') - strftime('%s', leased_at)) * 1000 > ?`,
    )
    .run(maxAgeMs);
  return r.changes;
}

export interface CreatePendingMealInput {
  id: string;
  user_meal_at: string;
  period_key: string;
  /**
   * One row per photo. The first entry becomes the cover (`photo_path` on
   * PULSE_MEAL). For text-only meals pass an empty array.
   */
  photos: Array<{
    path: string;
    mime: string | null;
    kind?: "meal" | "label" | "context" | null;
    captured_at?: string | null;
  }>;
  user_text: string | null;
  notes: string | null;
  kind?: MealKind;
}

export function createPendingMeal(input: CreatePendingMealInput): void {
  const db = getWritableDb();
  const cover = input.photos[0] ?? null;
  const source: MealSource = cover
    ? input.user_text
      ? "photo+text"
      : "photo"
    : input.user_text
      ? "text"
      : "manual";
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO PULSE_MEAL
         (id, user_meal_at, period_key, photo_path, photo_mime, user_text, notes,
          status, source, kind, totals_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      input.id,
      input.user_meal_at,
      input.period_key,
      cover?.path ?? null,
      cover?.mime ?? null,
      input.user_text,
      input.notes,
      source,
      input.kind ?? "snack",
      JSON.stringify(EMPTY_TOTALS),
    );
    if (input.photos.length > 0) {
      const ins = db.prepare(
        `INSERT INTO PULSE_MEAL_PHOTO (id, meal_id, ord, path, mime, kind, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.photos.forEach((p, idx) => {
        ins.run(
          `${input.id}-p${idx}`,
          input.id,
          idx,
          p.path,
          p.mime,
          p.kind ?? null,
          p.captured_at ?? null,
        );
      });
    }
  });
  tx();
}

export interface WriteClassifiedMealInput {
  id: string;
  status: MealStatus;
  kind: MealKind;
  classified_at: string;
  totals: NutritionFacts;
  components: Array<Omit<MealComponent, "id"> & { id?: string }>;
  /**
   * Terminal failure reason. Persisted as PULSE_MEAL.error_reason when
   * status='failed'. Ignored for any other status (cleared so a successful
   * reclassification doesn't carry old text).
   */
  error_reason?: string | null;
  /**
   * Updated cover photo path (mirrors photos[0].path). The Mac runner moves
   * the photo from `inbox/<period>/<id>.<ext>` to `photos/<period>/<id>.<ext>`
   * after a successful classification — passing the new path here lets the
   * single-writer (Pi) update PULSE_MEAL.photo_path without exposing a
   * separate endpoint.
   */
  photo_path?: string | null;
  /**
   * Updated photos[] list. When provided, PULSE_MEAL_PHOTO rows for this
   * meal are wholesale replaced (preserving ord). Used by the Mac runner
   * after moving photos from inbox/ to photos/. When omitted the existing
   * photos rows are left untouched.
   */
  photos?: Array<{
    path: string;
    mime: string | null;
    kind?: "meal" | "label" | "context" | null;
    captured_at?: string | null;
  }>;
}

export function writeClassifiedMeal(input: WriteClassifiedMealInput): void {
  const db = getWritableDb();
  const tx = db.transaction(() => {
    // Update photo_path only when provided — undefined means "leave unchanged".
    // Explicit null is honoured (caller wants to clear). photos[] is treated
    // separately so callers can update photo_path on PULSE_MEAL without
    // touching the photos[] table (or vice versa).
    const setPhoto = input.photo_path !== undefined;
    // error_reason mirrors status: clear it on success, store the truncated
    // reason on failure. Failure path needs no totals_json change beyond an
    // empty object — caller passes the empty totals so totals_json stays
    // consistent with the components[] (also empty on failure).
    const errReason =
      input.status === "failed" ? (input.error_reason ?? "").slice(0, 500) : null;
    // leased_at is always cleared here — the runner is releasing its claim
    // regardless of outcome.
    const updated = setPhoto
      ? db
          .prepare(
            `UPDATE PULSE_MEAL
                SET status = ?, kind = ?, classified_at = ?, totals_json = ?,
                    photo_path = ?, leased_at = NULL, error_reason = ?
              WHERE id = ?`,
          )
          .run(
            input.status,
            input.kind,
            input.classified_at,
            JSON.stringify(input.totals),
            input.photo_path,
            errReason,
            input.id,
          )
      : db
          .prepare(
            `UPDATE PULSE_MEAL
                SET status = ?, kind = ?, classified_at = ?, totals_json = ?,
                    leased_at = NULL, error_reason = ?
              WHERE id = ?`,
          )
          .run(
            input.status,
            input.kind,
            input.classified_at,
            JSON.stringify(input.totals),
            errReason,
            input.id,
          );
    if (updated.changes === 0) {
      throw new Error(`meal ${input.id} not found`);
    }
    db.prepare(`DELETE FROM PULSE_MEAL_COMPONENT WHERE meal_id = ?`).run(input.id);
    const ins = db.prepare(
      `INSERT INTO PULSE_MEAL_COMPONENT
         (id, meal_id, ord, food_key, label, grams, confidence, source, nutrition_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.components.forEach((c, idx) => {
      ins.run(
        c.id ?? `${input.id}-c${idx}`,
        input.id,
        c.ord ?? idx,
        c.food_key,
        c.label,
        c.grams,
        c.confidence,
        c.source,
        JSON.stringify(c.nutrition),
      );
    });
    if (input.photos) {
      // Wholesale replace so the new ord matches what the Mac runner moved
      // on disk. The original rows had the inbox/ paths; the new rows carry
      // photos/ paths after the move.
      db.prepare(`DELETE FROM PULSE_MEAL_PHOTO WHERE meal_id = ?`).run(input.id);
      const photoIns = db.prepare(
        `INSERT INTO PULSE_MEAL_PHOTO (id, meal_id, ord, path, mime, kind, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.photos.forEach((p, idx) => {
        photoIns.run(
          `${input.id}-p${idx}`,
          input.id,
          idx,
          p.path,
          p.mime,
          p.kind ?? null,
          p.captured_at ?? null,
        );
      });
    }
  });
  tx();
}

export interface EditMealInput {
  id: string;
  components: Array<Omit<MealComponent, "id"> & { id?: string }>;
  totals: NutritionFacts;
  revision: Omit<MealRevision, "id" | "created_at"> & {
    diff_json: unknown;
  };
}

export function editMeal(input: EditMealInput): void {
  const db = getWritableDb();
  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE PULSE_MEAL
            SET status = 'edited', edited_at = ?, totals_json = ?
          WHERE id = ?`,
      )
      .run(nowIso, JSON.stringify(input.totals), input.id);
    if (updated.changes === 0) throw new Error(`meal ${input.id} not found`);
    db.prepare(`DELETE FROM PULSE_MEAL_COMPONENT WHERE meal_id = ?`).run(input.id);
    const ins = db.prepare(
      `INSERT INTO PULSE_MEAL_COMPONENT
         (id, meal_id, ord, food_key, label, grams, confidence, source, nutrition_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.components.forEach((c, idx) => {
      ins.run(
        c.id ?? `${input.id}-c${idx}`,
        input.id,
        c.ord ?? idx,
        c.food_key,
        c.label,
        c.grams,
        c.confidence,
        c.source,
        JSON.stringify(c.nutrition),
      );
    });
    db.prepare(
      `INSERT INTO PULSE_MEAL_REVISION (id, meal_id, created_at, diff_summary, diff_json, by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `${input.id}-r${Date.now()}`,
      input.id,
      nowIso,
      input.revision.diff_summary,
      JSON.stringify(input.revision.diff_json),
      input.revision.by,
    );
  });
  tx();
}

export function deleteMeal(mealId: string): void {
  const db = getWritableDb();
  db.prepare(`DELETE FROM PULSE_MEAL WHERE id = ?`).run(mealId);
}

export interface WriteFoodCacheInput {
  food_key: string;
  label: string | null;
  source: "seed" | "llm";
  model: string | null;
  per100g: NutritionFacts;
  captured_at: string;
}

/**
 * Upsert a per-100g nutrition entry. The Mac runner's LLM enrich stage calls
 * this via /api/ingest/food after a fresh classification — the row then sits
 * in PULSE_FOOD_NUTRITION and skips the LLM call on every subsequent meal
 * containing the same food_key.
 */
export function writeFoodCache(input: WriteFoodCacheInput): void {
  const db = getWritableDb();
  db.prepare(
    `INSERT INTO PULSE_FOOD_NUTRITION (food_key, label, source, model, per_100g_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(food_key) DO UPDATE SET
       label = excluded.label,
       source = excluded.source,
       model = excluded.model,
       per_100g_json = excluded.per_100g_json,
       captured_at = excluded.captured_at`,
  ).run(
    input.food_key,
    input.label,
    input.source,
    input.model,
    JSON.stringify(input.per100g),
    input.captured_at,
  );
}
