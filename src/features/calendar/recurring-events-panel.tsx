import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { CalendarClockIcon, PencilIcon, PlusIcon } from "lucide-react"
import { useState, type ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  commandGateway,
  type CalendarEventType,
  type EventPriority,
  type RecurringEventRecord,
  type RecurringFrequency,
  type TransactionReferenceData,
} from "@/lib/commands"

type EventDraft = {
  name: string
  frequency: RecurringFrequency
  interval: string
  customRrule: string
  startDate: string
  endDate: string
  occurrenceCount: string
  advanceNoticeDays: string
  materializeDaysAhead: string
  title: string
  description: string
  eventType: CalendarEventType
  durationDays: string
  priority: EventPriority
  color: string
  householdMemberId: string
  locationId: string
  isActive: boolean
}

const frequencies: RecurringFrequency[] = ["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]
const eventTypes: CalendarEventType[] = [
  "general",
  "important",
  "travel",
  "medical",
  "education",
  "bill",
  "tax",
  "maintenance",
  "other",
]

export function RecurringEventsPanel({
  timezoneId,
  references,
}: {
  timezoneId: string
  references: TransactionReferenceData | undefined
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<RecurringEventRecord | "new" | null>(null)
  const items = useQuery({ queryKey: ["recurring-events"], queryFn: commandGateway.listRecurringEvents })
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t("calendar.recurringEvents.title")}</CardTitle>
          <CardDescription>{t("calendar.recurringEvents.description")}</CardDescription>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          {t("calendar.recurringEvents.add")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.isLoading ? <Spinner /> : null}
        {items.data?.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
            onClick={() => setEditing(item)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <CalendarClockIcon className="size-4" aria-hidden="true" />
                <span className="truncate font-medium">{item.name}</span>
                <Badge variant={item.isActive ? "secondary" : "outline"}>
                  {t(item.isActive ? "calendar.recurring.active" : "calendar.recurring.inactive")}
                </Badge>
              </span>
              <span className="block text-sm text-muted-foreground">
                {t(`calendar.recurring.frequencies.${item.frequency}`)} · {item.startDate} · {item.template.title}
              </span>
            </span>
            <PencilIcon aria-hidden="true" className="size-4 shrink-0" />
          </button>
        ))}
        {items.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("calendar.recurringEvents.empty")}</p>
        ) : null}
      </CardContent>
      <RecurringEventSheet
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        record={editing === "new" ? undefined : (editing ?? undefined)}
        timezoneId={timezoneId}
        references={references}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </Card>
  )
}

