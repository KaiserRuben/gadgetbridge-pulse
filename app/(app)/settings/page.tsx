import { PushSubscribe } from "@/components/pwa/push-subscribe";
import { Section } from "@/components/ui/section";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <Section eyebrow="Einstellungen" title="Benachrichtigungen">
        <PushSubscribe />
      </Section>
    </div>
  );
}
