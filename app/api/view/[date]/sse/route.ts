/**
 * View-state SSE stream.
 *
 * GET /api/view/<period_key>/sse
 *
 * Opens a Server-Sent-Events stream that pushes the full ViewState
 * document each time the underlying view file changes.
 *
 * Wire:
 *   - "view" event: full ViewState JSON payload
 *   - ":heartbeat" comment every HEARTBEAT_MS to keep proxies honest
 *
 * Why full snapshot instead of diffs: the ViewState document is small
 * (low single-digit KB), the writer already atomic-renames, and full
 * snapshots avoid client-side reconciliation bugs. SSE budget is fine.
 */

import { watch } from "node:fs";

import { detectScope, getReader } from "@/lib/view-state/shared";

const HEARTBEAT_MS = 25_000;
const POLL_DEBOUNCE_MS = 250;
const POLL_INTERVAL_MS = 5_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { date } = await params;
  const scope = detectScope(date);
  if (!scope) {
    return new Response(
      JSON.stringify({ ok: false, code: "bad_request", error: `invalid period_key: ${date}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const reader = getReader();
  const filePath = reader.filePath(scope, date);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending: NodeJS.Timeout | null = null;

      const safeEnqueue = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client disconnected mid-write — caller will hit the abort path.
        }
      };

      const sendView = async (): Promise<void> => {
        try {
          const view = await reader.read(scope, date);
          if (view) {
            safeEnqueue(`event: view\ndata: ${JSON.stringify(view)}\n\n`);
          } else {
            safeEnqueue(
              `event: empty\ndata: ${JSON.stringify({ period_key: date, scope })}\n\n`,
            );
          }
        } catch (err) {
          safeEnqueue(
            `event: error\ndata: ${JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            })}\n\n`,
          );
        }
      };

      const scheduleSend = (): void => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          void sendView();
        }, POLL_DEBOUNCE_MS);
      };

      // Boot: send current snapshot.
      void sendView();

      // Watch the file for atomic renames; node's fs.watch fires on rename
      // when the writer swaps the staging file in.
      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(filePath, { persistent: false }, () => scheduleSend());
        watcher.on("error", () => {
          // File may not exist yet — fall back to polling.
        });
      } catch {
        // ENOENT — file not yet written; fallback to periodic polling.
      }

      // Fallback polling — covers ENOENT-then-create + cross-platform gaps.
      const poll = setInterval(() => scheduleSend(), POLL_INTERVAL_MS);
      const heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        watcher?.close();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const dynamic = "force-dynamic";
