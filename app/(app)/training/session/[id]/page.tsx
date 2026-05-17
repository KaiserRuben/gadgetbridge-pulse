import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { Card, CardBody } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

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
      <Card>
        <CardBody className="p-6 flex flex-col gap-3">
          <Eyebrow>Session</Eyebrow>
          <h1 className="text-hero">{templateLabel}</h1>
          <p className="text-body text-muted max-w-[60ch]">
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