function RecurringEventSheet({
  open,
  record,
  timezoneId,
  references,
  onOpenChange,
}: {
  open: boolean
  record: RecurringEventRecord | undefined
  timezoneId: string
  references: TransactionReferenceData | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<EventDraft>(() => draftFrom(record))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const save = useMutation({
    mutationFn: () =>
      commandGateway.saveRecurringEvent({
        id: record?.id ?? null,
        name: draft.name,
        frequency: draft.frequency,
        interval: Number(draft.interval),
        customRrule: draft.frequency === "custom" ? draft.customRrule : null,
        startDate: draft.startDate,
        endDate: draft.endDate || null,
        occurrenceCount: draft.occurrenceCount ? Number(draft.occurrenceCount) : null,
        timezoneId,
        advanceNoticeDays: Number(draft.advanceNoticeDays),
        materializeDaysAhead: Number(draft.materializeDaysAhead),
        isActive: draft.isActive,
        template: {
          title: draft.title,
          description: draft.description.trim() || null,
          eventType: draft.eventType,
          durationDays: Number(draft.durationDays),
          priority: draft.priority,
          color: draft.color,
          icon: null,
          locationId: draft.locationId || null,
          householdMemberId: draft.householdMemberId || null,
        },
      }),
    onSuccess: async () => {
      await commandGateway.materializeRecurringTransactions({ asOfDate: format(new Date(), "yyyy-MM-dd") })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recurring-events"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["reminder-deliveries"] }),
      ])
      toast.success(t("calendar.recurringEvents.saved"))
      onOpenChange(false)
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : t("calendar.recurringEvents.saveError")),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t(record ? "calendar.recurringEvents.edit" : "calendar.recurringEvents.add")}</SheetTitle>
          <SheetDescription>{t("calendar.recurringEvents.formDescription")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <DraftInput
            label={t("calendar.recurring.name")}
            value={draft.name}
            onChange={(value) => set("name", value)}
          />
          <DraftInput label={t("calendar.eventTitle")} value={draft.title} onChange={(value) => set("title", value)} />
          <div className="grid grid-cols-2 gap-3">
            <DraftSelect
              label={t("calendar.recurring.frequency")}
              value={draft.frequency}
              onChange={(value) => set("frequency", value as RecurringFrequency)}
              items={frequencies.map((value) => ({ value, label: t(`calendar.recurring.frequencies.${value}`) }))}
            />
            <DraftInput
              label={t("calendar.recurring.interval")}
              value={draft.interval}
              type="number"
              min="1"
              onChange={(value) => set("interval", value)}
            />
          </div>
          {draft.frequency === "custom" ? (
            <DraftInput
              label={t("calendar.recurring.customRrule")}
              value={draft.customRrule}
              placeholder="FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=30"
              onChange={(value) => set("customRrule", value.toUpperCase())}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <DraftInput
              label={t("calendar.startDate")}
              value={draft.startDate}
              type="date"
              onChange={(value) => set("startDate", value)}
            />
            <DraftInput
              label={t("calendar.recurring.optionalEndDate")}
              value={draft.endDate}
              type="date"
              onChange={(value) => set("endDate", value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DraftSelect
              label={t("calendar.eventType")}
              value={draft.eventType}
              onChange={(value) => set("eventType", value as CalendarEventType)}
              items={eventTypes.map((value) => ({ value, label: t(`calendar.types.${value}`) }))}
            />
            <DraftSelect
              label={t("calendar.priority")}
              value={draft.priority}
              onChange={(value) => set("priority", value as EventPriority)}
              items={[
                { value: "normal", label: t("calendar.priorities.normal") },
                { value: "important", label: t("calendar.priorities.important") },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DraftInput
              label={t("calendar.recurringEvents.durationDays")}
              value={draft.durationDays}
              type="number"
              min="1"
              max="366"
              onChange={(value) => set("durationDays", value)}
            />
            <DraftInput
              label={t("calendar.color")}
              value={draft.color}
              type="color"
              onChange={(value) => set("color", value)}
            />
          </div>
          <DraftSelect
            label={t("transactions.householdMember")}
            value={draft.householdMemberId}
            onChange={(value) => set("householdMemberId", value)}
            allowEmpty
            items={(references?.householdMembers.filter((item) => item.isActive) ?? []).map((item) => ({
              value: item.id,
              label: item.displayName,
            }))}
          />
          <DraftSelect
            label={t("transactions.location")}
            value={draft.locationId}
            onChange={(value) => set("locationId", value)}
            allowEmpty
            items={(references?.locations.filter((item) => item.isActive) ?? []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Field>
            <FieldLabel htmlFor="recurring-event-description">{t("calendar.notes")}</FieldLabel>
            <Textarea
              id="recurring-event-description"
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <DraftInput
              label={t("calendar.recurring.noticeDays")}
              value={draft.advanceNoticeDays}
              type="number"
              min="0"
              onChange={(value) => set("advanceNoticeDays", value)}
            />
            <DraftInput
              label={t("calendar.recurring.horizonDays")}
              value={draft.materializeDaysAhead}
              type="number"
              min="0"
              onChange={(value) => set("materializeDaysAhead", value)}
            />
            <DraftInput
              label={t("calendar.recurring.optionalCount")}
              value={draft.occurrenceCount}
              type="number"
              min="1"
              onChange={(value) => set("occurrenceCount", value)}
            />
          </div>
          <Field orientation="horizontal">
            <div className="flex-1">
              <FieldLabel htmlFor="recurring-event-active">{t("calendar.recurring.active")}</FieldLabel>
              <FieldDescription>{t("calendar.recurring.activeDescription")}</FieldDescription>
            </div>
            <Switch
              id="recurring-event-active"
              checked={draft.isActive}
              onCheckedChange={(value) => set("isActive", value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <SheetFooter>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setError(null)
              save.mutate()
            }}
          >
            {save.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("transactions.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DraftInput({
  label,
  value,
  onChange,
  ...props
}: { label: string; value: string; onChange: (value: string) => void } & Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange"
>) {
  const id = `recurring-event-${label.replaceAll(" ", "-")}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input {...props} id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function DraftSelect({
  label,
  value,
  onChange,
  items,
  allowEmpty = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  items: Array<{ value: string; label: string }>
  allowEmpty?: boolean
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value || "__empty"} onValueChange={(next) => onChange(next === "__empty" ? "" : next)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty ? <SelectItem value="__empty">—</SelectItem> : null}
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function draftFrom(record?: RecurringEventRecord): EventDraft {
  return {
    name: record?.name ?? "",
    frequency: record?.frequency ?? "yearly",
    interval: String(record?.interval ?? 1),
    customRrule: record?.customRrule ?? "",
    startDate: record?.startDate ?? format(new Date(), "yyyy-MM-dd"),
    endDate: record?.endDate ?? "",
    occurrenceCount: record?.occurrenceCount ? String(record.occurrenceCount) : "",
    advanceNoticeDays: String(record?.advanceNoticeDays ?? 7),
    materializeDaysAhead: String(record?.materializeDaysAhead ?? 400),
    title: record?.template.title ?? "",
    description: record?.template.description ?? "",
    eventType: record?.template.eventType ?? "important",
    durationDays: String(record?.template.durationDays ?? 1),
    priority: record?.template.priority ?? "important",
    color: record?.template.color ?? "#D9364F",
    householdMemberId: record?.template.householdMemberId ?? "",
    locationId: record?.template.locationId ?? "",
    isActive: record?.isActive ?? true,
  }
}
