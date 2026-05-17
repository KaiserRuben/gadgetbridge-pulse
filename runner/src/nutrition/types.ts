/**
 * Runner-internal nutrition types.
 *
 * Two layers:
 *   - **Model-output types** (`ClassifyOutput`, `EnrichOutput`,
 *     `DayAggregateOutput`) mirror the strict locked JSON schemas in
 *     `runner/src/schemas/nutrition/*.schema.json` exactly. No envelope
 *     fields — the model emits the minimal generation shape.
 *   - **Storage / pipeline types** (`MealComponent`, `NutritionSnapshot`,
 *     etc.) carry the persisted shape. The runner wraps model outputs into
 *     these before POSTing to Pi.
 */

export type MealKind = "breakfast" | "lunch" | "dinner" | "snack" | "drink";
export type ComponentSource = "vlm" | "user_edit" | "user_add" | "user_text";

// ── Storage shape ───────────────────────────────────────────────────────────

export interface NutritionFacts {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
  saturated_fat_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  calcium_mg?: number;
  magnesium_mg?: number;
  zinc_mg?: number;
  vit_c_mg?: number;
  vit_d_ug?: number;
  vit_b12_ug?: number;
  folate_ug?: number;
  omega3_g?: number;
}

export interface NutritionSnapshot {
  per100g: NutritionFacts;
  totals: NutritionFacts;
}

export interface MealComponent {
  ord: number;
  food_key: string;
  label: string;
  grams: number;
  confidence: number | null;
  source: ComponentSource;
  nutrition: NutritionSnapshot;
}

/**
 * One photo attached to a meal. `path` is relative to the meals root and
 * starts as `inbox/<period>/<file>` before classification, gets rewritten
 * to `photos/<period>/<file>` once persist.ts moves the file.
 */
export interface MealPhotoRef {
  ord: number;
  path: string;
  mime: string | null;
  kind: "meal" | "label" | "context" | null;
}

/**
 * Queue-driven meal job. The Mac runner builds one of these from the Pi's
 * `/api/nutrition/pending` (or `/claim`) response — pulse.db is the
 * authoritative queue, so there is no on-disk sidecar JSON involved.
 */
export interface MealJob {
  meal_id: string;
  period_key: string;
  user_meal_at: string;
  user_text: string | null;
  notes: string | null;
  photos: MealPhotoRef[];
}

// ── Stage A — classify (strict locked, model emits exactly this) ────────────

export interface ClassifyComponentOutput {
  label: string;
  food_key: string;
  grams: number;
  confidence: number;
  rationale: string;
  source: "vlm" | "user_text";
}

export interface ClassifyOutput {
  meal_kind: MealKind;
  components: ClassifyComponentOutput[];
  notes: string;
}

// ── Stage B — enrich (strict locked) ────────────────────────────────────────

export interface EnrichPer100g {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  iron_mg: number;
  vit_c_mg: number;
  vit_b12_ug: number;
  calcium_mg: number;
  magnesium_mg: number;
}

export interface EnrichOutput {
  food_key: string;
  label_de: string;
  per_100g: EnrichPer100g;
  notes: string;
}

// ── Stage C — day-aggregate (strict locked) ─────────────────────────────────

export type DayPatternKind =
  | "single_meal"
  | "multi_course"
  | "snacking"
  | "drink_round";

export interface DayPatternEventOutput {
  kind: DayPatternKind;
  started_at: string;
  ended_at: string;
  /** `m1`, `m2`, ... — pseudo-IDs assigned at call time; runner maps back to real meal IDs. */
  meal_ids: string[];
  summary: string;
}

export interface DayAggregateOutput {
  day_pattern: {
    events: DayPatternEventOutput[];
    flags: string[];
  };
}
