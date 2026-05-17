import { Card, CardBody } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function CoachSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton width={60} height={10} />
        <Skeleton width={240} height={28} />
      </div>

      {/* 2-col cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="p-5 flex flex-col gap-3 min-h-[180px]">
              <Skeleton width={100} height={10} />
              <Skeleton width="80%" height={20} />
              <SkeletonText lines={3} />
              <div className="mt-auto flex gap-2">
                <Skeleton width={72} height={24} rounded="999px" />
                <Skeleton width={92} height={24} rounded="999px" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* History */}
      <Card variant="soft">
        <CardBody className="p-5 flex flex-col gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} height={48} />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
