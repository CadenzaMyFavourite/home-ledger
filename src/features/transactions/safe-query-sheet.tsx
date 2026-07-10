import { useMutation } from "@tanstack/react-query"
import { BotIcon, CheckIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { commandGateway, type ValidatedSafeQuery } from "@/lib/commands"

export function SafeQuerySheet({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (query: ValidatedSafeQuery) => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const [preview, setPreview] = useState<ValidatedSafeQuery | null>(null)
  const desktopRuntime = window.__TAURI_INTERNALS__ !== undefined
  const mutation = useMutation({
    mutationFn: () =>
      commandGateway.translateSafeQuery({
        query,
        locale: i18n.language === "en-CA" ? "en-CA" : "zh-CN",
      }),
    onSuccess: setPreview,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("safeQuery.error")),
  })

  const resetAndClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("")
      setPreview(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Sheet open={open} onOpenChange={resetAndClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("safeQuery.title")}</SheetTitle>
          <SheetDescription>{t("safeQuery.description")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <Alert>
            <ShieldCheckIcon aria-hidden="true" />
            <AlertTitle>{t("safeQuery.scopeTitle")}</AlertTitle>
            <AlertDescription>{t("safeQuery.scopeDescription")}</AlertDescription>
          </Alert>
          {!desktopRuntime ? (
            <Alert>
              <BotIcon aria-hidden="true" />
              <AlertTitle>{t("safeQuery.desktopTitle")}</AlertTitle>
              <AlertDescription>{t("safeQuery.desktopDescription")}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="safe-query-input">{t("safeQuery.queryLabel")}</FieldLabel>
              <Textarea
                id="safe-query-input"
                value={query}
                rows={4}
                maxLength={500}
                placeholder={t("safeQuery.placeholder")}
                aria-describedby="safe-query-help"
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPreview(null)
                }}
              />
              <FieldDescription id="safe-query-help">{t("safeQuery.queryHelp")}</FieldDescription>
            </Field>
          </FieldGroup>
          <Button
            type="button"
            variant="secondary"
            disabled={!desktopRuntime || !query.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
            {t(mutation.isPending ? "safeQuery.translating" : "safeQuery.translate")}
          </Button>
          {preview ? <SafeQueryPreview preview={preview} /> : null}
        </div>
        <SheetFooter>
          <Button
            type="button"
            disabled={!preview}
            onClick={() => {
              if (!preview) return
              onApply(preview)
              resetAndClose(false)
            }}
          >
            <CheckIcon data-icon="inline-start" />
            {t("safeQuery.apply")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SafeQueryPreview({ preview }: { preview: ValidatedSafeQuery }) {
  const { t } = useTranslation()
  const labels = Object.entries(preview.filters)
    .filter(([key, value]) => !["offset"].includes(key) && value !== undefined)
    .map(([key, value]) => `${t(`safeQuery.fields.${key}`)}: ${String(value)}`)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("safeQuery.previewTitle")}</CardTitle>
        <CardDescription>{preview.plan.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <Badge key={label} variant="outline">
            {label}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}
