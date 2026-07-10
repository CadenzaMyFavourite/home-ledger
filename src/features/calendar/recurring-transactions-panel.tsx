import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { BellIcon, BellOffIcon, CalendarSyncIcon, PencilIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
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
  type RecurringFrequency,
  type RecurringTransactionRecord,
  type TransactionReferenceData,
} from "@/lib/commands"
import { formatMinorAmount, minorAmountToInput, parseMoneyToMinor } from "@/lib/money"

type Draft = {
  name: string
  frequency: RecurringFrequency
  interval: string
  customRrule: string
  startDate: string
  endDate: string
  occurrenceCount: string
  advanceNoticeDays: string
  materializeDaysAhead: string
  amount: string
  currencyCode: string
  categoryId: string
  paymentMethodId: string
  householdMemberId: string
  locationId: string
  merchant: string
  note: string
  isActive: boolean
}

export function RecurringTransactionsPanel({
  timezoneId,
  references,
}: {
  timezoneId: string
  references: TransactionReferenceData | undefined
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<RecurringTransactionRecord | "new" | null>(null)
  const items = useQuery({
    queryKey: ["recurring-transactions"],
    queryFn: commandGateway.listRecurringTransactions,
  })
  const reminderRange = {
    start: addUtcDays(new Date(), -30).toISOString(),
    end: addUtcDays(new Date(), 60).toISOString(),
  }
  const reminders = useQuery({
    queryKey: ["reminder-deliveries", reminderRange.start.slice(0, 10), reminderRange.end.slice(0, 10)],
    queryFn: () =>
      commandGateway.listReminderDeliveries({
        rangeStartUtc: reminderRange.start,
        rangeEndUtc: reminderRange.end,
      }),
  })
  const materialize = useMutation({
    mutationFn: () => commandGateway.materializeRecurringTransactions({ asOfDate: format(new Date(), "yyyy-MM-dd") }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      await queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] })
      toast.success(t("calendar.recurring.materialized", { count: result.createdCount }))
    },
    onError: showError,
  })
  const dismissReminder = useMutation({
    mutationFn: commandGateway.dismissReminder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reminder-deliveries"] })
      toast.success(t("calendar.recurring.reminderDismissed"))
    },
    onError: showError,
  })
  const notify = async (reminder: NonNullable<typeof reminders.data>[number]) => {
    try {
      if (!("__TAURI_INTERNALS__" in window)) {
        toast.info(t("calendar.recurring.desktopOnly"))
        return
      }
      const notifications = await import("@tauri-apps/plugin-notification")
      let granted = await notifications.isPermissionGranted()
      if (!granted) granted = (await notifications.requestPermission()) === "granted"
      if (!granted) throw new Error(t("calendar.recurring.notificationDenied"))
      notifications.sendNotification({
        title: reminder.recurringItemName,
        body: t("calendar.recurring.notificationBody", { date: reminder.occurrenceKey }),
      })
      await commandGateway.markReminderDelivered({ id: reminder.id })
      await queryClient.invalidateQueries({ queryKey: ["reminder-deliveries"] })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t("calendar.recurring.title")}</CardTitle>
          <CardDescription>{t("calendar.recurring.description")}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={materialize.isPending} onClick={() => materialize.mutate()}>
            {materialize.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CalendarSyncIcon data-icon="inline-start" />
            )}
            {t("calendar.recurring.materialize")}
          </Button>
          <Button onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            {t("calendar.recurring.add")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {reminders.data?.length ? (
          <section className="mb-3 grid gap-2 rounded-lg bg-muted/50 p-3">
            <h3 className="font-medium">{t("calendar.recurring.upcomingReminders")}</h3>
            {reminders.data.slice(0, 5).map((reminder) => (
              <div
                key={reminder.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card p-2"
              >
                <span className="text-sm">
                  <span className="font-medium">{reminder.recurringItemName}</span> · {reminder.occurrenceKey}
                  {reminder.amountMinor !== null && reminder.currencyCode
                    ? ` · ${formatMinorAmount(reminder.amountMinor, reminder.currencyCode, i18n.language)}`
                    : ""}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => void notify(reminder)}>
                    <BellIcon data-icon="inline-start" />
                    {t("calendar.recurring.notify")}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("calendar.recurring.dismiss")}
                    onClick={() => dismissReminder.mutate({ id: reminder.id })}
                  >
                    <BellOffIcon aria-hidden="true" />
                  </Button>
                </span>
              </div>
            ))}
          </section>
        ) : null}
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
                <span className="truncate font-medium">{item.name}</span>
                <Badge variant={item.isActive ? "secondary" : "outline"}>
                  {t(item.isActive ? "calendar.recurring.active" : "calendar.recurring.inactive")}
                </Badge>
              </span>
              <span className="block text-sm text-muted-foreground">
                {t(`calendar.recurring.frequencies.${item.frequency}`)} · {item.startDate} ·{" "}
                {formatMinorAmount(item.template.amountMinor, item.template.currencyCode, i18n.language)}
              </span>
            </span>
            <PencilIcon aria-hidden="true" className="size-4 shrink-0" />
          </button>
        ))}
        {items.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("calendar.recurring.empty")}</p>
        ) : null}
      </CardContent>
      <RecurringFormSheet
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        record={editing === "new" ? undefined : (editing ?? undefined)}
        open={editing !== null}
        timezoneId={timezoneId}
        references={references}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </Card>
  )
}

