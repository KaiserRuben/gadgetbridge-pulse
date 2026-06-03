"use client";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { IconBadge } from "@/components/ui/icon-badge";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { CaptureBody } from "@/components/nutrition/MealCaptureSheet";

/**
 * /nutrition/log — full-page capture flow. Surfaces:
 *   - PWA camera input (`capture="environment"`) via the hidden file input
 *     inside CaptureBody.
 *   - Drag-and-drop fallback for desktop.
 *   - Optional text field always visible alongside the photo.
 *   - Optional meal_at override (datetime-local).
 *   - Submit shows an optimistic placeholder; real ingest is wired later.
 */
export default function NutritionLogPage() {
  return (
    <div className="flex flex-col gap-6 max-w-[800px] mx-auto w-full">
      <PageHeader
        eyebrow="Mahlzeit erfassen"
        title="Foto oder Text. Beides geht auch."
        sub="Der Klassifizierer läuft asynchron auf dem Mac. Du kannst nach dem Upload sofort weiterarbeiten — Komponenten erscheinen, sobald sie fertig sind."
        back={{ href: "/nutrition", label: "Übersicht" }}
      />

      <FadeRise>
        <Card glow="nutrition">
          <CardBody className="p-5 lg:p-6">
            <CaptureBody large />
          </CardBody>
        </Card>
      </FadeRise>

      <Section eyebrow="So funktioniert es" title="Drei Schritte">
        <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-3" step={0.05}>
          <Step
            n="1"
            icon="Camera"
            title="Foto"
            body="Schnappschuss vom Teller. Format egal (JPEG/PNG/WebP/HEIC). qwen3.6 vision verarbeitet alles direkt."
          />
          <Step
            n="2"
            icon="Sparkles"
            title="Klassifizierung"
            body="VLM erkennt Komponenten, schätzt Portionen. Optional fließt dein Text als starker Hinweis ein."
          />
          <Step
            n="3"
            icon="PenLine"
            title="Prüfen"
            body="Mahlzeit ist Entwurf bis du sie aufmachst. Korrekturen werden als Revisionen protokolliert."
          />
        </Stagger>
      </Section>

      <Section eyebrow="Tipps" title="Wenn die Schätzung daneben liegt">
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-3 text-body-sm">
            <Tip
              left={<Pill tone="nutrition" size="sm">Foto</Pill>}
              body={
                <>
                  Referenzobjekt mit drauf: Gabel, Hand, Teller-Rand. Modell schätzt Portionen
                  damit deutlich genauer.
                </>
              }
            />
            <Tip
              left={<Pill tone="up" size="sm">Text</Pill>}
              body={
                <>
                  Wenn du es genau weißt, schreib es rein.{" "}
                  <span className="num-mono text-[0.8125rem]">„200 g Butter"</span> oder{" "}
                  <span className="num-mono text-[0.8125rem]">„share-plate, ⅓ gegessen"</span> überschreibt
                  die Schätzung.
                </>
              }
            />
            <Tip
              left={<Pill tone="steady" size="sm">Mehrgang</Pill>}
              body={
                <>
                  Ein Foto = eine Mahlzeit. Beim Mehrgang machst du einfach mehrere Fotos —
                  das Tages-Cluster erkennt das Muster automatisch.
                </>
              }
            />
            <Tip
              left={<Pill tone="s2" size="sm">Niedrige Konfidenz</Pill>}
              body={
                <>
                  Komponenten unter 50% Konfidenz werden mit{" "}
                  <span className="text-[var(--color-tier-s2)]">„prüfen"</span> markiert. Greif ein, wenn was
                  Wichtiges falsch ist — kleine Abweichungen sind okay.
                </>
              }
            />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Datenschutz" title="Wo das Foto bleibt">
        <Card variant="soft">
          <CardBody className="p-4 flex items-start gap-3">
            <IconBadge icon="Compass" tone="neutral" size="sm" />
            <p className="text-caption text-muted">
              Foto landet im lokalen Syncthing-Share zwischen Pi und Mac. Keine Cloud, keine
              Drittanbieter. Pro Mahlzeit kannst du das Foto explizit löschen — Komponenten
              bleiben erhalten, falls du willst.
            </p>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: Parameters<typeof Glyph>[0]["name"];
  title: string;
  body: string;
}) {
  return (
    <StaggerItem className="h-full">
      <Card variant="flat" hoverable className="h-full">
        <CardBody className="p-4 flex flex-col gap-2 h-full">
          <div className="flex items-center justify-between">
            <span className="num-mono text-caption text-subtle">{n}</span>
            <Glyph name={icon} size={16} className="text-[var(--color-nutrition)]" />
          </div>
          <span className="text-title">{title}</span>
          <span className="text-caption text-muted">{body}</span>
        </CardBody>
      </Card>
    </StaggerItem>
  );
}

function Tip({ left, body }: { left: React.ReactNode; body: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 pt-0.5">{left}</div>
      <p className="flex-1 text-muted">{body}</p>
    </div>
  );
}
