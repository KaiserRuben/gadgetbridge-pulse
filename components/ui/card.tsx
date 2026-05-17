import { cn } from "@/lib/cn";
import type { HTMLAttributes, PropsWithChildren } from "react";

type CardVariant = "surface" | "soft" | "flat";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  hoverable?: boolean;
  glow?: "sleep" | "heart" | "activity" | "body" | "stress" | "nutrition" | null;
};

export function Card({
  variant = "surface",
  hoverable,
  glow = null,
  className,
  children,
  ...rest
}: PropsWithChildren<CardProps>) {
  const base =
    variant === "soft" ? "surface-soft"
    : variant === "flat" ? "surface-flat"
    : "surface";
  return (
    <div
      className={cn(
        base,
        hoverable && "surface-hover",
        glow && `glow-${glow}`,
        "relative isolate overflow-hidden",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn("flex items-start justify-between gap-3 p-5 pb-3", className)}>{children}</div>;
}

export function CardBody({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn("px-5 pb-5", className)}>{children}</div>;
}

export function CardFooter({ className, children }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "border-t border-[var(--color-border)] px-5 py-3 text-caption flex items-center justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}
