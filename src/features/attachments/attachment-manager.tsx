import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CircleAlertIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FolderOpenIcon,
  PaperclipIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { commandGateway, type AttachmentOwnerType, type AttachmentRecord, type AttachmentType } from "@/lib/commands"

const attachmentTypes: AttachmentType[] = ["receipt", "invoice", "image", "pdf", "contract", "other"]

export function AttachmentManager({ ownerType, ownerId }: { ownerType: AttachmentOwnerType; ownerId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [attachmentType, setAttachmentType] = useState<AttachmentType>(
    ownerType === "transaction" ? "receipt" : "other",
  )
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRecord | null>(null)
  const desktopRuntime = window.__TAURI_INTERNALS__ !== undefined
  const queryKey = ["attachments", ownerType, ownerId] as const

  const attachments = useQuery({
    queryKey,
    queryFn: () => commandGateway.listAttachments({ ownerType, ownerId }),
  })

  const refreshRelatedData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-note"] }),
      queryClient.invalidateQueries({ queryKey: ["daily-summaries"] }),
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["tax-organizer"] }),
    ])
  }

  const addMutation = useMutation({
    mutationFn: () => commandGateway.pickAttachment({ ownerType, ownerId, attachmentType }),
    onSuccess: async (record) => {
      if (!record) return
      await refreshRelatedData()
      toast.success(t("attachments.added"))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("attachments.addError")),
  })

  const openMutation = useMutation({
    mutationFn: (record: AttachmentRecord) => commandGateway.openAttachment({ id: record.id, ownerType, ownerId }),
    onError: (error) => toast.error(error instanceof Error ? error.message : t("attachments.openError")),
  })

  const deleteMutation = useMutation({
    mutationFn: (record: AttachmentRecord) => commandGateway.deleteAttachment({ id: record.id, ownerType, ownerId }),
    onSuccess: async () => {
      setDeleteTarget(null)
      await refreshRelatedData()
      toast.success(t("attachments.removed"))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("attachments.removeError")),
  })

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={4} className="flex items-center gap-2">
            <PaperclipIcon aria-hidden="true" />
            {t("attachments.title")}
          </CardTitle>
          <CardDescription>{t("attachments.description")}</CardDescription>
          <CardAction>
            <Badge variant="secondary">{attachments.data?.length ?? 0}/50</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!desktopRuntime ? (
            <Alert>
              <ShieldCheckIcon aria-hidden="true" />
              <AlertTitle>{t("attachments.desktopOnlyTitle")}</AlertTitle>
              <AlertDescription>{t("attachments.desktopOnlyDescription")}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor={`attachment-type-${ownerType}-${ownerId}`}>{t("attachments.typeLabel")}</FieldLabel>
              <Select value={attachmentType} onValueChange={(value) => setAttachmentType(value as AttachmentType)}>
                <SelectTrigger id={`attachment-type-${ownerType}-${ownerId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {attachmentTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`attachments.types.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>{t("attachments.constraints")}</FieldDescription>
            </Field>
            <Button
              type="button"
              disabled={!desktopRuntime || addMutation.isPending || (attachments.data?.length ?? 0) >= 50}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {t(addMutation.isPending ? "attachments.adding" : "attachments.add")}
            </Button>
          </div>

          {attachments.isLoading ? <AttachmentSkeleton /> : null}
          {attachments.isError ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>{t("attachments.loadError")}</AlertTitle>
              <AlertDescription>{t("attachments.loadErrorDescription")}</AlertDescription>
            </Alert>
          ) : null}
          {attachments.data?.length === 0 ? (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PaperclipIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("attachments.empty")}</EmptyTitle>
                <EmptyDescription>{t("attachments.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {attachments.data?.length ? (
            <ul className="grid gap-2" aria-label={t("attachments.listLabel")}>
              {attachments.data.map((record) => (
                <li key={record.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <AttachmentIcon record={record} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={record.originalFilename}>
                      {record.originalFilename}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{t(`attachments.types.${record.attachmentType}`)}</Badge>
                      <span>{formatFileSize(record.fileSize, i18n.language)}</span>
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={!desktopRuntime || openMutation.isPending}
                    aria-label={t("attachments.openNamed", { name: record.originalFilename })}
                    onClick={() => openMutation.mutate(record)}
                  >
                    <FolderOpenIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!desktopRuntime || deleteMutation.isPending}
                    aria-label={t("attachments.removeNamed", { name: record.originalFilename })}
                    onClick={() => setDeleteTarget(record)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("attachments.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("attachments.removeDescription", { name: deleteTarget?.originalFilename ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("attachments.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("attachments.confirmRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AttachmentIcon({ record }: { record: AttachmentRecord }) {
  const Icon = record.mimeType.startsWith("image/")
    ? FileImageIcon
    : record.mimeType === "application/pdf" || record.mimeType.startsWith("text/")
      ? FileTextIcon
      : FileIcon
  return <Icon className="shrink-0 text-muted-foreground" aria-hidden="true" />
}

function AttachmentSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-5 rounded" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function formatFileSize(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB"]
  let value = bytes / 1024
  let unit = units[0]
  if (value >= 1024) {
    value /= 1024
    unit = units[1]
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`
}
