/**
 * Tests for the pure CellState folding logic that backs the dashboard's
 * `useJobCell` hook. The hook itself depends on React + the browser so we
 * verify the deterministic core here, where vitest can reach it.
 *
 * Imports cross the dashboard ↔ runner boundary via a relative path because
 * vitest's config uses esbuild and doesn't enforce tsconfig include.
 */

import { describe, expect, it } from "vitest";

import {
  buildCellUrl,
  buildEnqueueUrl,
  type CellApiResponse,
  foldResponse,
  initialSnapshot,
  isActive,
} from "../../../lib/derived/state.ts";

interface Payload {
  text: string;
}

function fresh(payload: Payload, updated = "2026-05-17T10:00:00Z"): CellApiResponse<Payload> {
  return {
    state: "ready_fresh",
    payload,
    provenance: [{ field_path: "text", source: "llm_derived" }],
    started_at: updated,
    error_text: null,
    updated_at: updated,
  };
}

function reprocessing(payload: Payload | null, updated = "2026-05-17T10:01:00Z"): CellApiResponse<Payload> {
  return {
    state: "reprocessing",
    payload,
    provenance: [],
    started_at: updated,
    error_text: null,
    updated_at: updated,
  };
}

function neverComputed(updated = "2026-05-17T10:02:00Z"): CellApiResponse<Payload> {
  return {
    state: "never_computed",
    payload: null,
    provenance: [],
    started_at: null,
    error_text: null,
    updated_at: updated,
  };
}

function errorRes(updated = "2026-05-17T10:03:00Z"): CellApiResponse<Payload> {
  return {
    state: "error",
    payload: null,
    provenance: [],
    started_at: null,
    error_text: "ollama unreachable",
    updated_at: updated,
  };
}

describe("foldResponse", () => {
  it("starts in fetching", () => {
    expect(initialSnapshot<Payload>().state).toBe("fetching");
  });

  it("ready_fresh replaces payload + provenance fully", () => {
    const s0 = initialSnapshot<Payload>();
    const s1 = foldResponse(s0, fresh({ text: "first" }));
    expect(s1.state).toBe("ready_fresh");
    expect(s1.payload?.text).toBe("first");
    expect(s1.provenance.length).toBe(1);

    const s2 = foldResponse(s1, fresh({ text: "second" }, "2026-05-17T11:00:00Z"));
    expect(s2.state).toBe("ready_fresh");
    expect(s2.payload?.text).toBe("second");
    expect(s2.updatedAt).toBe("2026-05-17T11:00:00Z");
  });

  it("reprocessing keeps cached payload when the server omits one", () => {
    const s0 = foldResponse(initialSnapshot<Payload>(), fresh({ text: "cached" }));
    const s1 = foldResponse(s0, reprocessing(null));
    expect(s1.state).toBe("reprocessing");
    expect(s1.payload?.text).toBe("cached");
    expect(s1.provenance.length).toBe(1);
  });

  it("reprocessing accepts a server-supplied payload override", () => {
    const s0 = foldResponse(initialSnapshot<Payload>(), fresh({ text: "v1" }));
    const s1 = foldResponse(s0, reprocessing({ text: "v1-mid-recalc" }));
    expect(s1.state).toBe("reprocessing");
    expect(s1.payload?.text).toBe("v1-mid-recalc");
  });

  it("never_computed with prior cache → reprocessing (cached delivery)", () => {
    const s0 = foldResponse(initialSnapshot<Payload>(), fresh({ text: "kept" }));
    const s1 = foldResponse(s0, neverComputed());
    expect(s1.state).toBe("reprocessing");
    expect(s1.payload?.text).toBe("kept");
  });

  it("never_computed with no prior cache → never_computed (CTA)", () => {
    const s0 = initialSnapshot<Payload>();
    const s1 = foldResponse(s0, neverComputed());
    expect(s1.state).toBe("never_computed");
    expect(s1.payload).toBeNull();
  });

  it("error preserves cached payload but flips state", () => {
    const s0 = foldResponse(initialSnapshot<Payload>(), fresh({ text: "kept-on-error" }));
    const s1 = foldResponse(s0, errorRes());
    expect(s1.state).toBe("error");
    expect(s1.payload?.text).toBe("kept-on-error");
    expect(s1.errorText).toBe("ollama unreachable");
  });

  it("error without prior cache → empty error state", () => {
    const s0 = initialSnapshot<Payload>();
    const s1 = foldResponse(s0, errorRes());
    expect(s1.state).toBe("error");
    expect(s1.payload).toBeNull();
  });

  it("two consecutive polls with different states transition correctly", () => {
    const s0 = initialSnapshot<Payload>();
    const s1 = foldResponse(s0, neverComputed());
    expect(s1.state).toBe("never_computed");
    const s2 = foldResponse(s1, reprocessing(null));
    // Server says reprocessing but we have no payload yet — surface
    // reprocessing state with null payload (the cell will render fallback).
    expect(s2.state).toBe("reprocessing");
    expect(s2.payload).toBeNull();
    const s3 = foldResponse(s2, fresh({ text: "now we have it" }));
    expect(s3.state).toBe("ready_fresh");
    expect(s3.payload?.text).toBe("now we have it");
  });

  it("ready_cached folds analogously to reprocessing without dropping payload", () => {
    const s0 = foldResponse(initialSnapshot<Payload>(), fresh({ text: "v1" }));
    const s1 = foldResponse(s0, {
      state: "ready_cached",
      payload: null,
      provenance: [],
      started_at: null,
      error_text: null,
      updated_at: "2026-05-17T12:00:00Z",
    });
    expect(s1.state).toBe("ready_cached");
    expect(s1.payload?.text).toBe("v1");
    expect(s1.provenance.length).toBe(1);
  });
});

describe("URL builders", () => {
  it("buildCellUrl produces the GET path with scope", () => {
    expect(buildCellUrl("sleep", "2026-05-17")).toBe(
      "/api/jobs/sleep/2026-05-17?scope=daily",
    );
    expect(buildCellUrl("activity", "2026-W20", "weekly")).toBe(
      "/api/jobs/activity/2026-W20?scope=weekly",
    );
  });

  it("buildEnqueueUrl points at the POST endpoint", () => {
    expect(buildEnqueueUrl("recovery", "2026-05-17")).toBe(
      "/api/jobs/recovery/2026-05-17/enqueue?scope=daily",
    );
  });

  it("encodes cluster + key safely", () => {
    expect(buildCellUrl("a/b", "2026 05 17")).toBe(
      "/api/jobs/a%2Fb/2026%2005%2017?scope=daily",
    );
  });
});

describe("isActive", () => {
  it("fetching + reprocessing are active", () => {
    expect(isActive("fetching")).toBe(true);
    expect(isActive("reprocessing")).toBe(true);
  });
  it("settled states are not active", () => {
    expect(isActive("ready_fresh")).toBe(false);
    expect(isActive("ready_cached")).toBe(false);
    expect(isActive("error")).toBe(false);
    expect(isActive("never_computed")).toBe(false);
  });
});
