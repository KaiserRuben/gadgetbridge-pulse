import { cn } from "@/lib/cn";

export function Skeleton({
  className,
  width,
  height,
  rounded = "0.75rem",
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("skeleton block", className)}
      style={{ width, height, borderRadius: rounded }}
    />
  );
}

export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-col gap-1.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.875rem"
          width={i === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </span>
  );
}
