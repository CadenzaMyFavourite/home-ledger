import { TriangleAlertIcon } from "lucide-react"
import { isRouteErrorResponse, useRouteError } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "发生未知错误"

  return (
    <main className="grid min-h-svh place-items-center p-6">
      <Alert variant="destructive" className="max-w-xl">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>页面无法加载</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </main>
  )
}
