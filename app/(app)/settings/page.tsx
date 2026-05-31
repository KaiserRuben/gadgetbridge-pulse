import Link from "next/link";

import { PushSubscribe } from "@/components/pwa/push-subscribe";
import { Card, CardBody } from "@/components/ui/card";
import { Glyph } from "@/components/ui/glyph";
import { Section } from "@/components/ui/section";
import {
  countConfiguredClusterOverrides,
  listRegisteredClustersWithCopy,
} from "@/lib/derived/registry";

import { setAutoProcessGlobal, setCriticEnabled } from "./_actions";
import { readAutoProcessGlobal, readCriticEnabled } from "./_data";
import { SettingsToggle } from "@/components/settings/SettingsToggle";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const autoProcess = readAutoProcessGlobal();
  const critic = readCriticEnabled();
  const clusters = listRegisteredClustersWithCopy();
  const overrideCount = countConfiguredClusterOverrides();
  // Preview the first three German display names so the entry-card hints at
  // what lives behind it. listRegisteredClustersWithCopy() is already sorted
  // by cluster name; take the first three for stability across renders.
  const previewLabels = clusters.slice(0, 3).map((c) => c.copy.label);
  const remaining = Math.max(0, clusters.length - previewLabels.length);

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <Section eyebrow="Einstellungen" title="Benachrichtigungen">
        <div className="flex flex-col gap-3">
          <PushSubscribe />
          <Link href="/settings/notifications" className="block">
            <Card hoverable>
              <CardBody className="p-4 flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[0.9375rem] font-medium">
                    Topics, Ruhezeiten, Tageslimit
                  </span>
                  <span className="text-caption text-muted">
                    Welche Ereignisse benachrichtigen, wann ruhig bleiben, wie oft maximal — plus letzte Aktivität.
                  </span>
                </div>
                <Glyph name="ChevronRight" className="text-muted shrink-0" />
              </CardBody>
            </Card>
          </Link>
        </div>
      </Section>

      <Section eyebrow="Einstellungen" title="KI-Verhalten">
        <div className="flex flex-col gap-3">
          <SettingsToggle
            label="Auto-Verarbeitung (global)"
            description="Neue Versionen automatisch berechnen wenn sich Daten ändern."
            checked={autoProcess}
            onAction={setAutoProcessGlobal}
          />

          <Link href="/settings/clusters" className="block">
            <Card hoverable>
              <CardBody className="p-4 flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[0.9375rem] font-medium">
                      Pro Cluster anpassen
                    </span>
                    <span className="text-caption text-muted">
                      Auto-Verarbeitung pro Domäne überschreiben.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-subtle">
                    <span
                      aria-hidden
                      className="inline-block size-1.5 rounded-full bg-[var(--color-band-up)]"
                    />
                    <span className="num-mono">
                      {clusters.length}
                    </span>
                    <span>
                      Cluster registriert
                    </span>
                    {overrideCount > 0 && (
                      <>
                        <span aria-hidden className="opacity-60">·</span>
                        <span className="num-mono">{overrideCount}</span>
                        <span>konfiguriert</span>
                      </>
                    )}
                  </div>
                  {previewLabels.length > 0 && (
                    <p className="text-caption text-muted leading-relaxed truncate">
                      {previewLabels.join(" · ")}
                      {remaining > 0 && (
                        <span className="text-subtle"> · +{remaining}</span>
                      )}
                    </p>
                  )}
                </div>
                <Glyph
                  name="ChevronRight"
                  size={16}
                  className="text-subtle shrink-0 mt-1"
                />
              </CardBody>
            </Card>
          </Link>

          <SettingsToggle
            label="Kritik-Modell (Experte)"
            description="Zweiter LLM-Lauf nach jeder Prosa-Generierung für Qualitätsprüfung."
            checked={critic}
            onAction={setCriticEnabled}
          />
        </div>
      </Section>
    </div>
  );
}
