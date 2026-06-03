import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyStateCard } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { Glyph } from "@/components/ui/glyph";
import { IconBadge } from "@/components/ui/icon-badge";
import { FadeRise } from "@/components/motion/fade-rise";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

import { readActivePlan } from "@/lib/training/plan";
import { listPickerOptions, suggestTodaySession } from "@/lib/training/scheduler";
import { listSessions, sweepStaleSessions } from "@/lib/training/session";
import { computePainRecurrenceAlarms } from "@/lib/training/alarms";
import { listProposals } from "@/lib/training/proposal";
import { loadTrainingInsight } from "@/lib/v3-loaders";
import { StartSessionButton } from "@/components/training/start-session-button";

interface TrainingInsightShape {
  kind?: "prescription" | "post_session" | "weekly";
  headline?: string | null;
  summary?: string | null;
  prescription?: {
    suggested_session_template_id?: string | null;
    alternatives?: string[];
    justification_de?: string | null;
  } | null;
  confidence?: { value?: number };
  incomplete?: boolean;
}

export const dynamic = "force-dynamic";

function localDateKeyDe(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function fmtRecent(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Berlin",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

const STALE_SESSION_MS = 12 * 3600 * 1000;

export default async function TrainingPage() {
  noStore();
  try {
    sweepStaleSessions(STALE_SESSION_MS);
  } catch {
    // Mac dev / read-only role: sweep is Pi-only. Stale sessions stay
    // visible as "läuft" until the Pi renders this page next.
  }
  const plan = readActivePlan();
  const now = new Date();
  const today = localDateKeyDe(now);
  const phase = plan?.payload.phases.find((p) => p.id === plan.payload.current_phase_id) ?? null;
  const insight = (await loadTrainingInsight(today)) as TrainingInsightShape | null;
  const insightUsable =
    !!insight &&
    insight.kind === "prescription" &&
    !insight.incomplete &&
    !!insight.prescription?.suggested_session_template_id;

  // Scheduler fallback when no LLM insight has landed yet. The LLM insight
  // overrides the scheduler — it has seen recovery context + pain history
  // and may have deviated from the plan's schedule_hint accordingly.
  const scheduleSuggestion = suggestTodaySession(plan?.payload ?? null, { now });
  const suggestedTemplateId =
    insightUsable && insight?.prescription?.suggested_session_template_id
      ? insight.prescription.suggested_session_template_id
      : scheduleSuggestion.kind === "session_template"
        ? scheduleSuggestion.session_template_id
        : null;
  const suggestedTemplate =
    suggestedTemplateId
      ? phase?.session_templates.find((t) => t.id === suggestedTemplateId) ?? null
      : null;
  const pickerOptions = listPickerOptions(plan?.payload ?? null);
  const recentSessions = listSessions({ limit: 14 });
  const inProgress = recentSessions.find((s) => s.state === "in_progress") ?? null;
  const alarms = computePainRecurrenceAlarms();
  const pendingProposals = listProposals("pending").length;

  if (!plan) return <ColdStart />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Training"
        title="Training"
        sub={`${fmtRecent(today)} · ${phase?.label ?? plan.payload.current_phase_id} · Plan v${plan.version}`}
        trailing={
          <Link
            href="/training/chat"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-3 text-xs font-medium ring-1 ring-inset ring-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <Glyph name="Brain" size={14} />
            Frag Pulse
          </Link>
        }
      />

      {/* ── Today / Suggestion ─────────────────────────────────────── */}
      <FadeRise>
        <Card glow="activity">
          <CardBody className="flex flex-col gap-4 p-5 lg:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <IconBadge icon="Dumbbell" tone="activity" variant="solid" size="md" />
              <Pill tone="neutral" size="sm">{phase?.label ?? plan.payload.current_phase_id}</Pill>
              <Pill tone="neutral" size="sm">Plan v{plan.version}</Pill>
              {insightUsable && (
                <Pill tone="activity" size="sm">
                  Coach · Konfidenz {Math.round((insight?.confidence?.value ?? 0) * 100)}%
                </Pill>
              )}
            </div>
            <h2 className="text-h2 text-[var(--color-text-strong)]">
              {insightUsable && insight?.headline
                ? insight.headline
                : suggestedTemplate
                  ? `Heute vorgeschlagen: ${suggestedTemplate.label}`
                  : scheduleSuggestion.kind === "cardio"
                    ? "Heute vorgeschlagen: Cardio (Z2)"
                    : scheduleSuggestion.kind === "rest"
                      ? "Heute vorgeschlagen: Pause"
                      : scheduleSuggestion.kind === "flex"
                        ? "Kein fester Slot — wähle frei."
                        : "Kein aktiver Plan."}
            </h2>
            {insightUsable && insight?.prescription?.justification_de && (
              <p className="max-w-[64ch] text-body text-muted">
                {insight.prescription.justification_de}
              </p>
            )}
            {!insightUsable && suggestedTemplate && (
              <p className="max-w-[64ch] text-body text-muted">
                {suggestedTemplate.exercises.length} Übung
                {suggestedTemplate.exercises.length === 1 ? "" : "en"} ·{" "}
                {suggestedTemplate.estimated_duration_min ?? "?"} min ·{" "}
                Phase: {phase?.character ?? "—"}
              </p>
            )}
            <div className="mt-2 max-w-md">
              {suggestedTemplate ? (
                <StartSessionButton
                  periodKey={today}
                  sessionTemplateId={suggestedTemplate.id}
                  // When the LLM suggestion differs from the schedule_hint
                  // slot, the user is still picking the *suggested* session
                  // — but the deviation is meaningful and worth recording.
                  deviationReason={
                    insightUsable &&
                    scheduleSuggestion.kind === "session_template" &&
                    scheduleSuggestion.session_template_id !== suggestedTemplate.id
                      ? "recovery"
                      : insightUsable && scheduleSuggestion.kind !== "session_template"
                        ? "recovery"
                        : null
                  }
                  label={`${suggestedTemplate.label} starten`}
                  tone="activity"
                  prominent
                />
              ) : (
                <StartSessionButton
                  periodKey={today}
                  sessionTemplateId={null}
                  deviationReason={scheduleSuggestion.kind === "rest" ? "schedule" : "user_choice"}
                  label="Eigene Session starten"
                  prominent
                />
              )}
            </div>
            {inProgress && (
              <Link
                href={`/training/session/${inProgress.id}`}
                className="mt-2 inline-flex items-center gap-2 text-caption text-muted transition-colors hover:text-[var(--color-text)]"
              >
                <Glyph name="Pause" size={14} />
                Laufende Session vom {fmtTime(inProgress.started_at)} fortsetzen
              </Link>
            )}
          </CardBody>
        </Card>
      </FadeRise>

      {/* ── Alarms (pain recurrence + proposals) ──────────────────── */}
      {(alarms.length > 0 || pendingProposals > 0) && (
        <Section eyebrow="Hinweise" title="Aufmerksamkeit">
          <Stagger className="flex flex-col gap-2">
            {alarms.map((a) => (
              <StaggerItem key={a.id}>
                <Card variant="soft">
                  <CardBody className="flex items-center gap-3 p-4">
                    <IconBadge icon="AlertTriangle" tone="stress" size="sm" />
                    <Pill
                      tone={a.severity === "critical" ? "down" : a.severity === "warn" ? "down" : "neutral"}
                      size="sm"
                    >
                      {a.severity}
                    </Pill>
                    <span className="flex-1 text-body">{a.message_de}</span>
                  </CardBody>
                </Card>
              </StaggerItem>
            ))}
            {pendingProposals > 0 && (
              <StaggerItem>
                <Link href="/training/proposals" className="block">
                  <Card hoverable>
                    <CardBody className="flex items-center gap-3 p-4">
                      <IconBadge icon="GitMerge" tone="activity" size="sm" />
                      <Pill tone="activity" size="sm">
                        {pendingProposals} offen
                      </Pill>
                      <span className="flex-1 text-body">
                        Plan-Vorschläge warten auf Review.
                      </span>
                      <Glyph name="ChevronRight" size={14} className="text-faint" />
                    </CardBody>
                  </Card>
                </Link>
              </StaggerItem>
            )}
          </Stagger>
        </Section>
      )}

      {/* ── Picker: any defined template ──────────────────────────── */}
      <Section eyebrow="Alle Sessions" title="Frei wählen">
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pickerOptions.map((opt) => {
            const isSuggested =
              opt.kind === "session_template" &&
              opt.session_template_id === suggestedTemplateId;
            const deviation = isSuggested ? null : "user_choice";
            return (
              <StaggerItem
                key={`${opt.kind}-${opt.session_template_id ?? opt.label}`}
              >
                <StartSessionButton
                  periodKey={today}
                  sessionTemplateId={opt.session_template_id}
                  deviationReason={deviation}
                  label={opt.label}
                  tone={opt.kind === "cardio" ? "heart" : "neutral"}
                />
              </StaggerItem>
            );
          })}
        </Stagger>
      </Section>

      {/* ── Recent sessions list ──────────────────────────────────── */}
      <Section eyebrow="Verlauf" title="Letzte Sessions">
        {recentSessions.length === 0 ? (
          <EmptyStateCard cause="no_data" headline="Noch keine Trainings-Sessions" />
        ) : (
          <Card variant="soft">
            <CardBody className="p-2">
              <Stagger className="flex flex-col divide-y divide-[var(--color-border)]">
                {recentSessions.map((s) => (
                  <StaggerItem key={s.id}>
                    <Link
                      href={`/training/session/${s.id}`}
                      className="flex h-12 items-center gap-3 rounded-[var(--radius-chip)] px-3 transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      <span className="w-[88px] num-mono text-caption">
                        {fmtRecent(s.period_key)}
                      </span>
                      <span className="flex-1 truncate text-body">
                        {s.session_template_id ?? "Eigen"}
                      </span>
                      <Pill
                        tone={
                          s.state === "in_progress"
                            ? "activity"
                            : s.state === "completed"
                              ? "up"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {s.state === "in_progress"
                          ? "läuft"
                          : s.state === "completed"
                            ? "abgeschlossen"
                            : "abgebrochen"}
                      </Pill>
                      <Glyph name="ChevronRight" size={14} className="text-faint" />
                    </Link>
                  </StaggerItem>
                ))}
              </Stagger>
            </CardBody>
          </Card>
        )}
      </Section>
    </div>
  );
}

function ColdStart() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Training" title="Training" />
      <FadeRise>
        <Card>
          <CardBody className="flex flex-col gap-3 p-6">
            <IconBadge icon="Dumbbell" tone="activity" variant="solid" size="lg" />
            <h2 className="text-h2 text-[var(--color-text-strong)]">
              Noch kein Plan importiert.
            </h2>
            <p className="max-w-[60ch] text-body text-muted">
              Importiere die Seed-Plan-Datei via{" "}
              <code className="font-mono text-caption">tsx runner/src/scripts/import-plan.ts</code>{" "}
              (oder POST <code className="font-mono text-caption">/api/training/plan/import</code>).
            </p>
          </CardBody>
        </Card>
      </FadeRise>
    </div>
  );
}
