import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";

import { listProposals } from "@/lib/training/proposal";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  });
}

export default async function ProposalsPage() {
  noStore();
  const pending = listProposals("pending");
  const resolved = listProposals().filter((p) => p.status !== "pending").slice(0, 30);

  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Plan-Vorschläge" title="Offen">
        {pending.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-5 text-caption text-muted">
              Keine offenen Plan-Vorschläge.
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <Link
                key={p.id}
                href={`/training/proposals/${p.id}`}
                className="block"
              >
                <Card hoverable>
                  <CardBody className="p-5 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Eyebrow>{fmtDate(p.generated_at)}</Eyebrow>
                      <Pill tone="activity" size="sm">{p.scope}</Pill>
                      <Pill tone="neutral" size="sm">v{p.target_plan_version}</Pill>
                      <Pill tone="steady" size="sm">{p.diff.length} Änderung{p.diff.length === 1 ? "" : "en"}</Pill>
                    </div>
                    <p className="text-[0.9375rem]">{p.summary_de ?? p.reasoning_trace.slice(0, 200)}</p>
                    <div className="flex items-center gap-2 text-caption text-faint">
                      <Glyph name="ChevronRight" size={14} />
                      Diff prüfen
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Historie" title="Letzte aufgelöst">
        <Card variant="soft">
          <CardBody className="p-3">
            {resolved.length === 0 ? (
              <div className="p-4 text-caption text-muted">Noch keine aufgelösten Vorschläge.</div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {resolved.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/training/proposals/${p.id}`}
                      className="flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-[var(--color-surface-2)]/50 transition-colors"
                    >
                      <span className="num-mono text-caption w-[88px]">{fmtDate(p.generated_at)}</span>
                      <span className="flex-1 truncate text-[0.9375rem]">
                        {p.summary_de ?? p.reasoning_trace.slice(0, 140)}
                      </span>
                      <Pill
                        tone={p.status === "accepted" ? "up" : p.status === "rejected" ? "down" : "neutral"}
                        size="sm"
                      >
                        {p.status}
                      </Pill>
                      <Glyph name="ChevronRight" size={14} className="text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
