"use client";

import { useTransition } from "react";

import { cn } from "@/lib/cn";
import type { NotifyTopic } from "@/lib/notifications/types";

interface Props {
  topic: NotifyTopic;
  label: string;
  description: string;
  checked: boolean;
  onAction: (topic: NotifyTopic, next: boolean) => Promise<void>;
  onTest?: (topic: NotifyTopic) => Promise<void>;
  disabled?: boolean;
}

/**
 * Single-row topic toggle. Mirrors the SettingsToggle posture: server
 * action drives state, useTransition keeps the UI responsive without
 * optimistic updates. Adds an optional "test" affordance per-topic so
 * the user can dry-run the language before committing.
 */
export function TopicToggle({
  topic,
  label,
  description,
  checked,
  onAction,
  onTest,
  disabled,
}: Props) {
  const [pending, start] = useTransition();
  const handleClick = () => {
    if (pending || disabled) return;
    start(() => {
      void onAction(topic, !checked);
    });
  };
  const handleTest = () => {
    if (!onTest || pending) return;
    start(() => {
      void onTest(topic);
    });
  };
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-4",
        disabled && "opacity-60",
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[0.9375rem] font-medium">{label}</span>
        <span className="text-body-sm text-muted">{description}</span>
        {onTest && (
          <button
            type="button"
            onClick={handleTest}
            disabled={pending || disabled || !checked}
            className="self-start text-caption text-muted underline hover:no-underline disabled:opacity-40 mt-1"
          >
            Test senden
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || disabled}
        aria-pressed={checked}
        className={cn(
          "shrink-0 inline-flex h-6 w-11 items-center rounded-full transition",
          checked ? "bg-foreground" : "bg-muted/30",
          "disabled:opacity-50",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-background transition",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
