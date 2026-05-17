import { Card, CardBody } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function LandingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {/* Hero verdict */}
      <Card>
        <CardBody className="p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-6 lg:gap-10 items-center">
          <Skeleton width={160} height={160} rounded="999px" />
          <div className="flex flex-col gap-3 min-w-0">
            <Skeleton width={120} height={12} />
            <Skeleton height={36} width="65%" />
            <SkeletonText lines={2} />
            <div className="flex gap-2 mt-1">
              <Skeleton width={84} height={24} rounded="999px" />
              <Skeleton width={96} height={24} rounded="999px" />
              <Skeleton width={72} height={24} rounded="999px" />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 4 peek cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="p-5 flex flex-col gap-3 min-h-[148px]">
              <div className="flex items-center justify-between">
                <Skeleton width={48} height={10} />
                <Skeleton width={28} height={28} rounded="0.625rem" />
              </div>
              <Skeleton width="60%" height={28} />
              <div className="mt-auto flex items-end justify-between gap-3">
                <Skeleton width={48} height={12} />
                <Skeleton width={88} height={28} rounded="0.5rem" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Bar day + inbox */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardBody className="p-5 flex flex-col gap-3">
            <Skeleton width={120} height={10} />
            <Skeleton height={120} />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-5 flex flex-col gap-3">
            <Skeleton width={80} height={10} />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={48} />
            ))}
          </CardBody>
        </Card>
      </div>

      {/* 14d band strip */}
      <Card variant="soft">
        <CardBody className="p-5">
          <Skeleton height={64} />
        </CardBody>
      </Card>
    </div>
  );
}
