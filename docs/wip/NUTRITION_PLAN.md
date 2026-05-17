# Nutrition Tracking — Design + Integration Plan

Status: draft. Author handoff doc; not implementation yet.

## 1. Goal & Scope

Photo-driven, async meal logging with VLM-based food classification and
nutrient enrichment. Surface daily/weekly intake, integrate with coach, and
trigger broad-trend insights (protein gap on training days, recurring
micronutrient shortfalls, time-of-day patterns).

Accuracy target: directional, not clinical. Optimise for low-friction
capture + easy correction over precise gram readings. The general-system
principle applies: tracking must not assume the user's diet, training
phase, or target nutrients.

In scope:
- Meal photo upload (one photo per record; optional text always alongside).
- Multi-course meals → multiple meal records over time. Day-level aggregator
  (multi-image VLM) reads the pattern intrinsically from timestamps +
  photos; no per-meal grouping UX.
- Text-only entry as standalone path ("2 eggs + toast") AND as supplement
  to any photo ("with 30g butter" / "deep-fried" / "share-plate, I ate ~⅓").
- Drink/snack support (same pipeline, no separate UX).
- Per-meal storage (raw photo, classification, edits).
- Day/week aggregates and trends.
- Configurable targets (macros + micros) per user, with sensible defaults.
- Coach-cluster integration (`v3/packagers/nutrition.ts`).

Out of scope (v1):
- Barcode scanning.
- Restaurant menu APIs.
- Recipe import.
- Calorie balance vs activity (deferred; data is there, defer until
  intake-side is trusted).

## 2. Data Model

`pulse.db` is single-writer Pi. Mac classifies and POSTs results; Pi
writes. New tables (sqlite):

```sql
CREATE TABLE meal (
  id              TEXT PRIMARY KEY,             -- uuidv7
  user_meal_at    TEXT NOT NULL,                -- ISO8601 local
  period_key      TEXT NOT NULL,                -- wake-date local
  photo_path      TEXT,                         -- rel to $PULSE_ROOT/meals/photos
  photo_mime      TEXT,                         -- image/jpeg|image/heic|image/webp|...
  user_text       TEXT,                         -- optional, always available even with photo
  status          TEXT NOT NULL,                -- pending|classified|edited|failed
  classified_at   TEXT,
  edited_at       TEXT,
  source          TEXT NOT NULL,                -- photo|photo+text|text|manual
  notes           TEXT                          -- post-classify user note
);

CREATE TABLE meal_component (
  id              TEXT PRIMARY KEY,
  meal_id         TEXT NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
  ord             INTEGER NOT NULL,
  food_key        TEXT NOT NULL,                -- normalised key (e.g. "potato_boiled")
  label           TEXT NOT NULL,                -- display label (de)
  grams           REAL NOT NULL,
  confidence      REAL,                         -- 0..1 from VLM
  source          TEXT NOT NULL,                -- vlm|user_edit|user_add
  nutrition_json  TEXT NOT NULL                 -- per-100g + totals snapshot
);

CREATE TABLE meal_revision (
  id              TEXT PRIMARY KEY,
  meal_id         TEXT NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  diff_json       TEXT NOT NULL                 -- before/after components
);

CREATE INDEX idx_meal_period ON meal(period_key);
CREATE INDEX idx_meal_time   ON meal(user_meal_at);
CREATE INDEX idx_comp_meal   ON meal_component(meal_id);
```

`nutrition_json` (per component) captures the snapshot at classification
time so later database updates don't retroactively change history:

```json
{
  "per100g": { "kcal": 77, "protein_g": 2, "carbs_g": 17, "fat_g": 0.1,
                "fiber_g": 2.2, "iron_mg": 0.8, "vit_c_mg": 19, ... },
  "totals":  { "kcal": 154, "protein_g": 4, ... }
}
```

## 3. Storage Layout

Under `$PULSE_ROOT`:

