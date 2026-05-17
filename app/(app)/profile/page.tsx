import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { getUser, getDevice } from "@/lib/queries/profile";
import { loadPauseState } from "@/lib/insights";

import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";

export default async function ProfilePage() {
  noStore();
  const [user, device, pause] = await Promise.all([
    Promise.resolve(safeGet(getUser)),
    Promise.resolve(safeGet(getDevice)),
    loadPauseState(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center size-12 rounded-2xl bg-gradient-to-br from-[var(--color-sleep)] to-[var(--color-sleep-2)]">
            <Glyph name="User" size={20} className="text-white" />
          </span>
          <div className="flex flex-col gap-0.5">
            <Eyebrow>Profil</Eyebrow>
            <h1 className="text-hero">{user?.name ?? "—"}</h1>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {pause?.paused && <Pill tone="down">Pausiert</Pill>}
          {pause?.i_feel_fine && <Pill tone="up">Mir geht's gut</Pill>}
        </div>
      </div>

      <Section eyebrow="Identität">
        <Card>
          <CardBody className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Alter" value={user ? Math.round(user.ageYears) : "—"} unit="J" />
            <Stat label="Größe" value={user?.heightCm ?? "—"} unit="cm" />
            <Stat label="Gewicht" value={user?.weightKg ? user.weightKg.toFixed(1) : "—"} unit="kg" />
            <Stat label="Schritt-Ziel" value={user?.stepGoal?.toLocaleString() ?? "—"} />
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Gerät">
        <Card variant="soft">
          <CardBody className="p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Glyph name="Activity" size={16} className="text-subtle" />
              <span className="text-[0.9375rem] font-medium">{device?.name ?? "—"}</span>
              <span className="text-caption">{device?.manufacturer} · {device?.model}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-caption">
              <div className="flex justify-between"><span className="text-subtle">ID</span><span className="num-mono">{device?.identifier ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-subtle">Firmware</span><span className="num-mono">{device?.firmware ?? "—"}</span></div>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section eyebrow="Aktionen">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Link href="/log/weight">
            <Card hoverable>
              <CardBody className="p-5 flex items-center gap-3">
                <Glyph name="PenLine" size={16} className="text-subtle" />
                <span>Gewicht aktualisieren</span>
              </CardBody>
            </Card>
          </Link>
          <Link href="/labs">
            <Card hoverable>
              <CardBody className="p-5 flex items-center gap-3">
                <Glyph name="FlaskConical" size={16} className="text-subtle" />
                <span>Experimente</span>
              </CardBody>
            </Card>
          </Link>
          <Link href="/alarms">
            <Card hoverable>
              <CardBody className="p-5 flex items-center gap-3">
                <Glyph name="Bell" size={16} className="text-subtle" />
                <span>Signale</span>
              </CardBody>
            </Card>
          </Link>
        </div>
      </Section>
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
