import "server-only";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Section } from "@/components/ui/section";

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
    <div className="flex flex-col gap-8">
      <Card glow="activity">
        <CardBody className="p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Eyebrow>Vorschlag #{proposal.id} · {fmtDateTime(proposal.generated_at)}</Eyebrow>
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
          {proposal.summary_de && <h1 className="text-hero">{proposal.summary_de}</h1>}
          <p className="text-body text-muted max-w-[64ch] whitespace-pre-wrap">
            {proposal.reasoning_trace}
          </p>
          {proposal.resolution_note && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3">
              <Eyebrow>Begründung</Eyebrow>
              <p className="text-caption mt-1">{proposal.resolution_note}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Section eyebrow="Änderungen" title={`${proposal.diff.length} Diff-Eintr${proposal.diff.length === 1 ? "ag" : "äge"}`}>
        <div className="flex flex-col gap-3">
          {proposal.diff.map((op, idx) => (
            <Card key={idx}>
              <CardBody className="p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill tone="neutral" size="sm">{op.op}</Pill>
                  <code className="text-caption num-mono break-all">{op.path}</code>
                </div>
                {op.human_de && <p className="text-[0.9375rem]">{op.human_de}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <DiffPanel label="Vorher" content={fmtValue(op.before)} tone="down" />
                  <DiffPanel label="Nachher" content={fmtValue(op.after)} tone="up" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      {proposal.cited_data.length > 0 && (
        <Section eyebrow="Datenbasis" title={`${proposal.cited_data.length} Zitat${proposal.cited_data.length === 1 ? "" : "e"}`}>
          <Card variant="soft">
            <CardBody className="p-3">
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {proposal.cited_data.map((c, idx) => (
                  <li key={idx} className="flex items-center gap-3 px-3 h-12">
                    <Pill tone="neutral" size="sm">{c.kind}</Pill>
                    <code className="text-caption num-mono">{c.ref_id}</code>
                    <span className="flex-1 truncate text-[0.9375rem]">{c.summary}</span>
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

      <div>
        <Link href="/training/proposals" className="text-caption text-muted hover:text-[var(--color-text)]">
          ← Alle Vorschläge
        </Link>
      </div>
    </div>
  );
}

function DiffPanel({ label, content, tone }: { label: string; content: string; tone: "up" | "down" }) {
  const color = tone === "up" ? "var(--color-activity)" : "var(--color-warn,#b76e00)";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 flex flex-col gap-1">
      <span className="text-faint text-[0.6875rem] uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
      <code className="text-caption num-mono whitespace-pre-wrap break-all">{content}</code>
    </div>
  );
}
