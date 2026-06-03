import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FadeRise } from "@/components/motion/fade-rise";

import { loadSessionView } from "@/lib/training/session-view";
import { SessionRunner } from "@/components/training/session-runner";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  noStore();
  const { id } = await params;
  const bundle = loadSessionView(id);
  if (!bundle) return notFound();

  const templateLabel =
    bundle.template?.label ??
    (bundle.session.session_template_id ?? "Eigene Session");

  if (!bundle.template) {
    // Free pick without a session template — minimal placeholder until the
    // free-logging UI lands. Still lets the user finish/abandon.
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Session"
          title={templateLabel}
          back={{ href: "/training", label: "Training" }}
        />
        <FadeRise>
          <Card>
            <CardBody className="flex flex-col gap-3 p-5">
              <p className="max-w-[60ch] text-body text-muted">
                Diese Session wurde ohne festes Template gestartet. Freies Logging
                folgt in einer späteren Iteration.
              </p>
              <SessionRunner
                session={bundle.session}
                templateLabel={templateLabel}
                prescribed={[]}
                sets={bundle.sets}
                pain={bundle.pain}
                lastTime={bundle.lastTime}
              />
            </CardBody>
          </Card>
        </FadeRise>
      </div>
    );
  }

  return (
    <SessionRunner
      session={bundle.session}
      templateLabel={templateLabel}
      prescribed={bundle.prescribed}
      sets={bundle.sets}
      pain={bundle.pain}
      lastTime={bundle.lastTime}
    />
  );
}
