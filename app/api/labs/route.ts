import { NextResponse } from "next/server";
import { readLabs, writeLabs } from "@/lib/state-io";
import type { LabsV1 } from "@/lib/types/generated";

export const dynamic = "force-dynamic";

const VALID_FEATURES = [
  "cycle",
  "training_load",
  "illness_watch",
  "similar_day_search",
  "meal_photo",
  "voice_journal",
  "ecg",
] as const;

type FeatureKey = (typeof VALID_FEATURES)[number];

type Body = {
  feature: FeatureKey;
  enabled: boolean;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFeatureKey(x: unknown): x is FeatureKey {
  return typeof x === "string" && (VALID_FEATURES as readonly string[]).includes(x);
}

function validate(input: unknown): Body | string {
  if (!isObject(input)) return "body must be a JSON object";
  const { feature, enabled } = input;
  if (!isFeatureKey(feature)) {
    return `feature must be one of: ${VALID_FEATURES.join(", ")}`;
  }
  if (typeof enabled !== "boolean") {
    return "enabled must be boolean";
  }
  return { feature, enabled };
}

export async function GET() {
  const state = await readLabs();
  return NextResponse.json(state);
}

/**
 * POST /api/labs — flip a single feature flag. Bounded to the seven valid
 * keys so the JSON shape stays in lockstep with the generated type. Atomic
 * write via state-io.ts so partially-written files are never observed by
 * concurrent readers.
 */
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

  const current = await readLabs();
  const next: LabsV1 = {
    schema_version: "state/v1",
    features: {
      ...current.features,
      [parsed.feature]: parsed.enabled,
    },
  };

  try {
    await writeLabs(next);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json(next);
}
