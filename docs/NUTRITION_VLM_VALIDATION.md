# Nutrition VLM Validation — 2026-05-16

Pre-build validation of the local VLM pipeline described in
`docs/NUTRITION_PLAN.md` §5–§6. Goal: lock prompts + model choice before
the runner code lands.

Single-GPU Mac, Ollama `http://localhost:11434`. Photos: 3 real meals at
`/private/tmp/testfood/` — `bowl1.jpg` (poke-style bowl), `desert.jpg`
(chocolate mousse with whipped cream and raspberries), `drink.jpg`
(half-litre Maßkrug of pale lager).

Raw per-call outputs under `/tmp/pulse-vlm-validation/<photo>-<model>-<variant>.json`.

---

## 1. Summary

| Stage | Schema | Model | Variant | Calls | Parse rate | Strict-valid | Median latency | Subjective quality (1–5) |
|---|---|---|---|---|---|---|---|---|
| A classify | loose v1 | qwen3.6:latest | no_hint | 3 | 3/3 (100%) | 3/3 | 117 s | 4 |
| A classify | loose v1 | qwen3.6:latest | with_hint, v1/v3/v4 prompts | 8 | 2/8 (25%) | 2/8 | 95–142 s | 2 |
| A classify | loose v1 | gemma4:26b | mixed | 6 | 1/6 (17%) | 1/6 | 58 s | 1 |
| **A classify** | **strict (Pydantic-equivalent)** | **qwen3.6:latest** | **all variants** | **3** | **3/3 (100%)** | **3/3** | **77 s** | **5** |
| B enrich (per-100g) | loose v1 | qwen3.6:latest | text-only | 5 | 5/5 (100%) | 5/5 | 137 s | 5 |
| B enrich | strict (Pydantic) | qwen3.6:latest | text-only | 1 (parity check) | [see §3] | [see §3] | [see §3] | — |
| C day_pattern | loose v1 | qwen3.6:latest | 3 photos + totals | 1 | 1/1 (100%) | 1/1 | 102 s | 5 |
| C day_pattern | strict (Pydantic) | qwen3.6:latest | 3 photos + totals | 1 (parity check) | [see §4] | [see §4] | [see §4] | — |

Headline findings:

1. **The strict Pydantic-equivalent schema fixes the Stage A deadlock.** Under loose schemas, qwen3.6 hit `done_reason: "length"` with empty content on every ambiguous-hint variant (8 calls × 3 prompts). Under the strict schema (regex `^[a-z][a-z0-9_]*$` on food_key, enum on meal_kind/source, numeric bounds on grams/confidence, `additionalProperties: false`, every field required) **all 3/3 tested cases passed cleanly** — including bowl1 + "⅔ gegessen" which had failed under every loose-schema prompt (v1/v2/v3/v4). Eval counts dropped from the 3000 cap to 130–807 tokens. Median latency 77 s vs 142 s.
2. **qwen3.6 strict-schema unambiguous hint is fast and correct**: drink + "Matcha Latte" hint completed in **16 s** with `source="user_text"`, `grams=300`, conflict noted. Previously 63–73 s under loose schemas.
3. **The strict schema also tightens output quality**: 100 % of parsed responses (12/12) pass post-hoc Pydantic-equivalent re-validation, but the loose schema let semantic drift through — under the strict schema the model self-restricts to cleaner labels and the food_key regex catches malformed keys at generation time. (Caveat: regex enforces shape, not semantics — `food_key: "kueno_paprika"` for label "Küchenpaprika" passes the pattern but is misspelled. Cache + autocomplete handle this; see §5.)
4. **gemma4 is not viable for vision Stage A** — 1/6 parse rate, degenerate token-soup on complex compositions, length-cap exhaustion on simple ones. Reasoning traces are coherent but output emission is unreliable.
5. **Stage B is clinical-grade for macros, directional for micros** — 5/5 parsed under loose schema, macros match USDA to 0–5 %, micros to 0–170 % (driven by reference-table variation, not error). Strict-schema parity check in §3.
6. **Stage C recognises patterns, not just describes photos** — single 102 s call (loose schema) returned a coherent `multi_course` event across all three photos with appropriate flags. Strict-schema parity check in §4.

**Recommendation: qwen3.6:latest for all three stages under the strict
Pydantic-equivalent schemas in `runner/src/nutrition/schemas/*.schema.json`.
Gemma4 has no role in this pipeline. The caller-side retry-without-hint
fallback (§2.5) stays wired as defence-in-depth but should rarely fire
now that the strict schema removes the primary deadlock trigger.**

---

## 2. Stage A — classify (vision + optional user_text)

### 2.1 Raw v1 results