```
meals/
├── inbox/<period_key>/<meal_id>.{jpg,heic,webp}     # awaiting classify
├── photos/<period_key>/<meal_id>.jpg                # post-resize, archived
├── records/<period_key>/<meal_id>.json              # full meal record snapshot
└── targets.json                                     # user nutrient targets
```

Single-writer rule: Mac runner moves `inbox → photos` after successful
classification and POSTs the JSON to Pi. Pi never writes to `inbox/`.

Atomic writes via `output.ts` writer. `records/*.json` is the read-side
authoritative artifact for the dashboard so the UI doesn't depend on
SQLite for history.

## 4. Capture Flow

```
[Phone PWA] --HTTPS--> [Pi /api/nutrition/upload] --fs--> $PULSE_ROOT/meals/inbox/<period>/<id>.jpg
                                                                ↓ syncthing
                                                       [Mac runner watcher]
                                                                ↓
                                                       VLM classify (qwen3.6)
                                                                ↓
                                                       nutrient enrich
                                                                ↓
                                                       POST /api/ingest/meal
                                                                ↓
                                                       Pi writes pulse.db + records/<id>.json
                                                                ↓
                                                       bus.emit("meal_logged")
                                                                ↓
                                                       v3 nutrition cluster
```

Upload endpoint `POST /api/nutrition/upload`:
- Multipart `image` (optional) + `text` (optional) + optional `meal_at`
  override + optional `notes`. At least one of `image` or `text` required.
- Format: keep what the user uploads. qwen3.6 vision accepts JPEG/PNG/WebP/
  HEIC. Store original extension + mime; no transcode. Resize on the
  classify hop if pixel dimensions exceed a sanity cap (e.g. long-edge
  >2048px) to keep VLM latency stable, but archive original.
- Compute `period_key` from `meal_at` (defaults to upload time).
- Write photo (if any) to `inbox/` with original extension.
- Create `meal` row with `status='pending'`, `source` = `photo|photo+text|text`.
- Return `{ meal_id }`.

UI gets `meal_id`, polls `/api/nutrition/meal/<id>` (or WS) for status →
`classified`, then shows components for review.

Text-only path: same endpoint, `image` field empty. Runner skips Stage A
vision call, runs a text-only classify prompt instead.

## 5. VLM Pipeline (Mac runner)

New stage dir `runner/src/nutrition/`:

```
runner/src/nutrition/
├── watcher.ts            # chokidar on meals/inbox + pulse.db pending rows
├── stages/
│   ├── classify-vlm.ts   # qwen3.6 vision → components[]
│   ├── enrich.ts         # food_key + grams → nutrition snapshot
│   └── persist.ts        # POST to Pi /api/ingest/meal
├── prompts/
│   ├── classify.ts
│   └── enrich.ts
├── food-db/
│   ├── seed.json         # static fallback table (USDA-derived subset)
│   └── lookup.ts
└── schemas/
    ├── classify.schema.json
    └── meal.schema.json
```

### Stage A: classify (vision + optional text)

Single qwen3.6 call. Photo + `user_text` (when present) go into the same
prompt — the text is a strong hint, not separate input. e.g. user_text
"200g Butter" overrides any butter portion the VLM would have guessed.
Structured output:

```json
{
  "meal_kind": "lunch|breakfast|dinner|snack|drink",
  "components": [
    { "label": "Kartoffeln gekocht", "food_key": "potato_boiled",
      "grams": 200, "confidence": 0.78, "rationale": "tellergroß, ~2 mittelgroße knollen",
      "source": "vlm|user_text" },
    ...
  ],
  "notes": "plate ~25cm reference if visible"
}
```

Text-only branch: same schema, prompt drops vision turn. `source` on
components is `user_text` and confidence reflects parse certainty.

Portion estimation is the weak link. Mitigation:
- Prompt encourages reference objects (plate, fork, hand) and rationale.
- `user_text` is the user's escape hatch ("share-plate, I ate ~⅓",
  "200g butter").
- `confidence` < 0.5 marks component as `needs_review` in UI.
- Default grams come from "typical serving" when prompt has no anchor.
- User edits go to `meal_revision`, so model never overwrites edits.

