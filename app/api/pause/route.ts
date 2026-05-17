import { NextResponse } from "next/server";
import { readPauseState, writePauseState } from "@/lib/state-io";
import type { PauseStateV1 } from "@/lib/types/generated";

export const dynamic = "force-dynamic";

type PauseUpdate = Partial<{
  paused: boolean;
  i_feel_fine: boolean;
  i_feel_fine_until_iso: string | null;
  language: "de" | "en";
}>;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validate the user-supplied patch against the pause.schema.json shape.
 * We only accept the four mutable fields; `schema_version` and the auto-set
 * `step_change_detected_on` are never user-writable.
 */
function validate(input: unknown): PauseUpdate | string {
  if (!isObject(input)) return "body must be a JSON object";
  const out: PauseUpdate = {};
  if ("paused" in input) {
    if (typeof input.paused !== "boolean") return "paused must be boolean";
    out.paused = input.paused;
  }
  if ("i_feel_fine" in input) {
    if (typeof input.i_feel_fine !== "boolean") return "i_feel_fine must be boolean";
    out.i_feel_fine = input.i_feel_fine;
  }
  if ("i_feel_fine_until_iso" in input) {
    const v = input.i_feel_fine_until_iso;
    if (v !== null && typeof v !== "string") {
      return "i_feel_fine_until_iso must be ISO string or null";
    }
    if (typeof v === "string" && !Number.isFinite(Date.parse(v))) {
      return "i_feel_fine_until_iso must be a valid date-time";
    }
    out.i_feel_fine_until_iso = v as string | null;
  }
  if ("language" in input) {
    if (input.language !== "de" && input.language !== "en") {
      return "language must be 'de' or 'en'";
    }
    out.language = input.language;
  }
  return out;
}

export async function GET() {
  const state = await readPauseState();
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch = validate(body);
  if (typeof patch === "string") {
    return NextResponse.json({ error: patch }, { status: 400 });
  }

  const current = await readPauseState();
  const next: PauseStateV1 = {
    ...current,
    ...patch,
    schema_version: "state/v1",
  };

  try {
    await writePauseState(next);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json(next);
}