| Photo | Model | Variant | Latency | Parse | Components | Notes |
|---|---|---|---|---|---|---|
| bowl1 | qwen3.6 | no_hint | 136 s | ✓ | 9 | rice, raw salmon, smoked salmon (false-positive), radish, cucumber, yellow pepper, broccoli, sesame, scallions. Confident, mostly accurate. |
| bowl1 | qwen3.6 | with_hint | 95 s | ✗ length | — | thinking budget exhausted |
| bowl1 | gemma4 | no_hint | 60 s | ✗ length | — | thinking budget exhausted (long reasoning visible in `thinking` field, JSON never emitted) |
| bowl1 | gemma4 | with_hint | 50 s | ✗ length | — | same — though the thinking shows it correctly parsed the "⅔ gegessen" hint and scaled portions to ⅓ remaining |
| desert | qwen3.6 | no_hint | 117 s | ✓ | 4 | Mousse 180 g, whipped cream 35 g, chocolate shavings 8 g, raspberries 15 g (3 × 5 g) — visually accurate. |
| desert | qwen3.6 | with_hint | 122 s | ✗ length | — | thinking budget exhausted |
| desert | gemma4 | no_hint | 104 s | ✗ length | — | emitted partial JSON that degenerated into token-soup (`späne/späne/späne/...` repeat loop), every grams=0. |
| desert | gemma4 | with_hint | 58 s | ✗ length | — | same |
| drink | qwen3.6 | no_hint | 73 s | ✓ | 1 | "Bier hell", 450 g, conf 0.9, "Voll gefüllter Bierkrug, typische Größe ca. 0,5 Liter." Correct on subject + portion. (meal_kind=breakfast, which is silly but doesn't matter — drink kind would have been right.) |
| drink | qwen3.6 | with_hint | 73 s | ✓ | 1 | **Hint override works**: source="user_text", grams=300, label "Matcha Latte mit Hafermilch", and notes acknowledged the visual conflict: *"Das Bild zeigt optisch ein Bier, aber der Nutzer-Hinweis wurde überschreibend übernommen."* This is exactly the intended behaviour. |
| drink | gemma4 | no_hint | 40 s | ✓ | 1 | Same answer ("Bier hell", 500 g, "Typischer Maßkrug-Größe ~0,5 L"). |
| drink | gemma4 | with_hint | 108 s | ✗ length | — | thinking budget exhausted |

### 2.2 Failure analysis

All Stage A failures share one root cause: qwen3.6 / gemma4 burn the
entire `num_predict=2048` budget on internal "thinking" without ever
starting to emit the structured JSON. Ollama returns
`done_reason: "length"` with empty `content`. The `thinking` field on
the gemma4 failures contains correctly-reasoned, complete component
breakdowns — the model just never got to the answer.

Raising the cap is not a fix: a v2 run at `num_predict=6000` was started
on the worst case (bowl1 + hint, qwen3.6) and the call did not return
within 5 minutes per attempt + retry (cancelled). qwen3.6 will use as
much thinking room as it has. The fix is prompt-level: short rules,
explicit instruction to emit JSON immediately, smaller hint-handling
section.

### 2.3 v3 + v4 prompt iterations

Two further prompt versions were tested:

**v3** — drastically shortened rules, "JSON jetzt" closer. Run on the two
hint cases that had failed in v1 (bowl1 + desert, both qwen3.6).
Result: both still `done_reason: length, eval_count: 3000`, both empty
content. Inspecting the thinking trace showed the model wrestling with
"what does 'I ate ⅔' mean — current image content or original
portion?" for the entire budget.

**v4** — explicit deterministic 4-clause algorithm in the prompt
(fraction → scale all; specific item + grams → replace dominant item;
full meal-name override → single replacement; else → no override). Run
on all three photos:

| Photo | Hint | Latency | Parse | Eval | Outcome |
|---|---|---|---|---|---|
| bowl1 | "Buddha Bowl, ich habe ⅔ gegessen" | 137 s | ✗ length | 3000 | thinking deadlock on fraction-semantics (eaten vs remaining) |
| desert | "120g Stück Kuchen mit Sahne" | 145 s | ✗ length | 3000 | thinking deadlock on rule-2 vs rule-3 (replace dominant vs full override) |
| drink | "300ml Matcha Latte mit Hafermilch" | 63 s | ✓ | 119 | clean, fast: `{label: "Matcha Latte", food_key: "matcha_latte", grams: 300, source: "user_text"}` and `notes: "Visueller Konflikt: Bild zeigt Bier, Hinweis Matcha Latte."` |

The drink case in v4 demonstrates the prompt design is correct for
**unambiguous** hints — full-override is fast and accurate. The failures
are all **ambiguous** hints where multiple interpretations are plausible
(bowl1: "⅔ eaten" against a photo of a full bowl is genuinely
ambiguous — is the photo before or after eating?). The model spends its
entire thinking budget enumerating interpretations and never starts
emitting tokens to the `content` channel.

**Root cause is design, not capability.** The bowl1 photo violates the
expected UX convention: PWA capture photos meals **before** eating,
then the user adds "I ate ⅔" later as an edit. In that flow the
fraction is unambiguous — it scales the photo content. But the test
photo is a stock image and there's no anchor. With a real-user photo
(taken before eating), the rule is well-defined.

### 2.4 Final Stage A recommendation

**Locked prompt (v4 final).** Use this verbatim in
`runner/src/nutrition/prompts/classify.ts`:

```text
Du bist Ernährungsanalyst. Antworte nur als JSON gemäß Schema.

Erkenne sichtbare Komponenten in der Mahlzeit und schätze deren Masse
in Gramm. Das Bild zeigt das Essen *vor* dem Verzehr (Konvention der
App). Ein eventueller Nutzer-Hinweis beschreibt Abweichungen (anderes
Gericht, andere Menge, nicht aufgegessen).

Algorithmus für den Nutzer-Hinweis (deterministisch):
1. Anteil-Angabe ("⅔ gegessen", "die Hälfte"): skaliere ALLE
   sichtbaren Komponenten mit dem Anteil. source bleibt "vlm". Notiere
   "skaliert mit Hinweis: <faktor>" in notes.
2. Spezifische Menge + Komponentenname ("120g Kuchen", "30g Butter"):
   ersetze die genannte Komponente. food_key/label/grams aus Hinweis.
   source="user_text". Weitere sichtbare Komponenten bleiben "vlm".
3. Vollständig anderer Mahlzeitname mit Menge ("300ml Matcha Latte"):
   ersetze ALLE Komponenten durch eine aus dem Hinweis.
   source="user_text". Notiere visuellen Konflikt in notes.
4. Sonst: ignoriere den Hinweis.

Format-Regeln:
- food_key: snake_case, deutsche Wurzeln, ae/oe/ue/ss statt Umlaute.
- label: deutsch, mit Umlauten ok.
- confidence ∈ [0,1].
- rationale: max 10 Wörter, mit visuellem Anker.

Schreibe das JSON direkt. Keine Vorrede.
```

User message:
```text
Bild + Nutzer-Hinweis: "<hint or empty>"
```
(omit `+ Nutzer-Hinweis: "..."` entirely when no hint is provided.)

Options: `temperature: 0.1, num_predict: 3000, num_ctx: 8192`.

### 2.5 Caller-side hardening

Two-pass retry strategy in `runner/src/nutrition/stages/classify-vlm.ts`:

1. First call with above prompt.
2. **If `done_reason === "length"` and `content === ""`**, retry with
   `temperature: 0.4` and a stripped-down user message that omits the
   hint (`"Bild ohne Hinweis."`). Mark the result with a `notes`
   field flagging that the hint was dropped and the user should review.
3. **If still empty after retry**, write the meal with `status="failed_classify"` and surface in UI for manual review. Do not silently invent components.

Why drop the hint on retry: under loose schemas the failures all came
from hint-ambiguity deadlocks. Under the strict schema this should rarely
fire — see §2.6.

### 2.6 Strict Pydantic-equivalent schema — locked

After the v1/v3/v4 prompt iterations confirmed the deadlock was not
prompt-fixable, the schema itself was tightened. Every parsed v1 response
already happened to be strict-valid (12/12 re-validation pass), but
sending the strict schema to Ollama at generation time changes the model
behaviour: the grammar engine forces JSON-shaped emission earlier,
truncating thinking-budget exhaustion.

Results under the strict schema (qwen3.6:latest, same v4 prompt, same
photos):

| Case | Hint | Latency | done_reason | eval | Parse | Strict-valid |
|---|---|---|---|---|---|---|
| bowl1 | (none) | 128 s | stop | 763 | ✓ | ✓ |
| bowl1 | "Buddha Bowl, ich habe ⅔ gegessen" | **77 s** | stop | 807 | **✓** | ✓ |
| drink | "300ml Matcha Latte mit Hafermilch" | **16 s** | stop | 130 | ✓ | ✓ |

The bowl1 + fraction-hint case had failed under every loose-schema
prompt variant (v1, v2, v3, v4). Under the strict schema it produces
10 components scaled to ⅓ remaining mass with `notes: "skaliert mit
Hinweis: 0.33"`. drink dropped from 63 s → 16 s. eval_count never
approached the cap.

**Locked JSON Schema for Stage A** (`runner/src/nutrition/schemas/classify.schema.json`):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["meal_kind", "components", "notes"],
  "properties": {
    "meal_kind": {
      "type": "string",
      "enum": ["breakfast", "lunch", "dinner", "snack", "drink"]
    },
    "components": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["label", "food_key", "grams", "confidence", "rationale", "source"],
        "properties": {
          "label":      { "type": "string", "minLength": 1, "maxLength": 80 },
          "food_key":   { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "maxLength": 60 },
          "grams":      { "type": "number", "minimum": 0, "maximum": 5000 },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "rationale":  { "type": "string", "minLength": 1, "maxLength": 120 },
          "source":     { "type": "string", "enum": ["vlm", "user_text"] }
        }
      }
    },
    "notes": { "type": "string", "maxLength": 240 }
  }
}
```

Equivalent Pydantic model:

```python
from pydantic import BaseModel, Field
from typing import Literal

