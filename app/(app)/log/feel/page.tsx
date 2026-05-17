import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { readFeel } from "@/lib/feel";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { Pill } from "@/components/ui/pill";
import { FeelForm } from "@/components/log/feel-form";
import { submitFeel } from "./actions";

export default async function FeelPage() {
  noStore();
  const recent = readFeel(undefined, 8);
  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto w-full">
      <div className="flex items-center justify-between">
        <Link href="/log" className="text-caption text-muted hover:text-[var(--color-text)] flex items-center gap-1">
          <Glyph name="ChevronRight" size={14} className="rotate-180" />
          Log
        </Link>
        <Eyebrow>Stimmung</Eyebrow>
      </div>

      <Card glow="sleep">
        <CardBody className="p-6 lg:p-8">
          <FeelForm action={submitFeel} />
        </CardBody>
      </Card>

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-2">
            <Eyebrow>Letzte Einträge</Eyebrow>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-[0.875rem]">
                  <span className="num-mono text-caption">{fmt(r.ts_iso)}</span>
                  <Pill tone={r.feel >= 4 ? "up" : r.feel <= 2 ? "down" : "steady"} size="sm">{r.feel}</Pill>
                  <span className="text-caption truncate flex-1 ml-3">{r.note}</span>
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
