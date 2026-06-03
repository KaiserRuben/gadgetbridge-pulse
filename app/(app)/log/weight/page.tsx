import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { readManualLog } from "@/lib/manual-log";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { WeightForm } from "@/components/log/weight-form";
import { Sparkline } from "@/components/charts/sparkline";
import { FadeRise } from "@/components/motion/fade-rise";
import { NumberTicker } from "@/components/motion/number-ticker";
import { submitWeight } from "./actions";

export default async function WeightPage() {
  noStore();
  const recent = readManualLog("weight_kg", 30);
  const series = recent.map((r) => r.value).reverse();
  const latest = recent[0]?.value;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <PageHeader
        eyebrow="Log"
        title="Gewicht"
        back={{ href: "/log", label: "Log" }}
      />

      <FadeRise>
        <Card glow="sleep">
          <CardBody className="p-6 lg:p-8">
            <WeightForm
              defaultValue={latest}
              recent={series.slice().reverse()}
              action={submitWeight}
            />
          </CardBody>
        </Card>
      </FadeRise>

      {series.length > 1 && (
        <Card variant="soft">
          <CardBody className="flex items-center gap-5 p-5">
            <div className="flex flex-col gap-0.5">
              <Eyebrow>Zuletzt</Eyebrow>
              <span className="flex items-baseline gap-1">
                {latest != null ? (
                  <NumberTicker
                    value={latest}
                    decimals={1}
                    className="num text-h2"
                  />
                ) : null}
                <span className="num-mono text-subtle text-body-sm">kg</span>
              </span>
            </div>
            <Sparkline values={series} tone="sleep" width={300} height={42} className="flex-1" />
          </CardBody>
        </Card>
      )}

      {recent.length > 0 && (
        <Card variant="soft">
          <CardBody className="flex flex-col gap-2 p-5">
            <Eyebrow>Verlauf</Eyebrow>
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.slice(0, 8).map((r) => (
                <li key={r.id} className="text-body flex items-center justify-between py-2">
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
