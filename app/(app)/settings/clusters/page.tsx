import "server-only";

import { Card, CardBody } from "@/components/ui/card";
import { Glyph } from "@/components/ui/glyph";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Section } from "@/components/ui/section";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import {
  listRegisteredClustersWithCopy,
  readClusterMeta,
} from "@/lib/derived/registry";
import type { ClusterCopy } from "@/lib/derived/cluster-copy";

import { setAutoProcessForCluster } from "../_actions";
import {
  formatRelativeDe,
  readAutoProcessForCluster,
  readAutoProcessGlobal,
} from "../_data";
import { SettingsThreeWay } from "@/components/settings/SettingsToggle";

export const dynamic = "force-dynamic";

export default function ClustersSettingsPage() {
  const global = readAutoProcessGlobal();
  const clusters = listRegisteredClustersWithCopy();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Einstellungen"
        title="Auto-Verarbeitung pro Cluster"
        back={{ href: "/settings", label: "Einstellungen" }}
        sub={
          <>
            Globale Vorgabe:{" "}
            <Pill tone={global ? "up" : "low"} size="sm">
              {global ? "An" : "Aus"}
            </Pill>
            . Jeder Cluster kann individuell überschrieben werden. Stellung
            {" "}<span className="font-medium text-[var(--color-text)]">Global</span>{" "}
            folgt der je-Cluster Vorgabe (siehe Tooltip am Schalter).
          </>
        }
      />

      <FadeRise>
        <Section eyebrow="Cluster">
          {clusters.length === 0 ? (
            <Card variant="soft">
              <CardBody className="p-5 flex flex-col items-center gap-3 text-center">
                <Glyph
                  name="FlaskConical"
                  size={20}
                  className="text-subtle"
                />
                <p className="text-body-sm text-muted max-w-[40ch]">
                  Keine Cluster registriert. Migrationen folgen automatisch
                  beim nächsten Runner-Start.
                </p>
              </CardBody>
            </Card>
          ) : (
            <Stagger className="flex flex-col gap-2">
              {clusters.map(({ name, copy }) => (
                <StaggerItem key={name}>
                  <ClusterRow
                    name={name}
                    copy={copy}
                    value={readAutoProcessForCluster(name)}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </Section>
      </FadeRise>
    </div>
  );
}

function ClusterRow({
  name,
  copy,
  value,
}: {
  name: string;
  copy: ClusterCopy;
  value: "inherit" | "on" | "off";
}) {
  // Bind the cluster name into the action so the client component can
  // call it with just the new override value. Server actions accept
  // bound positional args + the client-supplied trailing args.
  const action = setAutoProcessForCluster.bind(null, name);
  const meta = readClusterMeta(name);
  const lastRunLabel = formatRelativeDe(meta.lastUpdatedAt);
  const historyLabel =
    meta.historyCount > 0
      ? meta.historyCount === 1
        ? "1 Eintrag"
        : `${meta.historyCount} Einträge`
      : "kein Verlauf";
  const hasError = meta.lastStatus === "partial" || !!meta.lastError;
  const globalTooltip = copy.autoProcessDefault
    ? "Global folgt dem Cluster-Default: automatisch."
    : "Global folgt dem Cluster-Default: deaktiviert.";

  return (
    <SettingsThreeWay
      label={copy.label}
      description={copy.description}
      meta={
        <span className="inline-flex items-center gap-1.5 text-caption text-subtle">
          {hasError && (
            <span
              role="img"
              aria-label="Letzter Lauf fehlgeschlagen"
              title={
                meta.lastError ?? "Letzter Lauf fehlgeschlagen"
              }
              className="inline-block size-1.5 rounded-full bg-[var(--color-tier-s1)]"
            />
          )}
          <span>zuletzt: {lastRunLabel}</span>
          <span aria-hidden className="opacity-50">·</span>
          <span>{historyLabel}</span>
        </span>
      }
      tooltips={{ inherit: globalTooltip }}
      value={value}
      onChange={action}
    />
  );
}
