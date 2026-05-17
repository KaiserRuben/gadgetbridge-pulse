import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ExploreSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton width={60} height={10} />
        <Skeleton width={220} height={28} />
      </div>

      {Array.from({ length: 3 }).map((_, g) => (
        <div key={g} className="flex flex-col gap-3">
          <Skeleton width={80} height={10} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardBody className="p-4 flex flex-col gap-2 min-h-[140px]">
                  <Skeleton width={60} height={10} />
                  <Skeleton width="55%" height={24} />
                  <Skeleton height={36} className="mt-auto" />
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
