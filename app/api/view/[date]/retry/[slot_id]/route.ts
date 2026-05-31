/**
 * Slot retry — UI-triggered force recompute.
 *
 * POST /api/view/<period_key>/retry/<slot_id>
 *
 * Resets the named slot's state to `scheduled` with `scheduled_for=now`.
 * Next daemon tick picks it up and dispatches.
 *
 * Fixed (daily / weekly) slots only. Event slots (post_workout,
 * anomaly_explain) carry an event_id and are retried through a separate
 * payload-shaped path — not the URL slug form.
 *
 * Responses:
 *   200 { ok: true, version: N, scheduled_for: ISO }
 *   400 invalid period_key / unknown slot / event slot rejected
 *   404 view not yet computed for that period
 *   409 race vs daemon — expected_version stale
 *   500 write failure
 */

import { NextResponse } from "next/server";

import { detectScope, getReader, getWriter } from "@/lib/view-state/shared";
import { VersionConflictError } from "@/runner/v4/view-state/writer.ts";
import { getSlotEntry } from "@/runner/v4/slots/_registry.ts";
import {
  DAILY_SLOT_IDS,
  WEEKLY_SLOT_IDS,
  EVENT_SLOT_IDS,
} from "@/runner/v4/types.ts";
import type {
  DailySlotId,
  SlotEntry,
  SlotId,
  WeeklySlotId,
} from "@/runner/v4/types.ts";

type FixedSlotId = DailySlotId | WeeklySlotId;
const FIXED_IDS = new Set<string>([...DAILY_SLOT_IDS, ...WEEKLY_SLOT_IDS]);
const EVENT_IDS = new Set<string>([...EVENT_SLOT_IDS]);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ date: string; slot_id: string }> },
): Promise<NextResponse> {
  const { date, slot_id } = await params;
  const scope = detectScope(date);
  if (!scope) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: `invalid period_key: ${date}` },
      { status: 400 },
    );
  }
  if (EVENT_IDS.has(slot_id)) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        error: `event slot ${slot_id} requires event_id; not retriable via this route`,
      },
      { status: 400 },
    );
  }
  if (!FIXED_IDS.has(slot_id)) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: `unknown slot_id: ${slot_id}` },
      { status: 400 },
    );
  }
  const fixedSlotId = slot_id as FixedSlotId;

  const view = await getReader().read(scope, date);
  if (!view) {
    return NextResponse.json(
      { ok: false, code: "not_found", period_key: date, scope },
      { status: 404 },
    );
  }
  const reg = getSlotEntry(fixedSlotId as SlotId);
  if (reg.scope !== scope) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        error: `slot ${slot_id} is ${reg.scope}, not ${scope}`,
      },
      { status: 400 },
    );
  }

  const slots = view.slots as unknown as Record<string, SlotEntry | undefined>;
  const current = slots[fixedSlotId];
  const now = new Date();
  const entry: SlotEntry = {
    slot_id: reg.slot_id,
    status: "scheduled",
    scheduled_for: now.toISOString(),
    ttl_ms: reg.ttl_ms,
    computed_at: current?.computed_at ?? null,
    computed_by: current?.computed_by ?? null,
    payload: current?.payload ?? null,
    inputs_used: current?.inputs_used ?? null,
    error: null,
    degraded_reason: null,
    request_count: (current?.request_count ?? 0) + 1,
    version: current?.version ?? 0,
  };

  try {
    const next = await getWriter().applySlot({
      scope,
      period_key: date,
      slot_id: reg.slot_id,
      entry,
      expected_version: view.version,
    });
    return NextResponse.json(
      { ok: true, version: next.version, scheduled_for: entry.scheduled_for },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return NextResponse.json(
        {
          ok: false,
          code: "version_conflict",
          expected: err.expected,
          current_version: err.actual,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "write_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