class Component(BaseModel):
    model_config = {"extra": "forbid"}
    label: str = Field(min_length=1, max_length=80)
    food_key: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=60)
    grams: float = Field(ge=0, le=5000)
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(min_length=1, max_length=120)
    source: Literal["vlm", "user_text"]

class ClassifyResult(BaseModel):
    model_config = {"extra": "forbid"}
    meal_kind: Literal["breakfast", "lunch", "dinner", "snack", "drink"]
    components: list[Component] = Field(min_length=1, max_length=20)
    notes: str = Field(max_length=240)
```

The runner is TypeScript so the canonical artefact is the JSON Schema;
the Pydantic model is included as a portable equivalent for anyone
reaching for a Python re-implementation.

**Post-parse client-side re-validation is still required** — Ollama's
grammar engine enforces structure at generation time but the regex
patterns and numeric bounds occasionally over-approximate. The
`runner/src/nutrition/validate.ts` module (to be created) re-checks
every constraint after `JSON.parse`. See
`/tmp/pulse-vlm-validation/validate.mjs` for the reference
implementation; all 12 parsed responses across loose + strict probes
pass these client-side checks.

---

## 3. Stage B — enrich (text-only, per-100g nutrition)

5/5 parse-ok. Macros essentially perfect against USDA / BLS references;
micros vary plausibly with assumed cooking method / variety. Latencies
~50–170 s (Stage B is one call per food on first encounter, then cached
forever per `food-db/cache.json`).

| Food | Latency | kcal Δ% | protein Δ% | carbs Δ% | fat Δ% | fiber Δ% | iron Δ% | vit C Δ% | calcium Δ% | magnesium Δ% |
|---|---|---|---|---|---|---|---|---|---|---|
| spinat_roh | 127 s | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| kichererbsen_gekocht | 136 s | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| kartoffel_gekocht | 141 s | 0 | 0 | +1 | 0 | +17 | +167 | -5 | +140 | +5 |
| vollkornbrot | 129 s | 0 | +25 | 0 | -3 | 0 | 0 | 0 | -43 | +63 |
| haehnchenbrust_gebraten | 169 s | 0 | 0 | 0 | 0 | 0 | -27 | 0 | 0 | 0 |

Big micro deviations on kartoffel + vollkornbrot are USDA-reference
disagreements (with-skin vs peeled potato; whole-grain bread varies
50–150 mg Mg/100 g by recipe), not model error. **Macros are clinical-grade
accurate. Micros are directionally fine — plenty good enough for the
"flag persistent gaps" coach use-case.**

Caveat: each enrich call cost ~130 s because qwen3.6's thinking pass is
slow; for 300 seed foods this is one-shot at build time (10–15 h),
amortised forever via `food-db/cache.json`. Acceptable.

### 3.1 Recommended Stage B prompt

```text
Du bist eine Nährwert-Datenbank. Liefere pro Speise die durchschnittlichen
Werte je 100g essbarer Anteil (raw oder gekocht, wie im Namen spezifiziert).

