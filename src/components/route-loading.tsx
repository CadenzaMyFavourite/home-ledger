import { Skeleton } from "@/components/ui/skeleton"

export function RouteLoading() {
  return (
    <main className="flex min-h-svh flex-col gap-4 p-8" aria-label="Loading">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </main>
  )
}
