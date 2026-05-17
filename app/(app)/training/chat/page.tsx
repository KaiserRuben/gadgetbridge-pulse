import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

import { listThreads } from "@/lib/training/chat";
import { ChatPanel } from "@/components/training/chat-panel";

export const dynamic = "force-dynamic";

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} T`;
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  noStore();
  const sp = await searchParams;
  const threads = listThreads(20);
  const activeId = sp.thread ?? threads[0]?.id ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      <aside className="flex flex-col gap-2">
        <Eyebrow>Threads</Eyebrow>
        <Link
          href="/training/chat"
          className="px-3 h-10 inline-flex items-center rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-[0.9375rem]"
        >
          + Neuer Thread
        </Link>
        <Card variant="soft">
          <CardBody className="p-2">
            {threads.length === 0 ? (
              <p className="text-caption text-muted p-2">Noch keine Threads.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {threads.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/training/chat?thread=${t.id}`}
                      aria-current={activeId === t.id ? "page" : undefined}
                      className={[
                        "block px-2 py-1.5 rounded-lg text-[0.9375rem] truncate",
                        activeId === t.id
                          ? "bg-[var(--color-surface-3)]"
                          : "hover:bg-[var(--color-surface-2)]",
                      ].join(" ")}
                    >
                      {t.title ?? "Thread"}
                      <span className="block text-caption text-faint">{fmtRelative(t.last_message_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </aside>

      <main className="flex flex-col gap-4">
        <Section eyebrow="Frag Pulse" title="Chat">
          <ChatPanel initialThreadId={activeId} />
        </Section>
      </main>
    </div>
  );
}
