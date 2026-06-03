import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { readFeel } from "@/lib/feel";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { FeelForm } from "@/components/log/feel-form";
import { FadeRise } from "@/components/motion/fade-rise";
import { submitFeel } from "./actions";

export default async function FeelPage() {
  noStore();
  const recent = readFeel(undefined, 8);
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <PageHeader
        eyebrow="Log"
        title="Stimmung"
        back={{ href: "/log", label: "Log" }}
      />

      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-6 lg:p-8">
            <FeelForm action={submitFeel} />
          </CardBody>
        </Card>
      </FadeRise>

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="flex flex-col gap-2 p-5">
            <Eyebrow>Letzte Einträge</Eyebrow>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((r) => (
                <li key={r.id} className="text-body flex items-center justify-between py-2">
                  <span className="num-mono text-caption">{fmt(r.ts_iso)}</span>
                  <Pill tone={r.feel >= 4 ? "up" : r.feel <= 2 ? "down" : "steady"} size="sm">{r.feel}</Pill>
                  <span className="text-caption ml-3 flex-1 truncate">{r.note}</span>
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
