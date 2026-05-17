import type { PropsWithChildren, ReactNode } from "react";
import { Eyebrow } from "./eyebrow";
import { cn } from "@/lib/cn";

export function Section({
  eyebrow,
  title,
  trailing,
  children,
  className,
  contentClassName,
}: PropsWithChildren<{
  eyebrow?: ReactNode;
  title?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  contentClassName?: string;
}>) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {(eyebrow || title || trailing) && (
        <header className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="text-title">{title}</h2>}
          </div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </header>
      )}
      <div className={cn(contentClassName)}>{children}</div>
    </section>
  );
}
