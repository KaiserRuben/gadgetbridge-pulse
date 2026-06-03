import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { getUser, getDevice } from "@/lib/queries/profile";
import { loadPauseState } from "@/lib/insights";
import { readManualLog } from "@/lib/manual-log";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Pill } from "@/components/ui/pill";
import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { IconBadge } from "@/components/ui/icon-badge";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { NumberTicker } from "@/components/motion/number-ticker";

const ACTIONS: { href: string; icon: GlyphName; label: string }[] = [
  { href: "/log/weight", icon: "PenLine", label: "Gewicht aktualisieren" },
  { href: "/labs", icon: "FlaskConical", label: "Experimente" },
  { href: "/alarms", icon: "Bell", label: "Signale" },
];

export default async function ProfilePage() {
  noStore();
  const [user, device, pause] = await Promise.all([
    Promise.resolve(safeGet(getUser)),
    Promise.resolve(safeGet(getDevice)),
    loadPauseState(),
  ]);
  const latestWeightKg = readManualLog("weight_kg", 1)[0]?.value ?? user?.weightKg ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Profil"
        title={
          <span className="flex items-center gap-3">
            <IconBadge icon="User" tone="sleep" size="lg" variant="solid" />
            {user?.name ?? "—"}
          </span>
        }
        trailing={
          pause?.paused || pause?.i_feel_fine ? (
            <div className="flex flex-col items-end gap-2">
              {pause?.paused && <Pill tone="down">Pausiert</Pill>}
              {pause?.i_feel_fine && <Pill tone="up">Mir geht&apos;s gut</Pill>}
            </div>
          ) : null
        }
      />

      <FadeRise>
        <Section eyebrow="Identität">
          <Card>
            <CardBody className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4">
              <Stat label="Alter" value={user ? Math.round(user.ageYears) : "—"} unit="J" />
              <Stat label="Größe" value={user?.heightCm ?? "—"} unit="cm" />
              <Stat
                label="Gewicht"
                value={
                  latestWeightKg != null ? (
                    <NumberTicker value={latestWeightKg} decimals={1} />
                  ) : (
                    "—"
                  )
                }
                unit="kg"
              />
              <Stat label="Schritt-Ziel" value={user?.stepGoal?.toLocaleString() ?? "—"} />
            </CardBody>
          </Card>
        </Section>
      </FadeRise>

      <FadeRise delay={0.05}>
        <Section eyebrow="Gerät">
          <Card variant="soft">
            <CardBody className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <IconBadge icon="Activity" tone="activity" size="sm" />
                <span className="text-body font-medium">{device?.name ?? "—"}</span>
                <span className="text-caption">{device?.manufacturer} · {device?.model}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-caption">
                <div className="flex justify-between">
                  <span className="text-subtle">ID</span>
                  <span className="num-mono">{device?.identifier ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">Firmware</span>
                  <span className="num-mono">{device?.firmware ?? "—"}</span>
                </div>
              </div>
            </CardBody>
          </Card>
        </Section>
      </FadeRise>

      <FadeRise delay={0.1}>
        <Section eyebrow="Aktionen">
          <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {ACTIONS.map((action) => (
              <StaggerItem key={action.href}>
                <Link href={action.href} className="block">
                  <Card hoverable>
                    <CardBody className="flex items-center gap-3 p-5">
                      <IconBadge icon={action.icon} tone="neutral" size="sm" />
                      <span className="text-body">{action.label}</span>
                      <Glyph
                        name="ArrowRight"
                        size={16}
                        className="ml-auto text-[var(--color-text-faint)]"
                      />
                    </CardBody>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      </FadeRise>
    </div>
  );
}

function safeGet<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