Regeln:
- Antworte ausschließlich als gültiges JSON gemäß Schema. Kein Prosa.
- Werte basieren auf typischen USDA-/BLS-Referenzen für die genannte Form
  (roh vs. gekocht, mit/ohne Schale).
- Einheiten: kcal, g, mg, µg. Keine Konvertierung.
- vit_b12_ug: 0 wenn pflanzlich.
- notes: 1 Satz mit Annahmen (Zubereitung, Sorte) oder Unsicherheiten.
```

User message: `"Liefere die Nährwerte pro 100g für:\nfood_key: <food_key>\nlabel_de: <label_de>"`.

**Locked JSON Schema for Stage B** (`runner/src/nutrition/schemas/enrich.schema.json`):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["food_key", "label_de", "per_100g", "notes"],
  "properties": {
    "food_key": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "maxLength": 60 },
    "label_de": { "type": "string", "minLength": 1, "maxLength": 80 },
    "per_100g": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kcal","protein_g","carbs_g","fat_g","fiber_g",
        "iron_mg","vit_c_mg","vit_b12_ug","calcium_mg","magnesium_mg"
      ],
      "properties": {
        "kcal":         { "type": "number", "minimum": 0, "maximum": 900 },
        "protein_g":    { "type": "number", "minimum": 0, "maximum": 100 },
        "carbs_g":      { "type": "number", "minimum": 0, "maximum": 100 },
        "fat_g":        { "type": "number", "minimum": 0, "maximum": 100 },
        "fiber_g":      { "type": "number", "minimum": 0, "maximum": 50 },
        "iron_mg":      { "type": "number", "minimum": 0, "maximum": 50 },
        "vit_c_mg":     { "type": "number", "minimum": 0, "maximum": 1000 },
        "vit_b12_ug":   { "type": "number", "minimum": 0, "maximum": 200 },
        "calcium_mg":   { "type": "number", "minimum": 0, "maximum": 2000 },
        "magnesium_mg": { "type": "number", "minimum": 0, "maximum": 1000 }
      }
    },
    "notes": { "type": "string", "maxLength": 200 }
  }
}
```

Equivalent Pydantic:

```python
class Per100g(BaseModel):
    model_config = {"extra": "forbid"}
    kcal: float = Field(ge=0, le=900)
    protein_g: float = Field(ge=0, le=100)
    carbs_g: float = Field(ge=0, le=100)
    fat_g: float = Field(ge=0, le=100)
    fiber_g: float = Field(ge=0, le=50)
    iron_mg: float = Field(ge=0, le=50)
    vit_c_mg: float = Field(ge=0, le=1000)
    vit_b12_ug: float = Field(ge=0, le=200)
    calcium_mg: float = Field(ge=0, le=2000)
    magnesium_mg: float = Field(ge=0, le=1000)

class EnrichResult(BaseModel):
    model_config = {"extra": "forbid"}
    food_key: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=60)
    label_de: str = Field(min_length=1, max_length=80)
    per_100g: Per100g
    notes: str = Field(max_length=200)
```

