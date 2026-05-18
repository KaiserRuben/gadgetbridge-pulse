"use client";

import { useTransition, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Form-driven toggle that posts to a server action. Posture: optimistic
 * UI is intentionally absent — the server-action call revalidates the
 * route so the next render reflects truth. Keeps the data flow boring:
 * settings live in PULSE_STATE_KV, the runner reads them with its own
 * 60s cache, and the UI re-renders once revalidation lands.
 */
export function SettingsToggle({
  label,
  description,
  checked,
  onAction,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onAction: (next: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const handleClick = () => {
    if (pending || disabled) return;
    start(() => {
      void onAction(!checked);
    });
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || disabled}
      aria-pressed={checked}
      className={cn(
        "flex items-start justify-between gap-4 w-full text-left p-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]/60 transition-colors disabled:opacity-60",
        pending && "cursor-progress",
      )}
    >
      <span className="flex flex-col gap-1 flex-1">
        <span className="text-[0.9375rem] font-medium">{label}</span>
        {description && (
          <span className="text-caption text-muted">{description}</span>
        )}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

export function SettingsThreeWay({
  label,
  description,
  meta,
  tooltips,
  value,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: string;
  /**
   * Trailing metadata row rendered under the description. Used by U4's
   * `/settings/clusters` rows to surface "zuletzt: vor 4 Std. · 18 Tage
   * Verlauf" + an optional error indicator dot.
   */
  meta?: ReactNode;
  /**
   * Optional per-option tooltip text. The "Global" position uses this to
   * spell out the inherited Cluster default ("Global = automatisch (Default)"
   * vs "Global = aus (Default)") so the user doesn't have to dig into docs
   * to know what "Global" resolves to.
   */
  tooltips?: Partial<Record<"inherit" | "on" | "off", string>>;
  value: "inherit" | "on" | "off";
  onChange: (next: "inherit" | "on" | "off") => Promise<void>;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const options: Array<{ id: "inherit" | "on" | "off"; label: string }> = [
    { id: "inherit", label: "Global" },
    { id: "off", label: "Aus" },
    { id: "on", label: "An" },
  ];
  return (
    <div className="flex items-start justify-between gap-4 w-full p-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span className="text-[0.9375rem] font-medium">{label}</span>
        {description && (
          <span className="text-caption text-muted">{description}</span>
        )}
        {meta && <div className="mt-0.5">{meta}</div>}
      </div>
      <div className="inline-flex rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 shrink-0 self-start">
        {options.map((opt) => {
          const active = opt.id === value;
          const title = tooltips?.[opt.id];
          return (
            <button
              key={opt.id}
              type="button"
              disabled={pending || disabled || active}
              title={title}
              onClick={() => {
                if (pending || disabled || active) return;
                start(() => {
                  void onChange(opt.id);
                });
              }}
              className={cn(
                "text-[0.75rem] px-2.5 py-1 rounded-[var(--radius-pill)] transition-colors",
                active
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                pending && "opacity-60",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
        checked
          ? "bg-[var(--color-sleep)]/40 border-[var(--color-sleep)]/60"
          : "bg-[var(--color-surface-2)] border-[var(--color-border)]",
      )}
    >
      <span
        className={cn(
          "absolute size-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[20px]" : "translate-x-[2px]",
        )}
      />
    </span>
  );
}
