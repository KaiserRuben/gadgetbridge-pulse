import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { loadLabs } from "@/lib/insights";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";

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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Eyebrow>Labs</Eyebrow>
        <h1 className="text-hero">Experimente</h1>
        <p className="text-body text-muted max-w-[60ch]">
          Funktionen, die noch nicht stabil oder belastbar genug für die Hauptansicht sind.
        </p>
      </div>

      <Section eyebrow="Status">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {FEATURES.map((f) => {
            const enabled = flags[f.key] === true;
            return (
              <Card key={f.key} variant={enabled ? "surface" : "soft"}>
                <CardBody className="p-5 flex items-start gap-3">
                  <span className="grid place-items-center size-9 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                    <Glyph name="FlaskConical" size={16} className={enabled ? "text-[var(--color-activity)]" : "text-subtle"} />
                  </span>
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.9375rem] font-medium">{f.label}</span>
                      <Pill tone={enabled ? "up" : "low"} size="sm">{enabled ? "aktiv" : "stub"}</Pill>
                    </div>
                    <span className="text-caption">{f.hint}</span>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
