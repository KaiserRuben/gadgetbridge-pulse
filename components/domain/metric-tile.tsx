import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Sparkline } from "@/components/charts/sparkline";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body";

const toneStyles: Record<Tone, { color: string }> = {
  sleep:    { color: "var(--color-sleep)" },
  heart:    { color: "var(--color-heart)" },
  activity: { color: "var(--color-activity)" },
  stress:   { color: "var(--color-stress)" },
  body:     { color: "var(--color-temp)" },
};

/**
 * Compact metric tile: ~96px tall, big number left, sparkline right, delta
 * chip below. Fits 2 across on phones, 4 across on desktop. Tap → domain
 * detail page.
 */
export function MetricTile({
  href,
  eyebrow,
  icon,
  value,
  unit,
  delta,
  hint,
  series,
  tone,
}: {
  href: string;
  eyebrow: string;
  icon: GlyphName;
  value: string | number;
  unit?: string;
  delta?: { value: number; suffix?: string } | null;
  hint?: string;
  series: number[];
  tone: Tone;
}) {
  const styles = toneStyles[tone];
  return (
    <Link href={href} className="block group">
      <Card hoverable className="cursor-pointer h-full">
        <CardBody className="flex flex-col gap-1.5 p-3 md:p-4 min-h-[96px]">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow className="truncate">{eyebrow}</Eyebrow>
            <Glyph name={icon} size={14} style={{ color: styles.color }} className="opacity-80 shrink-0" />
          </div>
          <div className="flex items-end justify-between gap-2 flex-1">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="num text-[1.5rem] md:text-[1.75rem] font-semibold tracking-[-0.02em] leading-none">
                  {value}
                </span>
                {unit && <span className="text-subtle text-[0.625rem] md:text-[0.6875rem] num-mono">{unit}</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {delta && <DeltaChip delta={delta} />}
                {hint && <span className="text-caption truncate hidden md:inline">{hint}</span>}
              </div>
            </div>
            <Sparkline values={series} tone={tone} width={56} height={24} />
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

function DeltaChip({ delta }: { delta: { value: number; suffix?: string } }) {
  const sign = delta.value > 0 ? "+" : delta.value < 0 ? "−" : "±";
  const tone =
    delta.value > 0
      ? "bg-[hsl(195_50%_18%)] text-[var(--color-band-up)]"
      : delta.value < 0
        ? "bg-[hsl(38_50%_18%)] text-[var(--color-band-down)]"
        : "bg-[hsl(220_18%_18%)] text-[var(--color-band-steady)]";
  return (
    <span
      className={`num-mono inline-flex items-center px-1.5 h-4 rounded-[var(--radius-pill)] text-[0.625rem] ${tone}`}
    >
      {sign}
      {Math.abs(delta.value)}
      {delta.suffix ?? ""}
    </span>
  );
}