### Stage B: enrich (nutrition lookup)

Hybrid:
1. Look up `food_key` in `food-db/seed.json` (static, USDA-style per-100g
   values for ~300 common foods). Direct hit → use it.
2. Miss → text LLM (ministral or qwen3.6) prompted to emit per-100g nutrition
   in fixed schema. Result is cached to `food-db/cache.json` (keyed by
   `food_key`) so the second sighting is free and deterministic.
3. Compute `totals = per100g * grams / 100`.

Why hybrid: LLM-only nutrition is plausible for macros but unreliable for
micronutrients (iron, B12, magnesium). Static table for the long tail of
common foods, LLM-with-caching for the long tail of uncommon foods.

Cache shape (`food-db/cache.json`):
```json
{
  "potato_boiled":  { "source": "seed",  "per100g": {...} },
  "kichererbsen":   { "source": "llm",   "model": "qwen3.6", "per100g": {...},
                      "captured_at": "2026-05-16" }
}
```

Optional later: Open Food Facts integration (offline snapshot in Syncthing
share) for canonical micronutrient data. Defer until v1 is in use.

### Stage C: persist

POST `/api/ingest/meal` with full record. Pi writes pulse.db rows and the
`records/<id>.json` snapshot, then emits `meal_logged` on the bus.

## 6. Events & Coach Integration

Bus additions (`runner/src/events/bus.ts`):
- `meal_logged_pending` — upload landed, awaiting classify.
- `meal_classified`     — classification done.
- `meal_edited`         — user correction; triggers recompute of day rollup.

Subscribers (`runner/src/events/subscribers.ts`):
- `meal_logged_pending` → runs Stage A + B + C.
- `meal_classified` / `meal_edited` → recompute day aggregate, fire
  `nutrition_changed` for the v3 nutrition cluster (debounced 60s).
- Existing `day_end` → triggers final nutrition cluster + roll into
  synthesis.

New v3 cluster: `nutrition`.

```
runner/src/v3/
├── packagers/nutrition.ts    # day intake + 7d/30d rolling + delta vs targets
├── prompts/nutrition.ts
└── schemas/nutrition.schema.json
```

`NutritionPackage`:
```ts
{
  period_key: string,
  today: {
    meals_count: number,
    totals: { kcal, protein_g, carbs_g, fat_g, fiber_g, ...micros },
    by_meal: Array<{
      meal_at, kind, totals, components_summary,
      photo_ref: string | null,      // path for multi-image prompt
      user_text: string | null
    }>,
    delta_vs_target: { protein_g: +12, iron_mg: -3.2, ... }
  },
  rolling: {
    last_7d: { avg_totals, gaps: ["iron_mg", "vit_b12_ug"] },
    last_30d: { ... }
  },
  context: {
    training_load_today: "high|moderate|low",   // from activity package
    weight_kg: number | null
  }
}
```

### Day-level multi-image aggregation

Per-meal classification stays single-photo. The day-level packager builds
a **second VLM call** that takes *all* the day's photos in chronological
order (qwen3.6 supports multi-image input) plus the structured per-meal
totals. The model intrinsically recognises patterns:

- "3 photos within 2h" → multi-course meal (one social/restaurant event,
  not 3 isolated snacks).
- "snacking 14:00–16:00" → grazing rather than discrete meals.
- "no photo logged after 19:00 + late HR elevation" → likely unlogged
  late meal (flag to user, do not invent kcal).

Output is a `day_pattern` block on the package, consumed by synthesis:

```ts
day_pattern: {
  events: Array<{
    kind: "single_meal" | "multi_course" | "snacking" | "drink_round",
    started_at: string, ended_at: string, meal_ids: string[],
    summary: string                                // de prose, 1–2 lines
  }>,
  flags: string[]                                  // e.g. "possible_unlogged_evening"
}
```

Week-level: aggregated stats only. No photos in the weekly prompt (cost +
context size). Patterns from day-level events are summarised into the
weekly cluster as structured counts ("4 multi-course events this week").