function RecurringFormSheet({
  record,
  open,
  timezoneId,
  references,
  onOpenChange,
}: {
  record: RecurringTransactionRecord | undefined
  open: boolean
  timezoneId: string
  references: TransactionReferenceData | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(record))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      commandGateway.saveRecurringTransaction({
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
          transactionType: "expense",
          amountMinor: parseMoneyToMinor(draft.amount),
          currencyCode: draft.currencyCode.trim().toUpperCase(),
          categoryId: draft.categoryId || null,
          paymentMethodId: draft.paymentMethodId || null,
          transferToPaymentMethodId: null,
          transferToAmountMinor: null,
          transferToCurrencyCode: null,
          householdMemberId: draft.householdMemberId || null,
          locationId: draft.locationId || null,
          merchant: draft.merchant.trim() || null,
          note: draft.note.trim() || null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] })
      toast.success(t("calendar.recurring.saved"))
      onOpenChange(false)
    },
    onError: (reason) => setError(errorMessage(reason)),
  })
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const expenseCategories =
    references?.categories.filter((item) => item.categoryType === "expense" && item.isActive) ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t(record ? "calendar.recurring.edit" : "calendar.recurring.add")}</SheetTitle>
          <SheetDescription>{t("calendar.recurring.formDescription")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <DraftInput
            label={t("calendar.recurring.name")}
            value={draft.name}
            onChange={(value) => set("name", value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <DraftSelect
              label={t("calendar.recurring.frequency")}
              value={draft.frequency}
              onChange={(value) => set("frequency", value as RecurringFrequency)}
              items={(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"] as const).map((value) => ({
                value,
                label: t(`calendar.recurring.frequencies.${value}`),
              }))}
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
              placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10"
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
            <DraftInput
              label={t("calendar.recurring.amount")}
              value={draft.amount}
              inputMode="decimal"
              onChange={(value) => set("amount", value)}
            />
            <DraftInput
              label={t("transactions.currency")}
              value={draft.currencyCode}
              maxLength={3}
              onChange={(value) => set("currencyCode", value.toUpperCase())}
            />
          </div>
          <DraftSelect
            label={t("transactions.category")}
            value={draft.categoryId}
            onChange={(value) => set("categoryId", value)}
            allowEmpty
            items={expenseCategories.map((item) => ({
              value: item.id,
              label: item.parentName ? `${item.parentName} · ${item.name}` : item.name,
            }))}
          />
          <DraftSelect
            label={t("transactions.paymentMethod")}
            value={draft.paymentMethodId}
            onChange={(value) => set("paymentMethodId", value)}
            allowEmpty
            items={(references?.paymentMethods.filter((item) => item.isActive) ?? []).map((item) => ({
              value: item.id,
              label: item.displayName,
            }))}
          />
          <DraftInput
            label={t("transactions.merchant")}
            value={draft.merchant}
            onChange={(value) => set("merchant", value)}
          />
          <Field>
            <FieldLabel htmlFor="recurring-note">{t("transactions.note")}</FieldLabel>
            <Textarea id="recurring-note" value={draft.note} onChange={(event) => set("note", event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <DraftInput
            label={t("calendar.recurring.optionalCount")}
            value={draft.occurrenceCount}
            type="number"
            min="1"
            onChange={(value) => set("occurrenceCount", value)}
          />
          <Field orientation="horizontal">
            <div className="flex-1">
              <FieldLabel htmlFor="recurring-active">{t("calendar.recurring.active")}</FieldLabel>
              <FieldDescription>{t("calendar.recurring.activeDescription")}</FieldDescription>
            </div>
            <Switch
              id="recurring-active"
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
  React.ComponentProps<typeof Input>,
  "value" | "onChange"
>) {
  const id = `recurring-${label.replaceAll(" ", "-")}`
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

function draftFrom(record?: RecurringTransactionRecord): Draft {
  return {
    name: record?.name ?? "",
    frequency: record?.frequency ?? "monthly",
    interval: String(record?.interval ?? 1),
    customRrule: record?.customRrule ?? "",
    startDate: record?.startDate ?? format(new Date(), "yyyy-MM-dd"),
    endDate: record?.endDate ?? "",
    occurrenceCount: record?.occurrenceCount ? String(record.occurrenceCount) : "",
    advanceNoticeDays: String(record?.advanceNoticeDays ?? 3),
    materializeDaysAhead: String(record?.materializeDaysAhead ?? 45),
    amount: record ? minorAmountToInput(record.template.amountMinor) : "",
    currencyCode: record?.template.currencyCode ?? "CAD",
    categoryId: record?.template.categoryId ?? "",
    paymentMethodId: record?.template.paymentMethodId ?? "",
    householdMemberId: record?.template.householdMemberId ?? "",
    locationId: record?.template.locationId ?? "",
    merchant: record?.template.merchant ?? "",
    note: record?.template.note ?? "",
    isActive: record?.isActive ?? true,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "无法保存周期项目"
}

function showError(error: Error) {
  toast.error(error.message)
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}