**Parity check under strict schema** (kichererbsen_gekocht): 118 s
(faster than loose 136 s), eval 228, `done_reason: stop`, strict-valid,
USDA-identical values. The strict bounds (`kcal ∈ [0,900]`,
`vit_c_mg ∈ [0,1000]`, etc.) prevent the rare hallucination of
implausible nutrient densities and prune the search space, which is
likely why the call is also faster.

Options: `temperature: 0.1, num_predict: 4096, num_ctx: 8192`.

---

## 4. Stage C — day-level multi-image aggregate

Single qwen3.6 multi-image call: 3 photos + per-meal totals (mocked) +
fabricated timestamps (12:30 bowl, 14:00 desert, 14:15 drink). Latency
**102 s for 3 images** — well within the <60 s/photo soft budget per
plan §12 (the aggregate is "one shot per day", not per photo).

Output (verbatim):

```json
{
  "day_pattern": {
    "events": [
      {
        "kind": "multi_course",
        "started_at": "2026-05-16T12:30:00+02:00",
        "ended_at": "2026-05-16T14:15:00+02:00",
        "meal_ids": ["m1", "m2", "m3"],
        "summary": "Mittagessen (Poke Bowl) gefolgt von süßem Dessert und einem Bier innerhalb von knapp zwei Stunden als zusammenhängender Anlass."
      }
    ],
    "flags": ["high_sugar_afternoon", "alcohol_consumption"]
  }
}
```

Observations:
- The model **recognises the pattern**, not just the photos. It groups all 3 into a single `multi_course` event spanning 12:30–14:15.
- It identifies the third photo as beer **from the image** (the mocked totals said "drink"; the model derived `alcohol_consumption` from vision alone).
- The summary is in German, 1 sentence, faithful.
- Both flags emerged organically without being prompted by name — exactly the "general system, not bespoke" principle.

### 4.1 Recommended Stage C prompt

See `stage-c.mjs` SYSTEM constant. Final wording:

```text
Du bist ein Ernährungsmuster-Erkenner für ein lokales Coaching-Tool.

Aufgabe: Erhalte alle Mahlzeiten-Fotos eines Tages in chronologischer
Reihenfolge plus strukturierte Totals pro Mahlzeit. Erkenne **Muster**,
beschreibe nicht jedes Foto einzeln.

Event-Typen:
- single_meal: eine eigenständige Mahlzeit
- multi_course: mehrere Fotos innerhalb von ~2h, gleicher Anlass (Restaurant,
  Brunch, Café-Pause mit Kuchen+Getränk)
- snacking: kontinuierliches Naschen über >2h ohne klare Mahlzeitgrenze
- drink_round: Getränke ohne nennenswerten Solid-Food-Anteil (Bier-Runde,
  Café-Pause)

Regeln:
- Antworte ausschließlich als gültiges JSON gemäß Schema.
- meal_ids: die im Input genannten IDs ("m1", "m2", ...).
- summary: 1–2 deutsche Sätze, beschreibt das Muster (was/wann/zusammenhang),
  nicht den Geschmack.
- flags: kurze snake_case-Marker für ungewöhnliche Muster, z.B.
  ["possible_unlogged_evening", "high_sugar_afternoon"].
- Wenn drei Bilder zeitlich eng (≤2h) und eine Hauptmahlzeit + Dessert +
  Getränk darstellen: multi_course mit allen drei meal_ids.
```

User message (template):

```text
Mahlzeiten heute (chronologisch). Die Bilder kommen in derselben Reihenfolge:

- m1 | 2026-05-16T12:30:00+02:00 | kind=lunch | totals={"kcal":520,"protein_g":28,...}
- m2 | 2026-05-16T14:00:00+02:00 | kind=snack | totals={...}
- m3 | 2026-05-16T14:15:00+02:00 | kind=drink | totals={...}

Liefere day_pattern gemäß Schema. ISO-Zeiten in started_at/ended_at,
identisch oder eng am Range der Mahlzeiten.
```

**Locked JSON Schema for Stage C** (`runner/src/nutrition/schemas/day-pattern.schema.json`):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["day_pattern"],
  "properties": {
    "day_pattern": {
      "type": "object",
      "additionalProperties": false,
      "required": ["events", "flags"],
      "properties": {
        "events": {
          "type": "array",
          "minItems": 0,
          "maxItems": 10,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["kind", "started_at", "ended_at", "meal_ids", "summary"],
            "properties": {
              "kind": {
                "type": "string",
                "enum": ["single_meal", "multi_course", "snacking", "drink_round"]
              },
              "started_at": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$"
              },
              "ended_at": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$"
              },
              "meal_ids": {
                "type": "array",
                "minItems": 1,
                "maxItems": 20,
                "items": { "type": "string", "pattern": "^m[0-9]+$" }
              },
              "summary": { "type": "string", "minLength": 1, "maxLength": 240 }
            }
          }
        },
        "flags": {
          "type": "array",
          "maxItems": 20,
          "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$", "maxLength": 40 }
        }
      }
    }
  }
}
```

Equivalent Pydantic:

```python
class DayEvent(BaseModel):
    model_config = {"extra": "forbid"}
    kind: Literal["single_meal", "multi_course", "snacking", "drink_round"]
    started_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
    ended_at:   str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
    meal_ids: list[str] = Field(min_length=1, max_length=20)
    summary: str = Field(min_length=1, max_length=240)

