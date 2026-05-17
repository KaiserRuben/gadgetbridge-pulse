import "server-only";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { readManualLog } from "@/lib/manual-log";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph } from "@/components/ui/glyph";
import { WeightForm } from "@/components/log/weight-form";
import { Sparkline } from "@/components/charts/sparkline";
import { submitWeight } from "./actions";

export default async function WeightPage() {
  noStore();
  const recent = readManualLog("weight_kg", 30);
  const series = recent.map((r) => r.value).reverse();
  const latest = recent[0]?.value;

  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto w-full">
      <div className="flex items-center justify-between">
        <Link href="/log" className="text-caption text-muted hover:text-[var(--color-text)] flex items-center gap-1">
          <Glyph name="ChevronRight" size={14} className="rotate-180" />
          Log
        </Link>
        <Eyebrow>Gewicht</Eyebrow>
      </div>

      <Card glow="sleep">
        <CardBody className="p-6 lg:p-8">
          <WeightForm
            defaultValue={latest}
            recent={series.slice().reverse()}
            action={submitWeight}
          />
        </CardBody>
      </Card>

      {series.length > 1 && (
        <Card variant="soft">
          <CardBody className="p-5 flex items-center gap-5">
            <div className="flex flex-col gap-0.5">
              <Eyebrow>Zuletzt</Eyebrow>
              <span className="num text-[1.5rem] font-semibold">{latest?.toFixed(1)} kg</span>
            </div>
            <Sparkline values={series} tone="sleep" width={300} height={42} className="flex-1" />
          </CardBody>
        </Card>
      )}

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-2">
            <Eyebrow>Verlauf</Eyebrow>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-[0.875rem]">
                  <span className="num-mono text-caption">{fmt(r.ts_iso)}</span>
                  <span className="num">{r.value} {r.unit}</span>
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
