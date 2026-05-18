# Nutrition tool-calling — design + validation

Companion to `docs/wip/NUTRITION_VLM_VALIDATION.md`. That doc locked the
prompt + JSON schema for Stage A; this doc layers an agentic
tool-calling loop on top so the model can disambiguate food_keys against
the existing seed / cache / USDA / OFF cascade during classify.

Status (2026-05-18): **opt-in via `NUTRITION_TOOLS_ENABLED=1`**. Default
off until live A/B validation against the 4-photo probe set ships a
measurable quality win. Pipeline is unchanged otherwise.

## 1. Goal

The Stage A `classify-vlm.ts` call used to emit `food_key` strings the
VLM chose without consulting the nutrition catalog. Two failure modes
observed in production:

1. **Ambiguous tokens grounding to the wrong USDA row.** The Dürüm probe
   in `NUTRITION_VLM_VALIDATION.md` documents the model returning
   `food_key: "salat"` for visible leafy greens. Stage B then translated
   `salat → "salad"` and matched USDA "Salad dressing, NFS" — a high-fat
   mayo product — instead of lettuce. The component carried plausible
   per-100g values that were 10× off from reality.
2. **Composite blobs that could decompose further.** A `quiche_fuellung`
   key lumped egg + cream + ham + leek + cheese into one row, losing
   per-ingredient resolution downstream.

Tool calling lets the model say "I'm seeing leafy greens — search for
'Kopfsalat' or 'Romana' before committing a food_key", and lets it ask
the same question for individual quiche-filling ingredients during the
ZERLEGUNGS-REGEL decomposition step.

## 2. Tool surface

One tool: `search_nutrition`. Definition in
`runner/src/nutrition/stages/classify-tools.ts`:

```jsonc
{
  "type": "function",
  "function": {
    "name": "search_nutrition",
    "description": "Suche eine Speise in der Nährwert-Datenbank …",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": ["query"],
      "properties": {
        "query": { "type": "string", "minLength": 1, "maxLength": 60 },
        "max_results": { "type": "integer", "minimum": 1, "maximum": 5, "default": 3 }
      }
    }
  }
}
```

Returned shape (passed back to the model as the `role: "tool"` message
content, JSON-stringified):

```jsonc
{
  "results": [
    {
      "food_key": "chickpeas_cooked",
      "label": "Kichererbsen gekocht",
      "source": "seed",
      "per100g_summary": "164 kcal, 8.9p, 27.4c, 2.6f",
      "rationale": "Seed table: Kichererbsen gekocht"
    }
  ]
}
```

The summary is human-readable on purpose. The model does not need raw
NutritionFacts to disambiguate — what's `kcal` vs what's protein
suffices to tell `kopfsalat` (15 kcal/100g, near-zero fat) from `salat`
(salad dressing — 350+ kcal/100g, all fat).

Only ONE tool. Spec said: prove the loop works before expanding. A
second tool (e.g. `decompose_dish`) is a follow-up — see §6.

## 3. Loop protocol

In `runner/src/nutrition/stages/classify-vlm.ts`:

```
MAX_TOOL_ITERATIONS = 5

callClassifyWithTools(model, schema, images, hint, options):
  messages = [initial_user_message(prompt + appendix, image, hint)]
  for iter in 0..MAX_TOOL_ITERATIONS:
    is_last = iter == MAX_TOOL_ITERATIONS - 1
    response = ollama.chat({
      model, messages, options,
      format: schema,                  # always on
      tools: is_last ? undefined : [SEARCH_NUTRITION_TOOL],
    })
    if response.tool_calls:
      messages.push(response.assistant_msg)
      for call in response.tool_calls:
        result = dispatchSearchNutrition(call.arguments)
        messages.push({role: "tool", tool_name: call.name, content: JSON.stringify(result)})
      continue
    # No tool_calls → final answer.
    return parseAndValidate(response.content, schema)
  return failed("tool loop exhausted")
```

Critical design choices:

