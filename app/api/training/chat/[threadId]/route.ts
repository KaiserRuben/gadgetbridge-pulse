import { NextResponse } from "next/server";

import { listMessages, readThread } from "@/lib/training/chat";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await ctx.params;
  const thread = readThread(threadId);
  if (!thread) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  const messages = listMessages(threadId);
  return NextResponse.json({ thread, messages });
}