Synthesis (`v3/prompts/synthesis.ts`) gets nutrition cluster alongside
recovery/sleep/activity/training. Synthesis prompt explicitly says:
- Flag *patterns*, not single days.
- Never give clinical advice; phrase as "consider", not "you need".
- Tie deficits to user state (e.g. protein gap *only on heavy training days*).

## 7. UI

Routes under `app/(app)/nutrition/`:

| Route | Purpose |
|-------|---------|
| `/nutrition` | Today's intake card, this week strip, recent meals grid, "log meal" CTA. |
| `/nutrition/[date]` | Day view: timeline of meals, totals vs target, micronutrient mini-bars. |
| `/nutrition/meal/[id]` | Single meal: photo, components (editable), nutrition table, revision history. |
| `/nutrition/trends` | Macros stacked bars (14/30/90d), micronutrient heatmap, time-of-day scatter. |
| `/nutrition/targets` | Per-nutrient targets, units, "use defaults" reset. |
| `/nutrition/log` | Photo capture / text quick-add modal. PWA-first. |

Shared components under `components/nutrition/`:
- `MealCaptureSheet` — PWA camera input + drag-drop, with optimistic state.
- `MealCard` — small photo + summary for grids.
- `MealReviewForm` — edit components (add/remove/adjust grams), live-recomputes nutrition.
- `MacroStack`, `MicroHeatmap`, `IntakeRing` — visual primitives.
- `NutrientTargetEditor`.

Integration into existing dashboard:
- Home (`app/(app)/(home)/page.tsx`): intake ring (kcal + protein) + last
  meal photo, behind a feature flag during rollout.
