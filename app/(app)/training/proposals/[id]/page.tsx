import "server-only";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Section } from "@/components/ui/section";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

import { readProposal } from "@/lib/training/proposal";
import { ProposalActions } from "@/components/training/proposal-actions";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  noStore();
  const { id: idStr } = await params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id < 1) return notFound();
  const proposal = readProposal(id);
  if (!proposal) return notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Vorschlag #${proposal.id}`}
        title={proposal.summary_de ?? `Plan-Vorschlag #${proposal.id}`}
        sub={fmtDateTime(proposal.generated_at)}
        back={{ href: "/training/proposals", label: "Vorschläge" }}
      />

      <FadeRise>
        <Card glow="activity">
          <CardBody className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="activity" size="sm">{proposal.scope}</Pill>
              <Pill tone="neutral" size="sm">Plan v{proposal.target_plan_version}</Pill>
              <Pill
                tone={
                  proposal.status === "pending"
                    ? "steady"
                    : proposal.status === "accepted"
                      ? "up"
                      : proposal.status === "rejected"
                        ? "down"
                        : "neutral"
                }
                size="sm"
              >
                {proposal.status}
              </Pill>
            </div>
            <p className="max-w-[64ch] whitespace-pre-wrap text-body text-muted">
              {proposal.reasoning_trace}
            </p>
            {proposal.resolution_note && (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3">
                <Eyebrow>Begründung</Eyebrow>
                <p className="mt-1 text-caption">{proposal.resolution_note}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="Änderungen" title={`${proposal.diff.length} Diff-Eintr${proposal.diff.length === 1 ? "ag" : "äge"}`}>
        <Stagger className="flex flex-col gap-3">
          {proposal.diff.map((op, idx) => (
            <StaggerItem key={idx}>
              <Card>
                <CardBody className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="neutral" size="sm">{op.op}</Pill>
                    <code className="break-all num-mono text-caption">{op.path}</code>
                  </div>
                  {op.human_de && <p className="text-body">{op.human_de}</p>}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <DiffPanel label="Vorher" content={fmtValue(op.before)} tone="down" />
                    <DiffPanel label="Nachher" content={fmtValue(op.after)} tone="up" />
                  </div>
                </CardBody>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {proposal.cited_data.length > 0 && (
        <Section eyebrow="Datenbasis" title={`${proposal.cited_data.length} Zitat${proposal.cited_data.length === 1 ? "" : "e"}`}>
          <Card variant="soft">
            <CardBody className="p-2">
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {proposal.cited_data.map((c, idx) => (
                  <li key={idx} className="flex h-12 items-center gap-3 px-3">
                    <Pill tone="neutral" size="sm">{c.kind}</Pill>
                    <code className="num-mono text-caption">{c.ref_id}</code>
                    <span className="flex-1 truncate text-body">{c.summary}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </Section>
      )}

      <Section eyebrow="Aktion" title="Annehmen oder ablehnen">
        <Card>
          <CardBody className="p-5">
            <ProposalActions proposalId={proposal.id} isPending={proposal.status === "pending"} />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function DiffPanel({ label, content, tone }: { label: string; content: string; tone: "up" | "down" }) {
  const color = tone === "up" ? "var(--color-activity)" : "var(--color-band-down)";
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <span className="eyebrow" style={{ color }}>
        {label}
      </span>
      <code className="whitespace-pre-wrap break-all num-mono text-caption">{content}</code>
    </div>
  );
}
