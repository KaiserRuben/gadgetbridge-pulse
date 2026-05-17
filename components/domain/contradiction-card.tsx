import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import type { SynthesisContradiction } from "@/lib/types/v3";

const DOMAIN_LABEL_DE: Record<"sleep" | "recovery" | "activity", string> = {
  sleep: "Schlaf",
  recovery: "Erholung",
  activity: "Aktivität",
};

/** Renders one contradiction from daily_v3.contradictions. */
export function ContradictionCard({
  contradiction,
}: {
  contradiction: SynthesisContradiction;
}) {
  return (
    <Card glow="stress">
      <CardBody className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Eyebrow>🔁 Konflikt erkannt</Eyebrow>
          {contradiction.domains.map((d) => (
            <Pill key={d} tone="low" size="sm">
              {DOMAIN_LABEL_DE[d]}
            </Pill>
          ))}
        </div>
        <p className="text-body-sm">{contradiction.conflict}</p>
        <p className="text-body-sm text-muted">
          <span className="text-caption uppercase tracking-wide block mb-1">
            Auflösung
          </span>
          {contradiction.resolution}
        </p>
      </CardBody>
    </Card>
  );
}
