import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { readJournal } from "@/lib/journal";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { JournalForm } from "@/components/log/journal-form";
import { submitJournal } from "./actions";

export default async function JournalPage() {
  noStore();
  const recent = readJournal(undefined, 10);
  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto w-full">
      <div className="flex items-center justify-between">
        <Link href="/log" className="text-caption text-muted hover:text-[var(--color-text)] flex items-center gap-1">
          <Glyph name="ChevronRight" size={14} className="rotate-180" />
          Log
        </Link>
        <Eyebrow>Tagebuch</Eyebrow>
      </div>

      <Card glow="sleep">
        <CardBody className="p-6 lg:p-8">
          <JournalForm action={submitJournal} />
        </CardBody>
      </Card>

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-3">
            <Eyebrow>Verlauf</Eyebrow>
            <ul className="flex flex-col gap-3">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 pb-3 border-b border-[var(--color-border)] last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="num-mono text-caption">{fmt(r.ts_iso)}</span>
                    {r.mood != null && <Pill tone="steady" size="sm">{r.mood}/5</Pill>}
                  </div>
                  {r.text && <p className="text-[0.9375rem]">{r.text}</p>}
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