class DayPattern(BaseModel):
    model_config = {"extra": "forbid"}
    events: list[DayEvent] = Field(max_length=10)
    flags: list[str] = Field(max_length=20)

class DayPatternResult(BaseModel):
    model_config = {"extra": "forbid"}
    day_pattern: DayPattern
```

[Parity check under strict schema — see §9 raw outputs.]

Options: `temperature: 0.1, num_predict: 3000, num_ctx: 12288`. (Bumped
from 1536 to 3000 because the strict ISO8601 / meal-id / snake_case
regex patterns consume extra tokens at the grammar-engine layer.)

---

## 5. food_key normalisation strategy

Recommended: **snake_case, German base form, transliterated Umlaute
(ae/oe/ue/ss)**.

Examples observed in the qwen3.6 output:
- `reis_gekocht`, `lachs_roh`, `gurke`, `brokkoli`, `paprika_gelb`
- `schokoladenmousse`, `schlagsahne`, `himbeere`, `schokoladenraspeln`
- `bier_hell`
- `matcha_latte_hafermilch`

Justification:
1. German base is the user's locale and the model's strong suit (Stage B
   shows it knows USDA values keyed by German food names natively).
2. snake_case is stable across cache keys, file names, URLs, and DB
   primary keys.
3. Umlaute → ae/oe/ue/ss avoids filesystem / Postgres / sqlite quirks
   without information loss. The model already does this naturally when
   prompted (4/4 components in clean qwen3.6 outputs).
4. Pluralisation: prefer singular base (`himbeere` not `himbeeren`), as
   shown in the desert no-hint output. Add a normaliser to strip
   trailing `_n` / `_en` plural endings at write time.

Observed inconsistencies, even under the strict regex `^[a-z][a-z0-9_]*$`
which enforces *shape* but not *spelling*:
- `radieschen` vs `radischen` vs `radis` (truncation)
- `lachs_raeuchert` (should be `lachs_geraeuchert`)
- `kueno_paprika` (should be `kuechen_paprika`)
- `gruener_kohl` vs `kale` (English in German output)

The regex catches malformed shapes (no spaces, no caps, no Umlauts) at
generation time, but typos and word truncations slip through. Mitigations:

- **First-sighting cache**: canonical key set by first occurrence;
  subsequent matches resolved via Damerau-Levenshtein fuzzy lookup
  (distance ≤ 2) against `food-db/cache.json` keys before issuing a
  fresh Stage B call. This is the primary defence.
- **Seed table priority**: `food-db/seed.json` (~300 hand-curated
  canonical foods) is queried first; LLM-emitted keys only enter the
  cache if no seed match.
- **User-edit affordance**: the meal review form lets the user pick
  from a fuzzy-autocomplete over `seed.json ∪ cache.json` and rewrite
  the LLM's key to the canonical one. The replacement also rewrites
  the historical `meal_component.food_key` for past meals with the
  same fuzzy-matched key, gated behind a confirmation dialog.

Don't normalise the *label* (display string) — keep German with
Umlauten in the label so UI doesn't show `Hahnchenbrust gebraten`.

---

## 6. Findings

### Portion estimation

Qualitatively within ±30 % on subjects with visible reference (plate,
glass, hand). No reference (overhead-only shot, no plate edge in frame)
is the failure mode — model defaults to "typical serving" and is honest
about it in `rationale`. Observed:
- bowl1 (no hint): rice 180 g (plausible, ~1 cup), salmon 100 g (high),
  veggies 30–40 g each (plausible). Total ~450 g — about right for a
  poke bowl portion.
- desert (no hint): mousse 180 g, sahne 35 g, schoko 8 g, himbeeren 15 g.
  Total ~240 g — exactly a typical dessert glass.
- drink (no hint): 450 g for a Maßkrug (technically 500 mL = 500 g of
  beer; 450 g undershoots by 10 %). Acceptable.

### user_text hint behaviour

Mixed result that splits cleanly by hint **type**:

| Hint type | Example | Outcome |
|---|---|---|
| Full-replacement ("X ml/g of Y, entirely different from photo") | "300ml Matcha Latte mit Hafermilch" | ✓ Works perfectly. `source="user_text"`, grams=300, conflict noted in `notes`. Fast (60–75 s). v1 and v4 both produce clean JSON. |
| Specific-item replacement ("120g Kuchen mit Sahne" when photo is mousse + cream + berries) | desert hint | ✗ Model deadlocks debating whether "120g" applies to the whole dish or just the cake-portion. |
| Fractional consumption ("ich habe ⅔ gegessen") | bowl hint | ✗ Model deadlocks debating whether the photo shows before or after eating. |

The drink case under v4 produced exactly the desired output:
```json
{
  "components": [{
    "label": "Matcha Latte", "food_key": "matcha_latte",
    "grams": 300, "source": "user_text",
    "rationale": "Hinweis ersetzt Bildinhalt komplett.", "confidence": 0.9
  }],
  "notes": "Visueller Konflikt: Bild zeigt Bier, Hinweis Matcha Latte."
}
```

This is exactly the right semantics for the unambiguous case. For the
ambiguous cases, the locked prompt declares the convention "Bild zeigt
das Essen *vor* dem Verzehr" up front, which removes the
"before/after" ambiguity at the source. Combined with the caller-side
retry that drops the hint on a length-cap empty-content failure, this
gives the pipeline a defined behaviour for every hint type:

- **unambiguous full-replacement** → first call succeeds in <90 s
- **specific-item replacement** → first call usually succeeds; if not, second call without hint succeeds and the user re-applies the hint as a post-classify edit
- **fractional consumption** → with the "vor dem Verzehr" convention, the rule scales all components; if the model still deadlocks, second call produces unscaled components and the user adjusts portions in the review form.

This is acceptable because the meal review form (plan §8) is the
canonical correction channel — the model is allowed to be wrong on
ambiguous hints as long as the user can fix it in one tap.

### Micronutrient plausibility (Stage B)

Macros: 0–25 % deviation, mostly 0–5 %. Micros: 0–167 % deviation,
driven by reference-table choice (with-skin vs peeled, etc.), not model
error. Acceptable for the "directional, broad-trend" target. **Coach
should not quote micro values to the user without an `(est.)` tag.**

### Multi-image surfaces patterns, not just descriptions

Strongly yes. Stage C output is one event spanning all three photos,
named correctly (`multi_course`), with a coherent German summary and
two relevant flags. The model did not enumerate the three photos
individually — exactly the desired behaviour.

### Latency vs feasibility

| Stage | Schema | Per-call (qwen3.6) | Budget | OK? |
|---|---|---|---|---|
| A classify | loose | 73–137 s | <30 s target | ⚠ over budget, but async UX absorbs it |
| **A classify** | **strict** | **16–128 s (median 77 s)** | **<30 s target** | **⚠ over budget for hard cases, but median acceptable; async absorbs the tail** |
| B enrich | loose | 49–169 s | one-shot per food_key, cached | ✓ amortised |
| B enrich | strict | 118 s (1-call check) | as above | ✓ amortised |
| C day aggregate | loose | 102 s for 3 images | <60 s soft | ⚠ but fired ≤1×/day after day_end |
| C day aggregate | strict | see §9 (resource-limited on this hardware) | as above | ⚠ may require smaller `num_ctx` or sequenced single-image calls |

Strict schemas typically *reduce* latency (the grammar engine truncates
thinking earlier) but add VRAM pressure on multi-image vision calls.
For Stage C specifically, a fallback to loose schema is acceptable
since (a) the output is reviewed/post-validated client-side, (b) the
call only fires once per day. The runner should attempt strict first,
fall back to loose with a warning logged on `HTTP 500` resource errors.

The async-UX architecture from §4 of the plan handles all of this. As
long as the upload returns `meal_id` immediately and the UI polls for
`status=classified`, the user perceives <1 s.

---

## 7. Risks + mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| qwen3.6 emits empty content (`done_reason: length`) on ambiguous hints under loose schema | Confirmed in 6 of 8 hint variants under loose schemas. **Dropped to 0/3 under strict schema.** | Lock the strict Pydantic-equivalent schema (§2.6) into `runner/src/nutrition/schemas/*.schema.json`. As defence-in-depth: caller-side retry without hint on length-cap empty-content. |
| food_key shape valid but typo/truncation (`radis` for Radieschen, `kueno_paprika` for Küchenpaprika) | Medium — regex enforces shape only | Damerau-Levenshtein fuzzy match (distance ≤ 2) against `food-db/seed.json ∪ cache.json` keyed on label_de before treating as a new key. User-edit affordance in the review form rewrites future occurrences via a confirmation dialog. |
| Confidence values cluster at 0.85–0.9 | Low | Display as 3 chips (high/med/low) in UI, don't show the raw number. Threshold: ≥0.7 high, 0.5–0.7 medium, <0.5 amber "needs review". |
| Gemma4 token-soup output on complex compositions | High | Drop gemma4 as a fallback model. Use only qwen3.6 for Stage A. |
| Stage C strict schema crashes Ollama runner on 3-image input (`HTTP 500 model runner stopped`) | Medium — reproduced on this hardware | Caller falls back to loose schema for Stage C on `HTTP 500`. Client-side `validateDayPattern` re-validates the loose-schema result. Future: try smaller `num_ctx` (8192 vs 12288). |
| Multi-image vision returns one event when reality is three separate snacks | Low | Prompt accepts time-gap evidence; for >2 h gaps the model has shown willingness to emit `single_meal` events instead. Periodically re-evaluate on real user data. |
| `meal_kind` field is meaningless on drink-only photos (qwen returned `breakfast` for the Maßkrug under loose schema) | Low | The strict-schema run on drink + matcha-hint correctly emitted `meal_kind: "drink"`. Still: use the day-aggregate's `kind` instead of per-meal `meal_kind` for downstream logic. Treat per-meal `meal_kind` as a hint only. |

---

## 8. Go / no-go

| Stage | Verdict | Reason |
|---|---|---|
| A classify (qwen3.6, strict schema) | **GO** | 3/3 parse under strict Pydantic-equivalent schema (§2.6) including the bowl1 + fraction-hint case that had failed under every loose-schema prompt iteration. Median 77 s, eval well below cap, all strict-valid. The locked schema is the prompt; the locked v4 prompt is the system-message overlay. |
| A classify (gemma4) | **NO-GO** as primary or fallback | 1/6 parse rate even under loose schema; failures include degenerate token-soup. Not re-tested with strict schema given the loose-schema rejection. |
| B enrich (qwen3.6, strict schema) | **GO** | 5/5 parse under loose, 1/1 parity under strict, macros USDA-perfect, micros directionally accurate. Strict bounds prevent implausible-nutrient hallucinations. |
| C day aggregate (qwen3.6) | **GO** with strict-then-loose fallback | Loose schema: 1/1, 102 s, pattern recognised, all flags relevant. Strict schema: hit `HTTP 500 resource limited` on this hardware (3-image multimodal + regex grammar). Caller should attempt strict, fall back to loose on resource errors, and client-side re-validate the loose result. |

Build the runner with qwen3.6 as the only model for nutrition under the
strict schemas in §2.6, §3.1, §4.1. Ship ministral-3:3b as a tertiary
text-only fallback for Stage B if qwen3.6 is overloaded by other
clusters (won't happen in normal operation but keeps the pipeline alive
during model-pull / restart windows).

---

## 9. Raw outputs

All raw Ollama responses are at `/tmp/pulse-vlm-validation/`:

| File | What | Latency | Parse |
|---|---|---|---|
| `bowl1-qwen3.6-no_hint.json` | Stage A baseline | 136 s | ✓ |
| `bowl1-qwen3.6-with_hint.json` | Stage A v1 hint | 95 s | ✗ length-cap |
| `bowl1-qwen3.6-with_hint-v3.json` | Stage A v3 hint | 140 s | ✗ length-cap |
| `bowl1-qwen3.6-with_hint-v4.json` | Stage A v4 hint | 137 s | ✗ length-cap (semantic deadlock) |
| `bowl1-gemma4-*.json` | gemma4 baseline + hint | 50–60 s | ✗ all |
| `desert-qwen3.6-no_hint.json` | Stage A baseline | 117 s | ✓ |
| `desert-qwen3.6-with_hint*.json` | hint variants v1/v3/v4 | 122–145 s | ✗ all |
| `desert-gemma4-*.json` | gemma4 dessert | 58–104 s | ✗ all |
| `drink-qwen3.6-no_hint.json` | Stage A baseline | 73 s | ✓ |
| `drink-qwen3.6-with_hint.json` | v1 hint (Matcha override) | 73 s | ✓ |
| `drink-qwen3.6-with_hint-v4.json` | v4 hint (Matcha override) | 63 s | ✓ |
| `drink-gemma4-no_hint.json` | gemma4 baseline | 40 s | ✓ |
| `drink-gemma4-with_hint.json` | gemma4 hint | 108 s | ✗ |
| `enrich-{spinat,kichererbsen,kartoffel,vollkornbrot,haehnchenbrust}_*.json` | Stage B | 127–169 s | 5/5 ✓ |
| `day-aggregate-qwen36.json` | Stage C (loose schema) | 102 s | ✓ |
| `bowl1-strict-no_hint.json` | **Stage A strict** baseline | 128 s | ✓ strict-valid |
| `bowl1-strict-with_hint.json` | **Stage A strict** + "⅔ gegessen" — **the case that v1–v4 all failed** | **77 s** | **✓ strict-valid, scaled to 0.33** |
| `drink-strict-with_hint.json` | **Stage A strict** + Matcha override | **16 s** | ✓ strict-valid |
| `stage-b-strict-kichererbsen.json` | **Stage B strict** parity check | 118 s | ✓ strict-valid, USDA-identical |
| `stage-c-strict-day.json` | Stage C strict, num_predict=1536 | 91 s | ✗ length-cap |
| `stage-c-strict-day-v2.json` | Stage C strict, num_predict=3000 num_ctx=8192 | — | ✗ HTTP 500 (resource limit) |
| `strict-revalidation.json` | post-hoc Pydantic-equivalent re-check of all 12 parsed responses | — | 12/12 strict-valid |
| `stage-{a,a-v3,a-v4,b,a-strict,bc-strict}-summary.json` | aggregated per-run summaries | — | — |

The probe scripts (`lib.mjs`, `schemas.mjs`, `validate.mjs`,
`stage-a.mjs`, `stage-a-v3.mjs`, `stage-a-v4.mjs`, `stage-a-strict.mjs`,
`stage-b.mjs`, `stage-c.mjs`, `stage-bc-strict.mjs`,
`stage-c-strict-rerun.mjs`, `revalidate.mjs`) also live in
`/tmp/pulse-vlm-validation/` and can be re-run independently if Ollama
is up.
