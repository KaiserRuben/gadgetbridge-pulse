/**
 * Phase B: plan-diff round-trip.
 *
 * `lib/training/plan-diff.ts` is shared between the Next.js side (plan-history
 * UI, proposal-accept flow) and the runner (LLM context bundling), so the
 * tests live here to verify the pure-function semantics without dragging
 * server-only imports into either runtime.
 */

import { describe, expect, it } from "vitest";

// Runner tsconfig does not list lib/training in `include`, so this test
// imports through a relative path. The diff function is pure — no server-only
// dep — and tsx resolves the module at runtime.
import { diffPlans, type DiffOp } from "../../../../../lib/training/plan-diff.ts";
import type { TrainingPlanV1 } from "../../../../../lib/types/generated";

function minimalPlan(overrides: Partial<TrainingPlanV1> = {}): TrainingPlanV1 {
  return {
    schema_version: "training/plan/v1",
    name: "Test",
    status: "active",
    created_at: "2026-05-16T00:00:00Z",
    current_phase_id: "p1",
    phases: [{ id: "p1", label: "P1", session_templates: [] }],
    ...overrides,
  } as TrainingPlanV1;
}

describe("plan-diff", () => {
  it("synthesises a root insert when no predecessor exists", () => {
    const after = minimalPlan();
    const ops = diffPlans(null, after);
    expect(ops).toEqual<DiffOp[]>([
      { op: "insert", path: "/", before: undefined, after },
    ]);
  });

  it("emits no ops when before === after", () => {
    const p = minimalPlan();
    expect(diffPlans(p, p)).toEqual([]);
  });

  it("emits a leaf `set` for primitive changes", () => {
    const before = minimalPlan({ name: "A" });
    const after = minimalPlan({ name: "B" });
    const ops = diffPlans(before, after);
    expect(ops).toEqual<DiffOp[]>([
      { op: "set", path: "/name", before: "A", after: "B" },
    ]);
  });

  it("emits `insert` for new object keys", () => {
    const before = minimalPlan();
    const after = minimalPlan({ language: "en" });
    const ops = diffPlans(before, after);
    expect(ops).toContainEqual({ op: "insert", path: "/language", before: undefined, after: "en" });
  });

  it("emits `remove` for removed object keys", () => {
    const before = minimalPlan({ language: "de" });
    const after = minimalPlan();
    const ops = diffPlans(before, after);
    expect(ops).toContainEqual({ op: "remove", path: "/language", before: "de", after: undefined });
  });

  it("walks arrays positionally", () => {
    const before = minimalPlan({ todos: ["a", "b"] });
    const after = minimalPlan({ todos: ["a", "c", "d"] });
    const ops = diffPlans(before, after);
    // index 1 changed b → c, index 2 inserted "d"
    expect(ops).toContainEqual({ op: "set", path: "/todos/1", before: "b", after: "c" });
    expect(ops).toContainEqual({ op: "insert", path: "/todos/2", before: undefined, after: "d" });
  });

  it("escapes `/` and `~` in path segments", () => {
    const before = { a: { "weird/key": 1, "tilde~here": 2 } } as unknown as TrainingPlanV1;
    const after = { a: { "weird/key": 5, "tilde~here": 6 } } as unknown as TrainingPlanV1;
    const ops = diffPlans(before, after);
    expect(ops.map((o) => o.path).sort()).toEqual(["/a/tilde~0here", "/a/weird~1key"]);
  });
});
