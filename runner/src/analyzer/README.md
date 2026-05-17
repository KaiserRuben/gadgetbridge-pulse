# Analyzer — LLM call architecture

This directory hosts probe reports and (future) Phase 3 analyzer stages. Anything that reads pre-computed deterministic facts and asks qwen3.6 a narrow question lives here.

## Architectural principle

**Every LLM call is one specific narrow task with scoped relevant input.**

- Math does ranking, computation, statistics, clustering, threshold checks.
- LLM does narrow human-readable framing — naming a cluster, writing a one-line rationale, ranking by a *qualitative* dimension that math can't capture.
- The 265k context window of qwen3.6 is **headroom for fitting all relevant data for one task**, not justification for bigger prompts. Many small calls > one mega-prompt.

## Probe-driven scope

Each analyzer stage ships only after a probe in this directory establishes:

1. **Minimum scoped input** that produces ship-quality output. Larger inputs degrade signal-to-noise even when they fit.
2. **Latency budget** for the call (typical Phase 3 budget: ≤30 s for analyzer stages, ≤60 s for vision).
3. **Failure modes** (hallucinated numbers, diagnostic creep, autonomy violations) covered by a verifier or a post-validator.
4. **Stability** across reruns — if the same input produces materially different outputs, deterministic pre-processing must absorb more of the work.

## Probe outcomes (Phase 1, 2026-05-08)

- `PROBE_anomaly_explanation.md` — **ship**: 7-day `_facts.json` window, qwen3.6 produces ranked plausible factors. Quality flag: weak inferential links; mitigated by post-validator on `strong`-rated rationales.
- `PROBE_pattern_naming_and_surprise.md` — **iterate**: model picks *a* coherent narrative not *the salient* one, surprise labels unstable. Fix: deterministic salience pre-ranking + hard z-band labels; LLM only frames.
- `PROBE_vision.md` — **partial ship**: Huawei Health body-comp screenshot OCR clean (closes Gadgetbridge gap). Chart annotation hallucinates — abandoned (we have raw data). Meal photos defer.
- Coaching-trajectory probe — **ship**: per-lever narrow LLM call with deterministic pre-ranking + per-week seed for tiny-step stability. Cache by `(user, lever_id, iso_week)` to prevent tiny-step churn.

## Code rules for Phase 3 analyzer stages

When implementing a stage in this directory:

1. Compute every deterministic value before the LLM call. Mean, stddev, z-score, trend slope, cluster membership, threshold flags — all done in TypeScript first.
2. Pass the LLM a structured input that already names what is salient. Do not ask the LLM to find the salient thing.
3. Use Ollama `format: <JSON schema>` for output. Reject anything that doesn't validate.
4. Cap `num_predict` to the smallest budget the schema needs.
5. Budget assumption: qwen3.6:latest at Q4_K_M on local hardware is ~14 tok/s. A 600-token output ≈ 45 s. Plan accordingly.
6. Each analyzer stage has its own probe file in this directory tracking quality + the prompt that ships.

## What this directory is not

- Not a place for prose summarization. Daily article-format prose stays in `runner/src/prompts/daily.ts` and goes through the existing 6-layer verifier.
- Not a place for agentic loops. Single-call narrow tasks only.
- Not a place for retrieval. We feed scoped data directly because the personal data set is small enough to fit.
