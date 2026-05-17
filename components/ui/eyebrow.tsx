import { cn } from "@/lib/cn";
import type { PropsWithChildren } from "react";

export function Eyebrow({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <span className={cn("eyebrow", className)}>{children}</span>;
}
