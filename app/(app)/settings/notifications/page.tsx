import { PushSubscribe } from "@/components/pwa/push-subscribe";
import { BudgetMeter } from "@/components/notifications/budget-meter";
import { NotificationHistoryList } from "@/components/notifications/history-list";
import { TopicToggle } from "@/components/notifications/topic-toggle";
import { Section } from "@/components/ui/section";
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
    <div className="flex flex-col gap-5 md:gap-6">
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

      <Section eyebrow="Einstellungen" title="Welche Ereignisse">
        <div className="flex flex-col gap-2">
          {TOPICS.map((t) => (
            <TopicToggle
              key={t.topic}
              topic={t.topic}
              label={t.label}
              description={t.description}
              checked={prefs.topics[t.topic]}
              disabled={!prefs.enabled}
              onAction={toggleTopic}
              onTest={sendTestNotify}
            />
          ))}
        </div>
      </Section>

      <Section eyebrow="Transparenz" title="Letzte Aktivität">
        <NotificationHistoryList rows={history} />
      </Section>
    </div>
  );
}
