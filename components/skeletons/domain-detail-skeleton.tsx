import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DomainDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {/* Chrome */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton width={32} height={32} rounded="0.625rem" />
          <div className="flex flex-col gap-1.5">
            <Skeleton width={60} height={10} />
            <Skeleton width={180} height={24} />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton width={36} height={36} rounded="0.625rem" />
          <Skeleton width={36} height={36} rounded="0.625rem" />
        </div>
      </div>

      {/* Hero stats */}
      <Card>
        <CardBody className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton width={60} height={10} />
              <Skeleton width="60%" height={28} />
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Main viz */}
      <Card>
        <CardBody className="p-5 flex flex-col gap-3">
          <Skeleton width={100} height={10} />
          <Skeleton height={260} />
        </CardBody>
      </Card>

      {/* 14d trend tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="p-4 flex flex-col gap-2 min-h-[110px]">
              <Skeleton width={60} height={10} />
              <Skeleton width="50%" height={24} />
              <Skeleton height={28} className="mt-auto" />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