- Day view (`app/(app)/day/[date]/page.tsx`): aggregate-only block at the
  **bottom** of the page. Renders:
  - macro totals + delta-vs-target chips,
  - 1–2 line day_pattern prose from the v3 nutrition cluster,
  - link to `/nutrition/[date]` for full breakdown.
  Smart-hide rules:
    1. day_end has fired (day is complete) AND
    2. at least one meal logged for the day.
  Otherwise the block is omitted entirely (no empty state, no "log a
  meal" CTA — that lives on `/nutrition`).
- Coach (`app/(app)/coach/`): synthesis prose already inherits the
  nutrition cluster; add a "nutrition" section if the synthesis emits one.

Image handling: photos served via `/api/nutrition/photo/[id]` (Pi reads
`$PULSE_ROOT/meals/photos/...`). Apply `Cache-Control: private, max-age=...`.

## 8. Editing & Corrections

The whole feature lives or dies on edit ergonomics. Rules:
- Every classification is **shown as a draft** until the user opens the
  meal once. Status `classified` (not `confirmed`). No auto-trust.
- Editing components rewrites `meal_component` rows but appends a
  `meal_revision` row for diff history.
- Re-classify is explicit ("redo with VLM"); never auto-redo.
- Confidence < 0.5 components shown with amber chip.
- Removing a component is one tap; adding via fuzzy-search over
  `food-db/seed.json` + cache.

## 9. Targets

`$PULSE_ROOT/meals/targets.json`:

```json
{
  "macros": {
    "kcal":      { "target": null, "auto_from": "active_kcal + bmr * 1.2" },
    "protein_g": { "target_per_kg": 1.6 },
    "fat_g":     { "min_pct_kcal": 20 },
    "carbs_g":   { "target": null },
    "fiber_g":   { "target": 30 }
  },
  "micros": {
    "iron_mg":    { "target": 10 },
    "vit_b12_ug": { "target": 4 },
    ...
  }
}
```

Defaults shipped with sensible RDA-ish values; user can override per row.
Coach reads `target` if set, otherwise the `auto_from` formula. Generic
system: no hardcoded "you should X" — only deltas vs declared targets.

## 10. Build Order

Each step ends in a deployable, testable slice.

1. **Storage + ingest** — pulse.db migration, `/api/nutrition/upload`,
   `/api/ingest/meal`, `output.ts` writer paths. Manual end-to-end with a
   curl-uploaded photo, no VLM yet (`status='pending'` stays).

2. **VLM classify stage** — `nutrition/stages/classify-vlm.ts` +
   `prompts/classify.ts` + schema. Watcher fires on inbox add. Result
   written to a dummy nutrition snapshot. Verify with 10 known meal photos.

3. **Nutrition enrichment** — seed `food-db/seed.json` with ~300 foods,
   `lookup.ts`, LLM fallback + cache. Recompute totals on edits.

4. **Day view** — `/nutrition/[date]` rendering from `records/*.json` and
   pulse.db. No editing yet, read-only.

5. **Meal detail + editing** — `/nutrition/meal/[id]`, review form,
   revisions table.

6. **PWA capture flow** — `MealCaptureSheet` with `<input
   capture="environment">` and offline queue.

7. **Index + home tile** — `/nutrition` index, optional home tile behind
   flag.

8. **Trends** — `/nutrition/trends`, macros bars, micros heatmap.

9. **Targets editor** — `/nutrition/targets`.

10. **v3 nutrition cluster (per-day stats)** — packager + prompt + schema;
    macros/micros aggregation, delta vs targets. Wire into synthesis.

11. **Day-level multi-image aggregator** — second VLM pass with all
    day's photos chronologically; emits `day_pattern.events` + `flags`.
    Surface on `/day/[date]` bottom block (smart-hide gated on
    day_end + meals_count > 0).

12. **Coach surfacing** — synthesis emits nutrition section; render in
    `/coach`.

13. **Optional text supplement everywhere** — ensure `user_text` is
    surfaced in capture UI alongside photo (not only in text-only path),
    fed into Stage A prompt as a strong hint.

Each step writes its own tests in `runner/test/` for runner-side code and
manual Playwright screenshots for UI slices.

## 11. Verification

Per-slice checks:
- Start `npm run dev` from root.
- For each new route, take Playwright screenshots in light + dark mode at
  ≥3 widths (mobile 390, tablet 768, desktop 1280).
- Test golden path (upload → classify → review) and edge cases (no
  components detected, all low-confidence, edit then re-open).
- Spot-check on real meal photos: rough kcal ±25%, protein ±20% on
  recognisable foods is the acceptance bar for v1.

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Portion estimation off by 2× | Default to typical serving; require user review before "confirmed"; weight override field. |
| Micronutrient hallucinations | Static seed DB for common foods; cache LLM results so they don't drift each call; show "(est.)" tag on LLM-sourced values. |
| Photo privacy | Photos stay on Mac/Pi (local Syncthing); no upload to third parties. Add explicit per-meal "delete photo" action. |
| qwen3.6 latency 10–30s | Async UX; meal saved immediately as `pending`; UI polls or WS. |
| Edits lose user trust if model overwrites them | Edits are immutable in `meal_component`; re-classify is opt-in; revisions track diffs. |
| Coach over-prescribes diet advice | Synthesis prompt restricts to broad trends, "consider" language, never clinical. |
| Targets fit only the user's case | Targets are user-configurable per nutrient; defaults are generic RDA, formulas reference user state (weight, training). |

## 13. Resolved Decisions

- **Image format**: keep what the user uploads (JPEG/PNG/WebP/HEIC).
  qwen3.6 vision handles them. Store original extension + mime; only
  resize if long-edge >2048px (sanity cap), never transcode for storage.
- **Cache invalidation** for `food-db/cache.json`: manual only, from
  `/nutrition/targets` debug panel.
- **Day-page integration**: aggregate-only block at the bottom of
  `/day/[date]`. Smart-hide when day not complete or zero meals.
- **Multi-photo / multi-course meals**: one photo = one meal record.
  Course meals naturally surface as multiple meal records in a 2h window.
  Day-level VLM aggregator (multi-image qwen3.6 call) intrinsically
  groups them via the `day_pattern.events` block. Week-level uses
  aggregated counts only, no photos.
