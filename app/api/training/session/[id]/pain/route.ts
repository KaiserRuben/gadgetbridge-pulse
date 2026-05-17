import { NextResponse } from "next/server";

import { raisePain } from "@/lib/training/pain";
import type { TrainingPainFlagV1 } from "@/lib/types/generated";

export const dynamic = "force-dynamic";

const LOCATION_CODES = [
  "back",
  "shoulder",
  "elbow",
  "wrist",
  "thumb",
  "hip",
  "knee",
  "ankle",
  "foot",
  "neck",
  "head",
  "chest",
  "abdominal",
  "other",
] as const;
const SIDES = ["left", "right", "bilateral", "n_a"] as const;
const SEVERITIES = ["mild", "sharp"] as const;

/**
 * POST /api/training/session/:id/pain — raise a pain flag for the session.
 *
 * Body:
 *   {
 *     location_code: <enum>, side: <enum>, severity: 'mild'|'sharp',
 *     exercise_id?: string|null, set_log_id?: number|null,
 *     free_text?: string|null
 *   }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const loc = typeof b.location_code === "string" ? b.location_code : null;
  const side = typeof b.side === "string" ? b.side : null;
  const sev = typeof b.severity === "string" ? b.severity : null;
  if (!loc || !(LOCATION_CODES as readonly string[]).includes(loc)) {
    return NextResponse.json(
      { error: `location_code must be one of: ${LOCATION_CODES.join(",")}` },
      { status: 400 },
    );
  }
  if (!side || !(SIDES as readonly string[]).includes(side)) {
    return NextResponse.json({ error: `side must be one of: ${SIDES.join(",")}` }, { status: 400 });
  }
  if (!sev || !(SEVERITIES as readonly string[]).includes(sev)) {
    return NextResponse.json({ error: `severity must be one of: ${SEVERITIES.join(",")}` }, { status: 400 });
  }
  try {
    const row = raisePain({
      actual_session_id: id,
      exercise_id: typeof b.exercise_id === "string" ? b.exercise_id : null,
      set_log_id: typeof b.set_log_id === "number" ? b.set_log_id : null,
      location_code: loc as TrainingPainFlagV1["location_code"],
      side: side as TrainingPainFlagV1["side"],
      severity: sev as TrainingPainFlagV1["severity"],
      free_text: typeof b.free_text === "string" ? b.free_text : null,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
