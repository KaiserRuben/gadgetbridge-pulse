import { NextResponse } from "next/server";
import { deleteSubscription } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { endpoint?: string } | null = null;
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body?.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  deleteSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
