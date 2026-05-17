import { Card, CardBody } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function DaySkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {/* Chrome */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <Skeleton width={80} height={10} />
          <Skeleton width={200} height={28} />
        </div>
        <div className="flex gap-2">
          <Skeleton width={36} height={36} rounded="0.625rem" />
          <Skeleton width={36} height={36} rounded="0.625rem" />
        </div>
      </div>

      {/* Hero verdict */}
      <Card>
        <CardBody className="p-6 grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-6 items-center">
          <Skeleton width={140} height={140} rounded="999px" />
          <div className="flex flex-col gap-3 min-w-0">
            <Skeleton height={32} width="65%" />
            <SkeletonText lines={2} />
          </div>
        </CardBody>
      </Card>

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="p-5 flex flex-col gap-3 min-h-[260px]">
              <Skeleton width={80} height={10} />
              <Skeleton height={200} />
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Drivers */}
      <Card variant="soft">
        <CardBody className="p-5 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={42} />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
