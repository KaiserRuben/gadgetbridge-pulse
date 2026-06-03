import { PushSubscribe } from "@/components/pwa/push-subscribe";
import { BudgetMeter } from "@/components/notifications/budget-meter";
import { NotificationHistoryList } from "@/components/notifications/history-list";
import { TopicToggle } from "@/components/notifications/topic-toggle";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { SettingsToggle } from "@/components/settings/SettingsToggle";
import type { NotifyTopic } from "@/lib/notifications/types";

import {
  sendTestNotify,
  toggleMaster,
  toggleTopic,
} from "./_actions";
import { readNotificationsSettings } from "./_data";

export const dynamic = "force-dynamic";

interface TopicMeta {
  topic: NotifyTopic;
  label: string;
  description: string;
}

const TOPICS: TopicMeta[] = [
  {
    topic: "day_finalized",
    label: "Tag fertig",
    description: "Verdict-Headline + Hauptbeobachtung, sobald der Tag verarbeitet ist.",
  },
  {
    topic: "sleep_complete",
    label: "Schlaf erkannt",
    description: "Schlaf-Score und Phasen, kurz nach dem Aufwachen.",
  },
  {
    topic: "workout_complete",
    label: "Workout abgeschlossen",
    description: "Dauer, Distanz, aktive kcal — ca. 15 min nach Ende.",
  },
  {
    topic: "meal_classified",
    label: "Mahlzeit erkannt",
    description: "Sobald ein Foto klassifiziert wurde — Name, kcal, Protein.",
  },
  {
    topic: "pattern_detected",
    label: "Muster erkannt",
    description: "Selten: wenn ein wiederkehrendes Muster über mehrere Tage stabil ist.",
  },
  {
    topic: "safety_anomaly",
    label: "Sicherheitshinweis",
    description: "S1-Beobachtungen (z.B. HR auffällig). Ignoriert Ruhezeiten.",
  },
  {
    topic: "coach_quote",
    label: "Coach-Zitat",
    description: "Tägliches Zitat — optional, standardmäßig aus.",
  },
];

export default function NotificationsSettingsPage() {
  const data = readNotificationsSettings();
  const { prefs, counters: c, history } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Einstellungen"
        title="Benachrichtigungen"
        back={{ href: "/settings", label: "Einstellungen" }}
        sub="Welche Ereignisse benachrichtigen, wann ruhig bleiben, wie oft maximal."
      />

      <FadeRise>
        <Section eyebrow="Einstellungen" title="Benachrichtigungen">
          <div className="flex flex-col gap-4">
            <PushSubscribe />

            <SettingsToggle
              label="Push aktiv"
              description="Master-Schalter. Wenn aus, wird gar nichts gesendet — alle Topics darunter sind dann irrelevant."
              checked={prefs.enabled}
              onAction={toggleMaster}
            />

            <BudgetMeter sent24h={c.sent24h} budget={c.budget} />
          </div>
        </Section>
      </FadeRise>

      <FadeRise delay={0.05}>
        <Section eyebrow="Einstellungen" title="Welche Ereignisse">
          <Stagger className="flex flex-col gap-2">
            {TOPICS.map((t) => (
              <StaggerItem key={t.topic}>
                <TopicToggle
                  topic={t.topic}
                  label={t.label}
                  description={t.description}
                  checked={prefs.topics[t.topic]}
                  disabled={!prefs.enabled}
                  onAction={toggleTopic}
                  onTest={sendTestNotify}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </Section>
      </FadeRise>

      <FadeRise delay={0.1}>
        <Section eyebrow="Transparenz" title="Letzte Aktivität">
          <NotificationHistoryList rows={history} />
        </Section>
      </FadeRise>
    </div>
  );
}
