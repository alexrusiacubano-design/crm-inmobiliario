import { Card, Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Card className="mt-6">
        <div className="border-b p-4">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
