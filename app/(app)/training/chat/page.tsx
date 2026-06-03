import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { FadeRise } from "@/components/motion/fade-rise";

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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Training"
        title="Frag Pulse"
        sub="Kontext aus aktivem Plan, letzten Sessions und Schmerz-Flags"
        back={{ href: "/training", label: "Training" }}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-2">
          <Eyebrow>Threads</Eyebrow>
          <Link
            href="/training/chat"
            className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-card)] border border-[var(--color-border)] px-3 text-body transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <Glyph name="Plus" size={14} />
            Neuer Thread
          </Link>
          <Card variant="soft">
            <CardBody className="p-2">
              {threads.length === 0 ? (
                <p className="p-2 text-caption text-muted">Noch keine Threads.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {threads.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/training/chat?thread=${t.id}`}
                        aria-current={activeId === t.id ? "page" : undefined}
                        className={[
                          "block truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-body transition-colors",
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

        <FadeRise className="flex flex-col gap-4">
          <ChatPanel initialThreadId={activeId} />
        </FadeRise>
      </div>
    </div>
  );
}
