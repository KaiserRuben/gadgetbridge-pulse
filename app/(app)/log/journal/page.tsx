import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { readJournal } from "@/lib/journal";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { JournalForm } from "@/components/log/journal-form";
import { FadeRise } from "@/components/motion/fade-rise";
import { submitJournal } from "./actions";

export default async function JournalPage() {
  noStore();
  const recent = readJournal(undefined, 10);
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <PageHeader
        eyebrow="Log"
        title="Tagebuch"
        back={{ href: "/log", label: "Log" }}
      />

      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-6 lg:p-8">
            <JournalForm action={submitJournal} />
          </CardBody>
        </Card>
      </FadeRise>

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="flex flex-col gap-3 p-5">
            <Eyebrow>Verlauf</Eyebrow>
            <ul className="flex flex-col gap-3">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 border-b border-[var(--color-border)] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="num-mono text-caption">{fmt(r.ts_iso)}</span>
                    {r.mood != null && <Pill tone="steady" size="sm">{r.mood}/5</Pill>}
                  </div>
                  {r.text && <p className="text-body">{r.text}</p>}
                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((t) => <Pill key={t} tone="neutral" size="sm">{t}</Pill>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
