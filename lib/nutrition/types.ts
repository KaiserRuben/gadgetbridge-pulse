/**
 * Nutrition domain types.
 *
 * Mirrors the schema in `docs/NUTRITION_PLAN.md`. Source of truth for the
 * UI; the runner/Pi schemas will be regenerated to align before wire-up.
 *
 * Keep all units explicit in the field name (`_g`, `_mg`, `_ug`, `_kcal`).
 * Snapshot semantics: every `nutrition` block carries its own per-100g
 * + totals so later DB updates can't retroactively rewrite history.
 */

export type MealKind = "breakfast" | "lunch" | "dinner" | "snack" | "drink";

export type MealStatus = "pending" | "classified" | "edited" | "failed";

export type MealSource = "photo" | "photo+text" | "text" | "manual";

export type ComponentSource = "vlm" | "user_edit" | "user_add" | "user_text";

/** Per-100g + totals snapshot, frozen at classification time. */
export interface NutritionSnapshot {
  per100g: NutritionFacts;
  totals: NutritionFacts;
}

/**
 * All nutrient fields optional — a meal may only have macros from VLM and
 * still emit `iron_mg: null` until enrichment fills it. Renderers must
 * tolerate gaps.
 */
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

export interface MealComponent {
  id: string;
  ord: number;
  food_key: string;
  label: string;          // display label (de)
  grams: number;
  confidence: number | null; // 0..1 from VLM, null for user_add
  source: ComponentSource;
  nutrition: NutritionSnapshot;
}

export interface MealRevision {
  id: string;
  created_at: string;            // ISO8601
  diff_summary: string;          // 1-line human-readable diff for the UI
  by: "user" | "vlm";
}

/**
 * A single photo attached to a meal. `path` is relative to the meals root
 * (`$PULSE_ROOT/meals/`) and lives in `inbox/` while the meal is pending,
 * `photos/` after classification.
 *
 * `kind` is a hint to the VLM and a UI affordance — "meal" for the food
 * itself, "label" for nutrition packaging, "context" for plate angles /
 * receipts. The classifier may also override it from inferred content.
 */
export interface MealPhoto {
  id: string;
  ord: number;
  path: string;
  mime: string | null;
  kind: "meal" | "label" | "context" | null;
  captured_at: string | null;
}

export interface Meal {
  id: string;
  user_meal_at: string;          // ISO8601 local
  period_key: string;            // wake-date local YYYY-MM-DD
  /** Cover photo path (mirrors photos[0].path) — kept for fast list views. */
  photo_path: string | null;
  photo_mime: string | null;
  /** Full ordered list of photos for this meal. Empty for text-only logs. */
  photos: MealPhoto[];
  user_text: string | null;
  notes: string | null;
  status: MealStatus;
  source: MealSource;
  kind: MealKind;
  classified_at: string | null;
  edited_at: string | null;
  /**
   * Populated when status='failed' — the runner's terminal reason
   * (`schema:…`, `fetch:…`, `lease_expired`, etc). UI surfaces it so the
   * user knows why a meal didn't classify, and the retry button can
   * decide whether to clear it before requeueing.
   */
  error_reason: string | null;
  components: MealComponent[];
  revisions: MealRevision[];
  /** Cached aggregate over components, for fast list rendering. */
  totals: NutritionFacts;
}

// ── Targets ────────────────────────────────────────────────────────────

export type TargetUnit = "kcal" | "g" | "mg" | "ug";

/**
 * A single target row. Either a literal `target` or an `auto_from` formula
 * string (evaluated server-side later; UI just displays it).
 */
export interface NutrientTarget {
  key: string;                   // e.g. "protein_g", "iron_mg"
  label: string;
  unit: TargetUnit;
  group: "macro" | "micro";
  target: number | null;
  /** Free-text formula that the coach can resolve, e.g. "1.6 * weight_kg". */
  auto_from: string | null;
  default_target: number | null;
}

export interface NutritionTargets {
  updated_at: string;
  rows: NutrientTarget[];
}

// ── Day-level pattern (consumed from v3 nutrition cluster) ─────────────

export type DayPatternKind =
  | "single_meal"
  | "multi_course"
  | "snacking"
  | "drink_round";

export interface DayPatternEvent {
  kind: DayPatternKind;
  started_at: string;            // ISO8601 local
  ended_at: string;
  meal_ids: string[];
  summary: string;               // 1–2 lines de
}

export interface DayPatternBlock {
  period_key: string;
  totals: NutritionFacts;
  delta_vs_target: Partial<Record<keyof NutritionFacts, number>>;
  events: DayPatternEvent[];
  flags: string[];
  /** Number of meals logged on this date. Used by the smart-hide rule. */
  meals_count: number;
  /** True when the day is past day_end and is safe to surface. */
  day_complete: boolean;
}
