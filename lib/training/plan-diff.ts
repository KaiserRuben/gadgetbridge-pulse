import type { TrainingPlanV1 } from "../types/generated";

/**
 * Minimal JSON-Pointer diff between two plan documents.
 *
 * Used by:
 *  - the plan-history UI (render version-vs-version changes),
 *  - the LLM context bundle (last 5 diffs feed every analysis — see
 *    docs/TRAINING_PLAN_DESIGN.md §Q2),
 *  - the adjustment-proposal acceptance flow (build the diff that the
 *    accepted proposal applied, so the new plan version's payload diff
 *    matches what the user agreed to).
 *
 * Not a full RFC-6902 patch — we only emit `set` (value changed),
 * `insert` (path is new), and `remove` (path gone). Sufficient for human
 * review; the adjustment-proposal schema's diff array uses the same op set.
 */

export interface DiffOp {
  op: "set" | "insert" | "remove";
  path: string;
  before: unknown;
  after: unknown;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function encodePointer(segments: ReadonlyArray<string | number>): string {
  return (
    "/" +
    segments
      .map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
      .join("/")
  );
}

function walk(
  before: unknown,
  after: unknown,
  segments: ReadonlyArray<string | number>,
  out: DiffOp[],
): void {
  if (Object.is(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      const a = before[k];
      const b = after[k];
      if (!(k in before)) {
        out.push({ op: "insert", path: encodePointer([...segments, k]), before: undefined, after: b });
      } else if (!(k in after)) {
        out.push({ op: "remove", path: encodePointer([...segments, k]), before: a, after: undefined });
      } else {
        walk(a, b, [...segments, k], out);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      if (i >= before.length) {
        out.push({ op: "insert", path: encodePointer([...segments, i]), before: undefined, after: after[i] });
      } else if (i >= after.length) {
        out.push({ op: "remove", path: encodePointer([...segments, i]), before: before[i], after: undefined });
      } else {
        walk(before[i], after[i], [...segments, i], out);
      }
    }
    return;
  }

  // Leaf change (primitive / type mismatch).
  out.push({ op: "set", path: encodePointer(segments), before, after });
}

export function diffPlans(before: TrainingPlanV1 | null, after: TrainingPlanV1): DiffOp[] {
  if (!before) {
    // No predecessor: synthesize a single "insert" at root so consumers can
    // render "Plan created" without special-casing.
    return [{ op: "insert", path: "/", before: undefined, after }];
  }
  const ops: DiffOp[] = [];
  walk(before as unknown, after as unknown, [], ops);
  return ops;
}