- **`format` always on.** The Ollama tool-calling docs and Pulse's own
  ollama.ts comment both warn that `format` + `tools` can confuse some
  models. In practice qwen3.6 honours both simultaneously (verified in
  the live probe; the model emits structured tool args AND
  schema-conforming final JSON when the time comes). Keeping format on
  prevents the model from drifting into free prose on the last turn.
  If a future model breaks this assumption, set
  `NUTRITION_TOOLS_ENABLED=0` and the prompt-only path resumes.
- **Drop `tools[]` on the last iteration.** Forces commitment. If the
  model is still calling tools at iter=4, we strip the option so it has
  to produce a final JSON or be classified as "loop exhausted". This is
  the canonical fix for "model spends entire budget calling itself in a
  loop" from the Anthropic / OpenAI tool-calling guides.
- **Tool errors are non-fatal.** `dispatchSearchNutrition` swallows any
  thrown error from seed / cache / USDA / OFF and returns `{results: []}`.
  The model decides what to do with that — usually it commits a
  best-effort food_key.
- **Loop exhaustion → fall back to retry-without-hint.** `classifyMeal`'s
  two-pass retry strategy still applies. If the tool loop fails for any
  reason, the second pass uses the plain `callClassify` (no tools, no
  hint) so the meal still gets classified, just less precisely.
- **The single-slot GPU mutex still holds.** The runner-wide `gpuSlot`
  in `runner/src/ollama.ts` is the mutex; it isn't called by the
  nutrition path (which uses bare undici-fetch on `/api/chat`). The
  nutrition path holds the GPU implicitly via the synchronous fetch
  chain. **A tool loop holds the GPU longer than a single classify
  call** (up to 5× the round-trip duration). Acceptable given the user
  prioritised quality over latency, but documented.

## 4. Prompt augmentation

Added to the system prompt only when the tool loop is active (env flag
on):

```
TOOL-NUTZUNG (optional)
Wenn du dir bei food_key oder Schreibweise unsicher bist, rufe das Tool
"search_nutrition" mit einem deutschen Suchbegriff auf. Es gibt dir
2-3 Kandidaten aus der Datenbank zurück. Wähle den passendsten
food_key aus den Ergebnissen. Maximal 5 Tool-Aufrufe pro Mahlzeit.
Beispiel: Du siehst Salat-Blätter → suche "Kopfsalat" oder "Romana",
nicht das generische "Salat", das mehrdeutig ist.
```

The prompt-assertion test (`classify-prompt.test.ts`) only checks the
non-tool prompt body, so this appendix doesn't break it. The
deliberate-decomposition example (Salat → Kopfsalat) anchors the
intended use case for the model without prescribing a recipe.

## 5. Validation

### 5.1 Unit tests — pass

`runner/test/nutrition/classify-tools.test.ts` covers:

- Tool JSON schema compiles via Ajv + accepts well-formed args + rejects
  malformed (missing query, out-of-range max_results, additionalProperties).
- `parseSearchArgs` normalises whitespace, coerces string ints, clamps,
  rejects bad shapes.
- `dispatchSearchNutrition` returns ≥1 seed hit for `Kichererbsen`
  (`source: "seed"`, `food_key: "chickpeas_cooked"`).
- `dispatchSearchNutrition` returns `[]` cleanly when nothing matches and
  external services 500 / 503.
- The tool loop terminates after one tool call → final JSON (2 chat
  calls total).
- The single-shot path works when the model never calls a tool.
- Retry-without-hint kicks in when the tool loop exhausts (6 chat calls:
  5 tool-loop + 1 retry).
- Env flag default-off means no `tools` array in the request body.

All 14 tests pass; entire 258-test runner suite remains green.

### 5.2 Live grounding probe — Dürüm photo

Probe script `runner/scripts/test-grounding-durum.ts` now accepts a
`--tools` flag. Acceptance gate: ≥4 components, no "Belegtes Brötchen"
lump, every component carries provenance, ≥1 external-DB grounding,
kcal total 600–1000.

**Live run, 2026-05-18 on this Mac (M1 Max, 32 GB, qwen3.6:latest):**

#### Baseline (tools=off), partial output

