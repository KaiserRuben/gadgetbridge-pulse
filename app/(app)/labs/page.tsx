import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { loadLabs } from "@/lib/insights";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { IconBadge } from "@/components/ui/icon-badge";
import { Pill } from "@/components/ui/pill";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NumberTicker } from "@/components/motion/number-ticker";

const FEATURES = [
  { key: "cycle",              label: "Zyklus-Tracking",     hint: "Periode + Phasen" },
  { key: "training_load",      label: "Trainingslast",       hint: "TSS + Recovery-Index" },
  { key: "illness_watch",      label: "Krankheits-Watch",    hint: "RHR-Drift + Hauttemp + HRV" },
  { key: "similar_day_search", label: "Ähnliche Tage",       hint: "k-NN über Facts-Vektor" },
  { key: "meal_photo",         label: "Mahlzeit-Foto",       hint: "Vision-Modell + Makros" },
  { key: "voice_journal",      label: "Sprach-Journal",      hint: "Whisper + Tags" },
  { key: "ecg",                label: "EKG",                  hint: "1-Lead Auswertung" },
] as const;

export default async function LabsPage() {
  noStore();
  const labs = await loadLabs();
  const flags = (labs?.features ?? {}) as Record<string, boolean | undefined>;
  const activeCount = FEATURES.filter((f) => flags[f.key] === true).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Labs"
        title="Experimente"
        sub="Funktionen, die noch nicht stabil oder belastbar genug für die Hauptansicht sind."
        trailing={
          <div className="flex items-baseline gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-2)] px-3 py-1.5 ring-1 ring-inset ring-[var(--color-border)]">
            <NumberTicker value={activeCount} className="num text-title text-[var(--color-activity)]" />
            <span className="text-caption">von {FEATURES.length} aktiv</span>
          </div>
        }
      />

      <FadeRise>
        <Section eyebrow="Status">
          <Stagger className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {FEATURES.map((f) => {
              const enabled = flags[f.key] === true;
              return (
                <StaggerItem key={f.key}>
                  <Card variant={enabled ? "surface" : "soft"} hoverable>
                    <CardBody className="flex items-start gap-3 p-5">
                      <IconBadge
                        icon="FlaskConical"
                        tone={enabled ? "activity" : "neutral"}
                        size="sm"
                      />
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-title">{f.label}</span>
                          <Pill tone={enabled ? "up" : "low"} size="sm">
                            {enabled ? "aktiv" : "stub"}
                          </Pill>
                        </div>
                        <span className="text-caption">{f.hint}</span>
                      </div>
                    </CardBody>
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        </Section>
      </FadeRise>
    </div>
  );
}
