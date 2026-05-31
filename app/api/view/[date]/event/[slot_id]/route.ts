/**
 * Event-slot trigger — UI-initiated POST for event slots (post_workout,
 * anomaly_explain).
 *
 * POST /api/view/<period_key>/event/<slot_id>
 *   body: { event_id: string, observation_id?: string }
 *
 * Writes a `scheduled` SlotEntry into view.events[slot_id]; daemon picks
 * it up on the next tick. Idempotent: existing fresh/computing/scheduled/
 * aging entries are not re-scheduled — the route returns 200 with
 * `already_scheduled: true`.
 *
 * Responses:
 *   200 { ok: true, version: N, scheduled_for: ISO }
 *   200 { ok: true, already_scheduled: true, version: N, scheduled_for: ISO }
 *   400 invalid period_key / unknown slot / missing event_id / missing observation_id
 *   404 view not yet computed for that period
 *   409 race vs daemon — expected_version stale
 *   500 write failure
 */

import { NextResponse } from "next/server";

import { detectScope, getReader, getWriter } from "@/lib/view-state/shared";
import { VersionConflictError } from "@/runner/v4/view-state/writer.ts";
import { getSlotEntry } from "@/runner/v4/slots/_registry.ts";
import { EVENT_SLOT_IDS } from "@/runner/v4/types.ts";
import type {
  AnomalyExplainSlotEntry,
  EventSlotId,
  PostWorkoutSlotEntry,
  SlotDiff,
  SlotEntry,
} from "@/runner/v4/types.ts";

interface EventBody {
  event_id?: unknown;
  observation_id?: unknown;
}

const EVENT_IDS = new Set<string>([...EVENT_SLOT_IDS]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ date: string; slot_id: string }> },
): Promise<NextResponse> {
  const { date, slot_id } = await params;
  const scope = detectScope(date);
  if (scope !== "daily") {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: `event slots are daily only; got ${date}` },
      { status: 400 },
    );
  }
  if (!EVENT_IDS.has(slot_id)) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: `unknown event slot_id: ${slot_id}` },
      { status: 400 },
    );
  }
  const eventSlotId = slot_id as EventSlotId;

  let body: EventBody;
  try {
    body = (await req.json()) as EventBody;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        error: `invalid json: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: "missing or empty event_id" },
      { status: 400 },
    );
  }
  const observationId =
    typeof body.observation_id === "string" ? body.observation_id.trim() : "";
  if (eventSlotId === "anomaly_explain" && !observationId) {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: "anomaly_explain requires observation_id" },
      { status: 400 },
    );
  }

  const view = await getReader().read(scope, date);
  if (!view) {
    return NextResponse.json(
      { ok: false, code: "not_found", period_key: date, scope },
      { status: 404 },
    );
  }

  const list = view.events[eventSlotId] as Array<
    PostWorkoutSlotEntry | AnomalyExplainSlotEntry
  >;
  const existing = list.find((e) => e.event_id === eventId) ?? null;
  if (existing && isAlreadyActive(existing.status)) {
    return NextResponse.json(
      {
        ok: true,
        already_scheduled: true,
        version: view.version,
        scheduled_for: existing.scheduled_for,
      },
      { status: 200 },
    );
  }

  const now = new Date();
  const scheduledFor = now.toISOString();
  const reg = getSlotEntry(eventSlotId);
  const base: SlotEntry = {
    slot_id: eventSlotId,
    status: "scheduled",
    scheduled_for: scheduledFor,
    ttl_ms: reg.ttl_ms,
    computed_at: null,
    computed_by: null,
    payload: null,
    inputs_used: null,
    error: null,
    degraded_reason: null,
    request_count: (existing?.request_count ?? 0) + 1,
    version: 0,
  };

  const entry =
    eventSlotId === "post_workout"
      ? buildPostWorkoutEntry(base, eventId, existing as PostWorkoutSlotEntry | null)
      : buildAnomalyExplainEntry(base, eventId, observationId, existing as AnomalyExplainSlotEntry | null);

  try {
    const diff: SlotDiff = {
      scope,
      period_key: date,
      slot_id: eventSlotId,
      event_id: eventId,
      entry: entry as SlotEntry,
      expected_version: view.version,
    };
    const next = await getWriter().applySlot(diff);
    return NextResponse.json(
      { ok: true, version: next.version, scheduled_for: scheduledFor },
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

function isAlreadyActive(status: SlotEntry["status"]): boolean {
  return (
    status === "fresh" ||
    status === "computing" ||
    status === "scheduled" ||
    status === "aging"
  );
}

function buildPostWorkoutEntry(
  base: SlotEntry,
  eventId: string,
  existing: PostWorkoutSlotEntry | null,
): PostWorkoutSlotEntry {
  return {
    ...base,
    slot_id: "post_workout",
    event_id: eventId,
    workout_ref:
      existing?.workout_ref ?? {
        ts_start_iso: eventId,
        ts_end_iso: eventId,
        kind: 0,
      },
  } as PostWorkoutSlotEntry;
}

function buildAnomalyExplainEntry(
  base: SlotEntry,
  eventId: string,
  observationId: string,
  existing: AnomalyExplainSlotEntry | null,
): AnomalyExplainSlotEntry {
  return {
    ...base,
    slot_id: "anomaly_explain",
    event_id: eventId,
    observation_id: existing?.observation_id ?? observationId,
  } as AnomalyExplainSlotEntry;
}

export const dynamic = "force-dynamic";