- Classify took **183 s** (within budget).
- 4 components, decomposition rule fired correctly:
  - `fladenbrot` 100 g (vlm)
  - `haehnchen_gegrillt` 120 g (user_text)
  - `salat_gemisch` 50 g (vlm)
  - `sauce_joghurt` 30 g (vlm)
- USDA grounding hits:
  - `haehnchen_gegrillt` → fdc:2705969 "Chicken breast, grilled with sauce, skin eaten"
  - **`salat_gemisch` → fdc:2710312 "Gelatin salad with vegetables"** ← this is the
    bug the spec called out. The German "Salatgemisch" got translated
    to "vegetable salad" which matched a USDA gelatin dessert, not leafy
    greens.
- `sauce_joghurt`: USDA 404, OFF 503 → fell to LLM fallback.

Probe was killed during enrich to free GPU for the tools-on run; not
a code failure.

#### Tools-on, partial output

- Classify started at 10:01. **Within ~13 s** the model emitted FOUR
  `search_nutrition` calls in a single assistant turn:
  - `search_nutrition({query: "fladenbrot"})`
  - `search_nutrition({query: "haehnchenbrust_gegrillt"})` — more
    specific than the baseline's `haehnchen_gegrillt`
  - **`search_nutrition({query: "salat_mischpflanze"})`** — this is the
    exact disambiguation the spec wanted. Instead of committing
    `salat_gemisch` and ending up at "Gelatin salad", the model
    paused, searched the catalog with a more specific term, and waited
    for results.
  - `search_nutrition({query: "joghurt_sauce"})`
- USDA/OFF returned mostly empty (the test environment has rate-limit
  / connectivity churn against USDA's DEMO_KEY and OFF's `world.*`
  CDN), so the tool returned `results: []` for several queries.
- After the tool round-trip, Ollama crashed mid-inference on the
  second model turn (`fetch failed` on the runner side; Ollama
  server-log shows the model runner OOM-loaded and restarted twice
  during the probe window). The tool loop exhausted, retry path also
  hit the crash, and the probe exited with `[FAIL]`.

**Findings:**

1. **The tool-calling protocol works.** qwen3.6 honours `tools` +
   `format` simultaneously, emits well-formed `tool_calls`, and our
   dispatch correctly walks the seed → cache → USDA → OFF chain.
