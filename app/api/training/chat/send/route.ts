import { NextResponse } from "next/server";

import {
  createMessage,
  createThread,
  listMessages,
  readThread,
  updateMessage,
} from "@/lib/training/chat";
import { buildChatContext } from "@/lib/training/chat-context";
import { callRemoteChat } from "@/lib/training/chat-remote";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/chat/send
 *
 * Body: { thread_id?: string, content: string }
 *
 * Inserts the user message with a frozen context snapshot, then attempts
 * the remote LLM call inline. On success returns both messages (user +
 * assistant). On remote failure the user message stays `queued` and the
 * client polls /api/training/chat/[threadId]/drain to retry.
 */
export async function POST(req: Request) {
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
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

  let threadId = typeof b.thread_id === "string" ? b.thread_id : null;
  if (threadId && !readThread(threadId)) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }
  if (!threadId) {
    threadId = createThread(content.slice(0, 60)).id;
  }

  const context = buildChatContext();
  const userMsg = createMessage({
    thread_id: threadId,
    role: "user",
    content,
    status: "in_flight",
    context_snapshot: context,
  });
  // Re-fetch the full thread so the model sees prior turns.
  const history = listMessages(threadId).filter((m) => m.id !== userMsg.id);
  const remote = await callRemoteChat({
    messages: history,
    newUserContent: content,
    context,
  });

  if (!remote.ok) {
    updateMessage({
      id: userMsg.id,
      status: "queued",
      error: remote.error,
    });
    return NextResponse.json({
      ok: false,
      queued: true,
      thread_id: threadId,
      user_message_id: userMsg.id,
      error: remote.error,
    });
  }

  updateMessage({
    id: userMsg.id,
    status: "delivered",
    endpoint: "remote",
    delivered_at: new Date().toISOString(),
  });
  const assistant = createMessage({
    thread_id: threadId,
    role: "assistant",
    content: remote.content,
    status: "delivered",
    model: remote.model,
  });
  updateMessage({
    id: assistant.id,
    endpoint: "remote",
    delivered_at: new Date().toISOString(),
  });
  return NextResponse.json({
    ok: true,
    thread_id: threadId,
    user_message_id: userMsg.id,
    assistant_message_id: assistant.id,
    content: remote.content,
  });
}
