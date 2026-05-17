import { NextResponse } from "next/server";
import { readAlarmState, writeAlarmState } from "@/lib/state-io";
import type { AlarmStateV1 } from "@/lib/types/generated";

export const dynamic = "force-dynamic";

type Action = "dismiss" | "snooze" | "mute";

type Body = {
  alarm_id: string;
  action: Action;
  until_iso?: string;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validate(input: unknown): Body | string {
  if (!isObject(input)) return "body must be a JSON object";
  const { alarm_id, action, until_iso } = input;
  if (typeof alarm_id !== "string" || alarm_id.length === 0) {
    return "alarm_id must be a non-empty string";
  }
  if (action !== "dismiss" && action !== "snooze" && action !== "mute") {
    return "action must be 'dismiss', 'snooze', or 'mute'";
  }
  if (action === "snooze") {
    if (typeof until_iso !== "string" || !Number.isFinite(Date.parse(until_iso))) {
      return "snooze action requires until_iso (valid ISO date)";
    }
  }
  return {
    alarm_id,
    action,
    until_iso: typeof until_iso === "string" ? until_iso : undefined,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = validate(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const current = await readAlarmState();
  const next: AlarmStateV1 = {
    schema_version: "state/v1",
    snooze_until: { ...current.snooze_until },
    dismissed_counts: { ...current.dismissed_counts },
    muted_topics: [...current.muted_topics],
  };

  switch (parsed.action) {
    case "dismiss": {
      const prev = next.dismissed_counts[parsed.alarm_id] ?? 0;
      next.dismissed_counts[parsed.alarm_id] = prev + 1;
      // A snooze for the same alarm is no longer relevant once dismissed.
      delete next.snooze_until[parsed.alarm_id];
      break;
    }
    case "snooze": {
      next.snooze_until[parsed.alarm_id] = parsed.until_iso!;
      break;
    }
    case "mute": {
      if (!next.muted_topics.includes(parsed.alarm_id)) {
        next.muted_topics.push(parsed.alarm_id);
      }
      break;
    }
  }

  try {
    await writeAlarmState(next);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json(next);
}
