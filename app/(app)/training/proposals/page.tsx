import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Training"
        title="Plan-Vorschläge"
        sub="Coach-generierte Plan-Anpassungen zum Review"
        back={{ href: "/training", label: "Training" }}
      />

      <Section eyebrow="Offen" title="Warten auf Review">
        {pending.length === 0 ? (
          <Card variant="soft">
            <CardBody className="p-5 text-caption text-muted">
              Keine offenen Plan-Vorschläge.
            </CardBody>
          </Card>
        ) : (
          <Stagger className="flex flex-col gap-3">
            {pending.map((p) => (
              <StaggerItem key={p.id}>
                <Link href={`/training/proposals/${p.id}`} className="block">
                  <Card hoverable>
                    <CardBody className="flex flex-col gap-2 p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Eyebrow>{fmtDate(p.generated_at)}</Eyebrow>
                        <Pill tone="activity" size="sm">{p.scope}</Pill>
                        <Pill tone="neutral" size="sm">v{p.target_plan_version}</Pill>
                        <Pill tone="steady" size="sm">{p.diff.length} Änderung{p.diff.length === 1 ? "" : "en"}</Pill>
                      </div>
                      <p className="text-body">{p.summary_de ?? p.reasoning_trace.slice(0, 200)}</p>
                      <div className="flex items-center gap-2 text-caption text-faint">
                        <Glyph name="ChevronRight" size={14} />
                        Diff prüfen
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </Section>

      <Section eyebrow="Historie" title="Zuletzt aufgelöst">
        <Card variant="soft">
          <CardBody className="p-2">
            {resolved.length === 0 ? (
              <div className="p-4 text-caption text-muted">Noch keine aufgelösten Vorschläge.</div>
            ) : (
              <Stagger className="flex flex-col divide-y divide-[var(--color-border)]">
                {resolved.map((p) => (
                  <StaggerItem key={p.id}>
                    <Link
                      href={`/training/proposals/${p.id}`}
                      className="flex h-12 items-center gap-3 rounded-[var(--radius-chip)] px-3 transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <span className="w-[88px] num-mono text-caption">{fmtDate(p.generated_at)}</span>
                      <span className="flex-1 truncate text-body">
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
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
