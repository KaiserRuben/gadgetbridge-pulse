import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";

type Tone = "sleep" | "heart" | "activity" | "stress" | "body";

const toneColor: Record<Tone, string> = {
  sleep: "var(--color-sleep)",
  heart: "var(--color-heart)",
  activity: "var(--color-activity)",
  stress: "var(--color-stress)",
  body: "var(--color-temp)",
};

/**
 * Two-window comparison. Side-by-side bar pair + delta chip. Used for
 * "this week vs last week", "today vs same-DoW avg", "this month vs prior".
 *
 * Self-scaling: bars are normalised against max(current, previous) so the
 * relative shape is honest even when absolute values vary 10×. Empty / null
 * values render as a thin placeholder bar at 4px.
 */
export function ComparisonCard({
  eyebrow,
  title,
  icon,
  tone,
  current,
  previous,
  unit,
  format = (n) => n.toFixed(0),
  href,
  comparisonLabel,
}: {
  eyebrow: string;
  title: string;
  icon: GlyphName;
  tone: Tone;
  current: { label: string; value: number | null };
  previous: { label: string; value: number | null };
  unit?: string;
  format?: (n: number) => string;
  href?: string;
  /** e.g. "vs. Vorwoche" — appears above the delta chip */
  comparisonLabel?: string;
}) {
  const a = current.value ?? null;
  const b = previous.value ?? null;
  const max = Math.max(a ?? 0, b ?? 0, 1);
  const aPct = a != null ? Math.max(4, Math.round((a / max) * 100)) : 4;
  const bPct = b != null ? Math.max(4, Math.round((b / max) * 100)) : 4;

  const delta = a != null && b != null ? a - b : null;
  const deltaPct = delta != null && b !== 0 && b != null ? (delta / b) * 100 : null;
  const deltaTone: "up" | "down" | "steady" =
    delta == null || delta === 0 ? "steady" : delta > 0 ? "up" : "down";
  const deltaSign = delta == null ? "" : delta > 0 ? "+" : delta < 0 ? "−" : "";

  const Body = (
    <Card hoverable={!!href} className="h-full">
      <CardBody className="p-4 md:p-5 flex flex-col gap-3 h-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Glyph name={icon} size={14} style={{ color: toneColor[tone] }} className="opacity-90 shrink-0" />
            <Eyebrow className="truncate">{eyebrow}</Eyebrow>
          </div>
          {comparisonLabel && <span className="text-caption truncate">{comparisonLabel}</span>}
        </div>

        <h3 className="text-title leading-tight">{title}</h3>

        <div className="grid grid-cols-2 gap-3">
          <Bar
            label={current.label}
            value={a}
            unit={unit}
            format={format}
            heightPct={aPct}
            tone={tone}
            primary
          />
          <Bar
            label={previous.label}
            value={b}
            unit={unit}
            format={format}
            heightPct={bPct}
            tone={tone}
          />
        </div>

        {delta != null && (
          <div className="flex items-center gap-2 mt-auto">
            <Pill tone={deltaTone} size="sm" className="num-mono">
              {deltaSign}
              {format(Math.abs(delta))}
              {unit ? ` ${unit}` : ""}
            </Pill>
            {deltaPct != null && Number.isFinite(deltaPct) && (
              <span className="text-caption num-mono">
                {deltaSign}
                {Math.abs(deltaPct).toFixed(deltaPct > 10 ? 0 : 1)}%
              </span>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {Body}
    </Link>
  ) : (
    Body
  );
}

function Bar({
  label,
  value,
  unit,
  format,
  heightPct,
  tone,
  primary = false,
}: {
  label: string;
  value: number | null;
  unit?: string;
  format: (n: number) => string;
  heightPct: number;
  tone: Tone;
  primary?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5 min-h-[44px] justify-end">
        <div
          className="w-full rounded-md transition-all duration-300"
          style={{
            height: `${Math.min(heightPct, 100) * 0.4}px`,
            background: primary
              ? toneColor[tone]
              : `color-mix(in oklab, ${toneColor[tone]} 35%, transparent)`,
          }}
        />
      </div>
      <div className="flex flex-col gap-0">
        <span className="text-caption">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className="num text-[1.125rem] font-semibold leading-none">
            {value != null ? format(value) : "—"}
          </span>
          {unit && value != null && (
            <span className="text-subtle text-[0.6875rem] num-mono">{unit}</span>
          )}
        </div>
      </div>
    </div>
  );
}