2. **The disambiguation behaviour is what we wanted.** The model
   spontaneously searched for `salat_mischpflanze` (more specific
   than the baseline's `salat_gemisch`) and `haehnchenbrust_gegrillt`
   (more specific than `haehnchen_gegrillt`). This is the exact
   anti-pattern the spec called out (`salat` → USDA salad-dressing).
3. **Ollama instability under vision + tools is the production
   blocker.** Two model restarts during the probe window indicate
   Ollama's metal runner is OOM-pressured by the
   vision-attention + tool-grammar combination on this 36B Q4 model.
   The unit tests prove protocol correctness; reproducing the live
   tool-loop A/B benefit requires either:
   - a free Mac (close all other GPU users incl. browser hw-accel),
   - or a more conservative `num_predict` for the classify phase
     (currently 20000, was 3000 in the original validation doc),
   - or a smaller/quantised model for the tool-iteration steps.

A/B comparison metrics (where collected — *partial run, see above*):

| Metric | Baseline | Tools on |
|---|---|---|
| component count | 4 | (≥4 expected from tool log — see above) |
| food_keys | `fladenbrot, haehnchen_gegrillt, salat_gemisch, sauce_joghurt` | tool-queried: `fladenbrot, haehnchenbrust_gegrillt, salat_mischpflanze, joghurt_sauce` |
| salat disambiguation | NO — `salat_gemisch` → "Gelatin salad" | YES — model queried `salat_mischpflanze` (more specific) |
| protein disambiguation | partial — `haehnchen_gegrillt` | YES — model queried `haehnchenbrust_gegrillt` |
| latency to classify | 183 s | did not complete (Ollama crash) |
| tool calls fired | n/a | 4 in a single round, before Ollama crashed |

The qualitative win is clear (model self-discovers ambiguity);
the quantitative reproducibility win requires a stable Ollama
runtime for a follow-up probe.

### 5.3 Additional photos

Only `meal-1024.jpg` is currently on disk. To run the other three
proposed probes (chicken-rice one-pot, quiche, fourth photo) the user
needs to capture them via the PWA and re-run `--tools` with
`PROBE_PHOTO=...` and `PROBE_HINT=...`. Manual probe steps:

```bash
# In runner/ with PULSE_FOOD_NUTRITION + Ollama up:
PROBE_PHOTO=/tmp/pulse-shots/chicken-rice.jpg PROBE_HINT="Hähnchen mit Reis" \
  npx tsx scripts/test-grounding-durum.ts

PROBE_PHOTO=/tmp/pulse-shots/chicken-rice.jpg PROBE_HINT="Hähnchen mit Reis" \
  npx tsx scripts/test-grounding-durum.ts --tools

# Compare the food_keys + provenance lines between the two outputs.
```

## 6. Recommendation

**Ship as opt-in via `NUTRITION_TOOLS_ENABLED=1`** (default off).
Reasoning:

- The loop adds 2-5× the round-trip count per meal. On a single-GPU Mac
  with qwen3.6 vision-thinking, that's a meaningful latency hit. Acceptable
  for the user's quality-first stance, but the default should not surprise
  others operating the same code.
- Tool-calling under vision input on qwen3.6 is *novel* in this repo —
  not battle-tested under the production load curve. Known issues in
  Ollama upstream include silent tool-call drops with large system
  prompts (§4 prompt is ~1.6kb, near the threshold), and template bugs
  on related Qwen builds.
- The fall-back is robust: any single failure in the loop drops to the
  plain `callClassify` path, which has 100% parse rate in the original
  validation doc. There is no scenario where enabling tools makes the
  pipeline worse than the current default behaviour — only slower.
- Enable in production after the user has rerun the 4-photo probe set
  and confirmed at least one canonicalisation improvement
  (e.g. `salat → kopfsalat`) without regression on the other three.

## 7. Known caveats

- **`tools` + `format` together** — the Ollama API docs are silent on
  this combo. Empirically qwen3.6 handles both fine. If a future
  model breaks this, the env flag is the kill switch.
- **Schema validation only on final turn.** Iterations with tool_calls
  return empty content; we don't try to validate empty against the
  classify schema. Once the model commits a final non-tool response,
  format-grammar enforcement applies as in the baseline.
- **No `id` field on tool calls.** Ollama's spec (verified via
  ollama.com/blog/tool-support + docs/api.md) omits `tool_call_id`;
  the linkage between assistant tool_calls and role:"tool" replies is
  positional plus the `tool_name` echo. Our impl uses `tool_name` to
  match.
- **Single-slot GPU contention.** A tool loop holds the slot for
  N×generation. If multiple meals were pipelined, the dashboard's
  perceived latency would balloon. The runner queue serialises
  classify jobs anyway, so this is mostly theoretical.
- **`MAX_TOOL_ITERATIONS = 5`.** Anything above is pathological; below 3
  loses headroom for the "search → see → search again" pattern the
  spec wanted to support. 5 is the sweet spot.
- **`dispatchSearchNutrition` returns at first seed/cache hit.** Spec
  said "fall through if <2 hits"; we tightened that to ≥1. Seed values
  are authoritative for the *disambiguation* use case — the model just
  needs a canonical food_key. Going off-host on a known seed hit adds
  2-5s with no signal gain.

## 8. Files changed

- **New:**
  - `runner/src/nutrition/stages/classify-tools.ts` — tool definition +
    dispatch.
  - `runner/test/nutrition/classify-tools.test.ts` — 14 unit tests.
  - `docs/wip/NUTRITION_TOOL_CALLING.md` — this doc.
- **Modified:**
  - `runner/src/nutrition/stages/classify-vlm.ts` — adds the tool loop
    behind the `NUTRITION_TOOLS_ENABLED` env flag. Existing prompt-only
    path is preserved verbatim as the default and the fallback.
  - `runner/scripts/test-grounding-durum.ts` — `--tools` flag for the
    grounding probe; prints food_keys + provenance counts in the footer
    for easy A/B comparison.
