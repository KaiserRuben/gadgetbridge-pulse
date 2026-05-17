import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { SynthesisDomainPointer, Band } from "@/lib/types/v3";

const DOMAIN_PATH: Record<SynthesisDomainPointer["domain"], string> = {
  sleep: "/sleep",
  recovery: "/recovery",
  activity: "/activity",
};

/**
 * Drill-down launchpad card per domain.
 * Reads one entry from daily_v3.domain_pointers.
 * Whole card is a tap target → /[domain]/[date].
 */
export function DomainPointerCard({
  pointer,
  date,
}: {
  pointer: SynthesisDomainPointer;
  date: string;
}) {
  const href = `${DOMAIN_PATH[pointer.domain]}/${date}`;
  const tone = bandTone(pointer.kpi_band);
  return (
    <Link
      href={href}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card glow={bandGlow(pointer.kpi_band)} className="transition-shadow group-hover:shadow-lg">
        <CardBody className="p-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-h4 font-medium">{pointer.label_de}</h3>
            <span className="num text-h3 font-semibold tabular-nums">
              {pointer.kpi_value}
            </span>
          </div>
          <Pill tone={tone} size="sm">
            {bandLabel(pointer.kpi_band)}
          </Pill>
          <p className="text-body-sm text-muted">{pointer.callout}</p>
          <span className="text-caption text-muted opacity-60 group-hover:opacity-100 transition-opacity mt-1">
            Detail öffnen →
          </span>
        </CardBody>
      </Card>
    </Link>
  );
}

function bandLabel(b: Band): string {
  return b === "above_usual" ? "Über Normal" : b === "below_usual" ? "Unter Normal" : "Stabil";
}

function bandTone(b: Band): "up" | "down" | "steady" {
  return b === "above_usual" ? "up" : b === "below_usual" ? "down" : "steady";
}

function bandGlow(b: Band): "activity" | "stress" | "sleep" {
  return b === "above_usual" ? "activity" : b === "below_usual" ? "stress" : "sleep";
}
