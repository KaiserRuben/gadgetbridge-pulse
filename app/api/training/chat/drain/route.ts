import { NextResponse } from "next/server";

import {
  createMessage,
  listMessages,
  nextQueuedMessage,
  updateMessage,
} from "@/lib/training/chat";
import { callRemoteChat } from "@/lib/training/chat-remote";

export const dynamic = "force-dynamic";

const MAX_PER_CALL = 5;

/**
 * POST /api/training/chat/drain
 *
 * Worker tick: take queued user messages oldest-first and try the remote
 * endpoint. Stops on the first persistent failure to avoid burning the
 * whole queue against an unreachable endpoint. Idempotent — multiple
 * concurrent drains race harmlessly because each individual message
 * transitions queued → in_flight via SQLite UPDATE.
 *
 * Caller schedule: client polls every ~30s while a thread shows queued
 * messages; or a cron route hits this every minute.
 */
export async function POST() {
  const drained: Array<{ message_id: number; thread_id: string; ok: boolean }> = [];

  for (let i = 0; i < MAX_PER_CALL; i++) {
    const msg = nextQueuedMessage();
    if (!msg) break;
    // Claim the slot.
    updateMessage({ id: msg.id, status: "in_flight" });
    const history = listMessages(msg.thread_id).filter((m) => m.id !== msg.id);
    const remote = await callRemoteChat({
      messages: history,
      newUserContent: msg.content ?? "",
      context: (msg.context_snapshot ?? {}) as never,
    });
    if (!remote.ok) {
      updateMessage({ id: msg.id, status: "queued", error: remote.error });
      drained.push({ message_id: msg.id, thread_id: msg.thread_id, ok: false });
      // Stop on first failure — the endpoint is probably still down.
      break;
    }
    updateMessage({
      id: msg.id,
      status: "delivered",
      endpoint: "remote",
      delivered_at: new Date().toISOString(),
    });
    const assistant = createMessage({
      thread_id: msg.thread_id,
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
    drained.push({ message_id: msg.id, thread_id: msg.thread_id, ok: true });
  }
  return NextResponse.json({ ok: true, drained });
}
