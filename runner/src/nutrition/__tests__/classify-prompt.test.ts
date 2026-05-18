/**
 * Stage A prompt assertion. We don't bench the LLM here — runs in CI without
 * GPU. Lock the ABSTRACT rule, not specific dish recipes — anchoring on
 * recipes overfits the prompt and the model memorises instead of generalising.
 */

import { describe, it, expect } from "vitest";

import { SYSTEM_PROMPT } from "../stages/classify-vlm.ts";

describe("Stage A prompt — decomposition", () => {
  it("declares the ZERLEGUNGS-REGEL", () => {
    expect(SYSTEM_PROMPT).toContain("ZERLEGUNGS");
  });

  it("forbids generic blobs (Wrap / Bowl / Belegtes Brötchen / Sandwich)", () => {
    expect(SYSTEM_PROMPT).toContain("Blob");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("wrap");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("bowl");
  });

  it("does NOT prescribe specific dish recipes (no recipe cookbook in prompt)", () => {
    // Recipe-specific food_keys that, if present, mean the prompt is
    // spoonfeeding answers rather than teaching the rule. Keep this green.
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).not.toContain("krautmix_doener");
    expect(lower).not.toContain("doener_fleisch_huhn");
    expect(lower).not.toContain("joghurt_knoblauch_sauce");
    expect(lower).not.toContain("bolognese_sauce");
    expect(lower).not.toContain("pizzateig");
    expect(lower).not.toContain("rinderhack");
  });

  it("requires specificity over generic categories", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("spezifischer");
  });

  it("allows a single component when the dish is genuinely homogeneous", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("suppe");
  });

  it("extends hint rule 3 to 'Vollständig anderes Gericht' (with or without quantity)", () => {
    expect(SYSTEM_PROMPT).toContain("Vollständig anderes Gericht");
    expect(SYSTEM_PROMPT).toContain("MIT oder OHNE Mengenangabe");
  });

  it("excludes Verpackung as a component", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("verpackung");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("nie eine");
  });

  it("preserves multi-image (label / context) handling", () => {
    expect(SYSTEM_PROMPT).toContain("MEHRERE BILDER");
    expect(SYSTEM_PROMPT).toContain("label");
    expect(SYSTEM_PROMPT).toContain("context");
  });

  it("keeps food_key normalisation rule (ae/oe/ue/ss)", () => {
    expect(SYSTEM_PROMPT).toContain("ae/oe/ue/ss");
  });
});
