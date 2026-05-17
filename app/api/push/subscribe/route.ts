import { NextResponse } from "next/server";
import { upsertSubscription } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

interface Body {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(req: Request) {
  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { error: "endpoint + keys.p256dh + keys.auth required" },
      { status: 400 },
    );
  }
  upsertSubscription({
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    user_agent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
