import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import type { SynthesisTopAction } from "@/lib/types/v3";

const SOURCE_LABEL_DE: Record<SynthesisTopAction["source_domain"], string> = {
  sleep: "Schlaf",
  recovery: "Erholung",
  activity: "Aktivität",
  cross_domain: "Cross-Domain",
};

const HORIZON_LABEL_DE: Record<SynthesisTopAction["horizon"], string> = {
  today: "heute",
  tonight: "heute Abend",
};

/**
 * Single highest-priority action across all domains.
 * Reads daily_v3.top_action_today.
 */
export function TopActionCard({ action }: { action: SynthesisTopAction }) {
  return (
    <Card glow="activity">
      <CardBody className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Eyebrow>Top Aktion {HORIZON_LABEL_DE[action.horizon]}</Eyebrow>
          <Pill tone="low" size="sm">
            {SOURCE_LABEL_DE[action.source_domain]}
          </Pill>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-caption text-muted">⚓ {action.anchor}</p>
          <p className="text-h3 font-semibold leading-snug">{action.tiny}</p>
          <p className="text-body-sm text-muted">{action.why}</p>
        </div>
      </CardBody>
    </Card>
  );
}
