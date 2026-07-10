import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction"
import FullCalendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/timegrid"
import type {
  DatesSetArg,
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { addDays, format, parseISO, subDays } from "date-fns"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"
import {
  CalendarDaysIcon,
  CalendarPlusIcon,
  CalendarRangeIcon,
  CircleAlertIcon,
  Link2Icon,
  NotebookPenIcon,
  PaperclipIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { AttachmentManager } from "@/features/attachments/attachment-manager"
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
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  commandGateway,
  type CalendarEventRecord,
  type CalendarEventType,
  type CreateCalendarEventInput,
  type DailyFinancialSummary,
  type DailyNoteRecord,
  type HouseholdMember,
  type Location,
  type ReminderDeliveryRecord,
  type TransactionRecord,
} from "@/lib/commands"
import { formatMinorAmount } from "@/lib/money"
import { calendarColorFor, defaultCalendarColorOverrides, type CalendarColorOverrides } from "@/lib/calendar-colors"
import { RecurringTransactionsPanel } from "@/features/calendar/recurring-transactions-panel"
import { RecurringEventsPanel } from "@/features/calendar/recurring-events-panel"
import { YearOverview } from "@/features/calendar/year-overview"

type VisibleRange = { start: string; endExclusive: string }
type EventEditor = { record?: CalendarEventRecord; initialDate?: string } | null

export function CalendarPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get("focus")
  const now = new Date()
  const calendarRef = useRef<FullCalendar>(null)
  const lastCalendarDateRef = useRef(new Date(now.getFullYear(), now.getMonth(), 1))
  const [calendarMode, setCalendarMode] = useState<"calendar" | "year">("calendar")
  const [overviewYear, setOverviewYear] = useState(now.getFullYear())
  const [calendarTarget, setCalendarTarget] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [visibleRange, setVisibleRange] = useState<VisibleRange>(() => ({
    start: format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"),
    endExclusive: format(new Date(now.getFullYear(), now.getMonth() + 1, 1), "yyyy-MM-dd"),
  }))
  const [eventType, setEventType] = useState<"all" | CalendarEventType>("all")
  const [memberId, setMemberId] = useState("all")
  const [editor, setEditor] = useState<EventEditor>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CalendarEventRecord | null>(null)
  const settings = useQuery({ queryKey: ["settings"], queryFn: commandGateway.getSettings })
  const references = useQuery({
    queryKey: ["transaction-reference-data"],
    queryFn: commandGateway.listTransactionReferenceData,
  })
  const timezoneId = settings.data?.timezoneId ?? "America/Toronto"
  const calendarColors = settings.data?.calendarColorOverrides ?? defaultCalendarColorOverrides
  const events = useQuery({
    queryKey: ["calendar-events", visibleRange, timezoneId, eventType, memberId],
    queryFn: () =>
      commandGateway.listCalendarEvents({
        rangeStartDate: visibleRange.start,
        rangeEndDateExclusive: visibleRange.endExclusive,
        timezoneId,
        eventType: eventType === "all" ? undefined : eventType,
        householdMemberId: memberId === "all" ? undefined : memberId,
      }),
  })
  const focusedEvent = useQuery({
    queryKey: ["calendar-events", "focus", focusId],
    queryFn: () => commandGateway.getCalendarEvent({ id: focusId! }),
    enabled: Boolean(focusId),
  })
  const activeEditor: EventEditor = editor ?? (focusId && focusedEvent.data ? { record: focusedEvent.data } : null)
  const clearFocusedResult = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("focus")
    next.delete("attachment")
    setSearchParams(next, { replace: true })
  }
  const dailySummaries = useQuery({
    queryKey: ["daily-financial-summaries", visibleRange],
    queryFn: () =>
      commandGateway.listDailyFinancialSummaries({
        rangeStartDate: visibleRange.start,
        rangeEndDateExclusive: visibleRange.endExclusive,
      }),
    enabled: calendarMode === "calendar",
  })
  const yearReminders = useQuery({
    queryKey: ["reminder-deliveries", "year", overviewYear, timezoneId],
    queryFn: () =>
      commandGateway.listReminderDeliveries({
        rangeStartUtc: fromZonedTime(`${overviewYear}-01-01T00:00:00`, timezoneId).toISOString(),
        rangeEndUtc: fromZonedTime(`${overviewYear + 1}-01-01T00:00:00`, timezoneId).toISOString(),
      }),
    enabled: calendarMode === "year",
  })
  const summariesByDate = useMemo(() => {
    const result = new Map<string, DailyFinancialSummary[]>()
    for (const summary of dailySummaries.data ?? []) {
      const current = result.get(summary.summaryDate) ?? []
      current.push(summary)
      result.set(summary.summaryDate, current)
    }
    return result
  }, [dailySummaries.data])
  const calendarEvents = useMemo<EventInput[]>(
    () =>
      (events.data ?? []).map((event) => ({
        id: event.id,
        title: event.title,
        allDay: event.isAllDay,
        start: event.startDate ?? event.startAtUtc ?? undefined,
        end: event.endDateExclusive ?? event.endAtUtc ?? undefined,
        backgroundColor: event.color ?? calendarColorFor(event.eventType, calendarColors),
        borderColor: event.color ?? calendarColorFor(event.eventType, calendarColors),
        classNames: event.isCompleted ? ["opacity-60"] : [],
        extendedProps: { record: event },
      })),
    [calendarColors, events.data],
  )
  const restoreMutation = useMutation({
    mutationFn: commandGateway.restoreCalendarEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      toast.success(t("calendar.restored"))
    },
  })
  const deleteMutation = useMutation({
    mutationFn: commandGateway.deleteCalendarEvent,
    onSuccess: async (result) => {
      setDeleteTarget(null)
      setEditor(null)
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      toast.success(t("calendar.deleted"), {
        action: { label: t("transactions.undo"), onClick: () => restoreMutation.mutate(result) },
      })
    },
    onError: showError,
  })
  const onDatesSet = (info: DatesSetArg) => {
    lastCalendarDateRef.current = info.view.currentStart
    setVisibleRange({ start: format(info.start, "yyyy-MM-dd"), endExclusive: format(info.end, "yyyy-MM-dd") })
  }
  const onEventClick = (info: EventClickArg) => {
    const record =
      (info.event.extendedProps.record as CalendarEventRecord | undefined) ??
      events.data?.find((event) => event.id === info.event.id)
    if (record) setEditor({ record })
  }
  const renderEventContent = (info: EventContentArg) => {
    const record = info.event.extendedProps.record as CalendarEventRecord | undefined
    return (
      <span
        className="block w-full truncate"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (record) setEditor({ record })
        }}
      >
        {info.event.title}
      </span>
    )
  }
  const onEventDidMount = (info: EventMountArg) => {
    const record = info.event.extendedProps.record as CalendarEventRecord | undefined
    if (!record) return
    info.el.setAttribute("role", "button")
    info.el.setAttribute("tabindex", "0")
    info.el.setAttribute("aria-label", `${t("calendar.edit")}: ${record.title}`)
    const open = () => setEditor({ record })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      open()
    }
    info.el.addEventListener("click", open)
    info.el.addEventListener("keydown", onKeyDown)
  }
  const onDateClick = (info: DateClickArg) => {
    setSelectedDate(info.dateStr.slice(0, 10))
  }
  useEffect(() => {
    if (calendarMode === "calendar") calendarRef.current?.getApi().gotoDate(calendarTarget)
  }, [calendarMode, calendarTarget])
  const showYearOverview = (year: number) => {
    setOverviewYear(year)
    setVisibleRange({ start: `${year}-01-01`, endExclusive: `${year + 1}-01-01` })
    setCalendarMode("year")
  }

  return (
    <>
      <PageHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (calendarMode === "year") {
                  setCalendarTarget(lastCalendarDateRef.current)
                  setCalendarMode("calendar")
                } else {
                  showYearOverview(lastCalendarDateRef.current.getFullYear())
                }
              }}
            >
              {calendarMode === "year" ? (
                <CalendarDaysIcon data-icon="inline-start" />
              ) : (
                <CalendarRangeIcon data-icon="inline-start" />
              )}
              {t(calendarMode === "year" ? "calendar.monthView" : "calendar.yearView")}
            </Button>
            <Button onClick={() => setEditor({ initialDate: format(new Date(), "yyyy-MM-dd") })}>
              <CalendarPlusIcon data-icon="inline-start" />
              {t("calendar.add")}
            </Button>
          </div>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-8">
        <div className="flex flex-col gap-3 sm:flex-row">
          <CalendarFilter
            label={t("calendar.eventType")}
            value={eventType}
            onValueChange={(value) => setEventType(value as "all" | CalendarEventType)}
            items={[
              { value: "all", label: t("transactions.all") },
              ...eventTypes().map((value) => ({ value, label: t(`calendar.types.${value}`) })),
            ]}
          />
          <CalendarFilter
            label={t("transactions.householdMember")}
            value={memberId}
            onValueChange={setMemberId}
            items={[
              { value: "all", label: t("transactions.all") },
              ...(references.data?.householdMembers
                .filter((member) => member.isActive)
                .map((member) => ({
                  value: member.id,
                  label: member.displayName,
                })) ?? []),
            ]}
          />
        </div>
        {events.isError ? (
          <Empty className="min-h-96 rounded-lg border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlertIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("calendar.loadError")}</EmptyTitle>
              <EmptyDescription>{t("transactions.loadErrorDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : calendarMode === "year" ? (
          <YearOverview
            year={overviewYear}
            locale={i18n.language}
            events={events.data ?? []}
            calendarColors={calendarColors}
            reminders={(yearReminders.data ?? []) as ReminderDeliveryRecord[]}
            onYearChange={showYearOverview}
            onMonthSelect={(month) => {
              const target = new Date(overviewYear, month, 1)
              lastCalendarDateRef.current = target
              setCalendarTarget(target)
              setCalendarMode("calendar")
            }}
          />
        ) : (
          <Card className="min-w-0 overflow-hidden">
            <CardContent className="p-3 lg:p-5">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                headerToolbar={{
                  left: "prev,next today",
                  center: "title",
                  right: "dayGridMonth,timeGridWeek,timeGridDay",
                }}
                buttonText={{
                  today: t("calendar.today"),
                  month: t("calendar.month"),
                  week: t("calendar.week"),
                  day: t("calendar.day"),
                }}
                events={calendarEvents}
                datesSet={onDatesSet}
                dateClick={onDateClick}
                eventClick={onEventClick}
                eventContent={renderEventContent}
                eventDidMount={onEventDidMount}
                dayCellContent={(info) => (
                  <CalendarDayCell
                    info={info}
                    summaries={summariesByDate.get(format(info.date, "yyyy-MM-dd")) ?? []}
                    locale={i18n.language}
                  />
                )}
                height="auto"
                nowIndicator
                dayMaxEvents={4}
                eventDisplay="block"
                firstDay={1}
              />
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          <RecurringTransactionsPanel timezoneId={timezoneId} references={references.data} />
          <RecurringEventsPanel timezoneId={timezoneId} references={references.data} />
        </div>
      </main>
      <EventFormSheet
        editor={activeEditor}
        timezoneId={timezoneId}
        members={references.data?.householdMembers ?? []}
        locations={references.data?.locations ?? []}
        calendarColors={calendarColors}
        onOpenChange={(open) => {
          if (open) return
          setEditor(null)
          clearFocusedResult()
        }}
        onDelete={(record) => setDeleteTarget(record)}
        onRecordChange={(record) => setEditor({ record })}
      />
      <DayDetailSheet
        date={selectedDate}
        events={events.data ?? []}
        calendarColors={calendarColors}
        locale={i18n.language}
        onOpenChange={(open) => !open && setSelectedDate(null)}
        onEditEvent={(record) => {
          setSelectedDate(null)
          setEditor({ record })
        }}
        onAddEvent={(date) => {
          setSelectedDate(null)
          setEditor({ initialDate: date })
        }}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("calendar.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("calendar.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("transactions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, version: deleteTarget.version })
              }
            >
              {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("transactions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CalendarDayCell({
  info,
  summaries,
  locale,
}: {
  info: DayCellContentArg
  summaries: DailyFinancialSummary[]
  locale: string
}) {
  const { t } = useTranslation()
  const planned = summaries.reduce((total, item) => total + item.plannedCount + item.pendingCount, 0)
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-right">{info.dayNumberText}</span>
      {summaries
        .filter((item) => item.reportingCurrencyCode)
        .map((item) => (
          <span key={item.reportingCurrencyCode} className="truncate text-[10px] leading-tight text-muted-foreground">
            {item.incomeMinor > 0
              ? `${t("calendar.incomeShort")} ${formatMinorAmount(item.incomeMinor, item.reportingCurrencyCode!, locale)}`
              : null}
            {item.incomeMinor > 0 && item.expenseMinor > 0 ? " · " : null}
            {item.expenseMinor > 0
              ? `${t("calendar.expenseShort")} ${formatMinorAmount(item.expenseMinor, item.reportingCurrencyCode!, locale)}`
              : null}
          </span>
        ))}
      {planned > 0 ? (
        <span className="truncate text-[10px] leading-tight text-amber-700 dark:text-amber-400">
          {t("calendar.plannedShort", { count: planned })}
        </span>
      ) : null}
    </div>
  )
}

function CalendarFilter({
  label,
  value,
  onValueChange,
  items,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  items: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full sm:w-56" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "请输入事件标题").max(200),
    description: z.string().max(4000),
    eventType: z.enum(eventTypes()),
    isAllDay: z.boolean(),
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    priority: z.enum(["normal", "important"]),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    locationId: z.string(),
    householdMemberId: z.string(),
    isCompleted: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.isAllDay && (!value.startDate || !value.endDate || value.startDate > value.endDate)) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "结束日期不能早于开始日期" })
    }
    if (!value.isAllDay && (!value.startTime || !value.endTime || value.startTime >= value.endTime)) {
      context.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" })
    }
  })
type EventFormValues = z.infer<typeof eventFormSchema>

function EventFormSheet({
  editor,
  timezoneId,
  members,
  locations,
  calendarColors,
  onOpenChange,
  onDelete,
  onRecordChange,
}: {
  editor: EventEditor
  timezoneId: string
  members: HouseholdMember[]
  locations: Location[]
  calendarColors: CalendarColorOverrides
  onOpenChange: (open: boolean) => void
  onDelete: (record: CalendarEventRecord) => void
  onRecordChange: (record: CalendarEventRecord) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const record = editor?.record
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: eventValues(record, editor?.initialDate, timezoneId, calendarColors),
  })
  useEffect(() => {
    if (editor) form.reset(eventValues(record, editor.initialDate, timezoneId, calendarColors))
  }, [calendarColors, editor, form, record, timezoneId])
  const isAllDay = useWatch({ control: form.control, name: "isAllDay" })
  const eventDateFrom = record
    ? (record.startDate ?? formatInTimeZone(record.startAtUtc!, record.timezoneId, "yyyy-MM-dd"))
    : null
  const eventDateTo = record
    ? record.endDateExclusive
      ? format(subDays(parseISO(record.endDateExclusive), 1), "yyyy-MM-dd")
      : formatInTimeZone(record.endAtUtc!, record.timezoneId, "yyyy-MM-dd")
    : null
  const candidateTransactions = useQuery({
    queryKey: ["transactions", "event-link-candidates", record?.id, eventDateFrom, eventDateTo],
    queryFn: () => commandGateway.listTransactions({ dateFrom: eventDateFrom!, dateTo: eventDateTo!, limit: 500 }),
    enabled: Boolean(record && eventDateFrom && eventDateTo),
  })
  const linkMutation = useMutation({
    mutationFn: ({ transactionId, linked }: { transactionId: string; linked: boolean }) =>
      linked
        ? commandGateway.linkEventTransaction({ eventId: record!.id, transactionId })
        : commandGateway.unlinkEventTransaction({ eventId: record!.id, transactionId }),
    onSuccess: async (updated) => {
      onRecordChange(updated)
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      toast.success(t("calendar.linkUpdated"))
    },
    onError: showError,
  })
  const mutation = useMutation({
    mutationFn: (input: CreateCalendarEventInput) =>
      record
        ? commandGateway.updateCalendarEvent({ id: record.id, version: record.version, ...input })
        : commandGateway.createCalendarEvent(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      toast.success(t(record ? "calendar.updated" : "calendar.created"))
      onOpenChange(false)
    },
    onError: showError,
  })
  const submit = (values: EventFormValues) =>
    mutation.mutate({
      title: values.title,
      description: values.description || null,
      eventType: values.eventType,
      isAllDay: values.isAllDay,
      startDate: values.isAllDay ? values.startDate : null,
      endDateExclusive: values.isAllDay ? format(addDays(parseISO(values.endDate), 1), "yyyy-MM-dd") : null,
      startAtUtc: values.isAllDay ? null : fromZonedTime(values.startTime, timezoneId).toISOString(),
      endAtUtc: values.isAllDay ? null : fromZonedTime(values.endTime, timezoneId).toISOString(),
      timezoneId,
      priority: values.priority,
      color:
        values.color === calendarColorFor(values.eventType, calendarColors) && (!record || record.color === null)
          ? null
          : values.color,
      icon: null,
      locationId: values.locationId || null,
      householdMemberId: values.householdMemberId || null,
      isCompleted: values.isCompleted,
    })
  return (
    <Sheet open={Boolean(editor)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t(record ? "calendar.editTitle" : "calendar.add")}</SheetTitle>
          <SheetDescription>{t("calendar.formDescription", { timezone: timezoneId })}</SheetDescription>
        </SheetHeader>
        <form id="event-form" className="px-4" onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <EventTextField control={form.control} name="title" label={t("calendar.eventTitle")} />
            <EventSelectField
              control={form.control}
              name="eventType"
              label={t("calendar.eventType")}
              items={eventTypes().map((value) => ({ value, label: t(`calendar.types.${value}`) }))}
              onValueChange={(value) => {
                if (!record || record.color === null)
                  form.setValue("color", calendarColorFor(value as CalendarEventType, calendarColors), {
                    shouldDirty: true,
                  })
              }}
            />
            <Controller
              control={form.control}
              name="isAllDay"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldLabel className="flex-1" htmlFor="event-all-day">
                    {t("calendar.allDay")}
                  </FieldLabel>
                  <Switch id="event-all-day" checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
            {isAllDay ? (
              <>
                <EventTextField control={form.control} name="startDate" label={t("calendar.startDate")} type="date" />
                <EventTextField control={form.control} name="endDate" label={t("calendar.endDate")} type="date" />
              </>
            ) : (
              <>
                <EventTextField
                  control={form.control}
                  name="startTime"
                  label={t("calendar.startTime")}
                  type="datetime-local"
                />
                <EventTextField
                  control={form.control}
                  name="endTime"
                  label={t("calendar.endTime")}
                  type="datetime-local"
                />
              </>
            )}
            <EventSelectField
              control={form.control}
              name="priority"
              label={t("calendar.priority")}
              items={[
                { value: "normal", label: t("calendar.priorities.normal") },
                { value: "important", label: t("calendar.priorities.important") },
              ]}
            />
            <EventTextField control={form.control} name="color" label={t("calendar.color")} type="color" />
            <EventSelectField
              control={form.control}
              name="householdMemberId"
              label={t("transactions.householdMember")}
              allowEmpty
              items={members
                .filter((item) => item.isActive || item.id === record?.householdMemberId)
                .map((item) => ({ value: item.id, label: item.displayName }))}
            />
            <EventSelectField
              control={form.control}
              name="locationId"
              label={t("transactions.location")}
              allowEmpty
              items={locations
                .filter((item) => item.isActive || item.id === record?.locationId)
                .map((item) => ({ value: item.id, label: item.name }))}
            />
            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="event-description">{t("calendar.notes")}</FieldLabel>
                  <Textarea {...field} id="event-description" rows={4} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="isCompleted"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor="event-completed">{t("calendar.completed")}</FieldLabel>
                    <FieldDescription>{t("calendar.completedDescription")}</FieldDescription>
                  </div>
                  <Switch id="event-completed" checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        {record ? (
          <div className="px-4">
            <AttachmentManager ownerType="event" ownerId={record.id} />
          </div>
        ) : null}
        {record ? (
          <section className="grid gap-3 border-t px-4 pt-4">
            <div>
              <h3 className="font-medium">{t("calendar.linkedTransactions")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("calendar.linkedTransactionsDescription", { count: record.linkedTransactionCount })}
              </p>
            </div>
            {candidateTransactions.isLoading ? <Spinner /> : null}
            {candidateTransactions.data?.records.length ? (
              candidateTransactions.data.records.map((transaction) => {
                const linked = record.linkedTransactionIds.includes(transaction.id)
                return (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {transaction.merchant ?? transaction.note ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {transaction.transactionDate} ·{" "}
                        {formatMinorAmount(transaction.amountMinor, transaction.currencyCode)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={linked ? "outline" : "secondary"}
                      disabled={linkMutation.isPending}
                      onClick={() => linkMutation.mutate({ transactionId: transaction.id, linked: !linked })}
                    >
                      {linked ? <UnlinkIcon data-icon="inline-start" /> : <Link2Icon data-icon="inline-start" />}
                      {t(linked ? "calendar.unlink" : "calendar.link")}
                    </Button>
                  </div>
                )
              })
            ) : candidateTransactions.isLoading ? null : (
              <p className="text-sm text-muted-foreground">{t("calendar.noLinkCandidates")}</p>
            )}
          </section>
        ) : null}
        <SheetFooter className="sm:justify-between">
          {record ? (
            <Button variant="destructive" onClick={() => onDelete(record)}>
              <Trash2Icon data-icon="inline-start" />
              {t("transactions.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" form="event-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("calendar.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

type EventTextName = "title" | "startDate" | "endDate" | "startTime" | "endTime" | "color"
function EventTextField({
  control,
  name,
  label,
  type = "text",
}: {
  control: Control<EventFormValues>
  name: EventTextName
  label: string
  type?: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`event-${name}`}>{label}</FieldLabel>
          <Input {...field} id={`event-${name}`} type={type} aria-invalid={fieldState.invalid} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function EventSelectField({
  control,
  name,
  label,
  items,
  allowEmpty = false,
  onValueChange,
}: {
  control: Control<EventFormValues>
  name: "eventType" | "priority" | "householdMemberId" | "locationId"
  label: string
  items: Array<{ value: string; label: string }>
  allowEmpty?: boolean
  onValueChange?: (value: string) => void
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`event-${name}`}>{label}</FieldLabel>
          <Select
            value={field.value || "__empty"}
            onValueChange={(value) => {
              const nextValue = value === "__empty" ? "" : value
              field.onChange(nextValue)
              onValueChange?.(nextValue)
            }}
          >
            <SelectTrigger id={`event-${name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {allowEmpty ? <SelectItem value="__empty">—</SelectItem> : null}
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function DayDetailSheet({
  date,
  events,
  calendarColors,
  locale,
  onOpenChange,
  onEditEvent,
  onAddEvent,
}: {
  date: string | null
  events: CalendarEventRecord[]
  calendarColors: CalendarColorOverrides
  locale: string
  onOpenChange: (open: boolean) => void
  onEditEvent: (record: CalendarEventRecord) => void
  onAddEvent: (date: string) => void
}) {
  const { t } = useTranslation()
  const transactions = useQuery({
    queryKey: ["transactions", "calendar-day", date],
    queryFn: () => commandGateway.listTransactions({ dateFrom: date!, dateTo: date!, limit: 500 }),
    enabled: Boolean(date),
  })
  const dayEvents = date
    ? events.filter((event) =>
        event.isAllDay
          ? event.startDate! <= date && event.endDateExclusive! > date
          : formatInTimeZone(event.startAtUtc!, event.timezoneId, "yyyy-MM-dd") === date,
      )
    : []
  return (
    <Sheet open={Boolean(date)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{date ? format(parseISO(date), "yyyy-MM-dd") : ""}</SheetTitle>
          <SheetDescription>{t("calendar.dayDescription")}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4">
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{t("calendar.eventsCount", { count: dayEvents.length })}</h3>
              {date ? (
                <Button size="sm" onClick={() => onAddEvent(date)}>
                  <CalendarPlusIcon data-icon="inline-start" />
                  {t("calendar.add")}
                </Button>
              ) : null}
            </div>
            {dayEvents.length ? (
              dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted"
                  onClick={() => onEditEvent(event)}
                >
                  <span
                    className="mr-3 size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: event.color ?? calendarColorFor(event.eventType, calendarColors) }}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block font-medium">{event.title}</span>
                    <span className="text-xs text-muted-foreground">{t(`calendar.types.${event.eventType}`)}</span>
                  </span>
                  <PencilIcon aria-hidden="true" className="size-4" />
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("calendar.noEvents")}</p>
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="font-medium">{t("calendar.transactionsCount", { count: transactions.data?.total ?? 0 })}</h3>
            {transactions.data?.records.map((record) => (
              <TransactionDayRow key={record.id} record={record} locale={locale} />
            ))}
            {transactions.isLoading ? <Spinner /> : null}
          </section>
          {date ? <DailyNotePanel date={date} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DailyNotePanel({ date }: { date: string }) {
  const note = useQuery({
    queryKey: ["daily-note", date, null],
    queryFn: () => commandGateway.getDailyNote({ noteDate: date, householdMemberId: null }),
  })
  if (note.isLoading) return <Spinner />
  return <DailyNoteEditor key={`${date}-${note.data?.version ?? "new"}`} date={date} record={note.data ?? null} />
}

function DailyNoteEditor({ date, record }: { date: string; record: DailyNoteRecord | null }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const queryClient = useQueryClient()
  const [value, setValue] = useState(record?.note ?? "")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      commandGateway.saveDailyNote({
        id: record?.id ?? null,
        version: record?.version ?? null,
        noteDate: date,
        householdMemberId: null,
        note: value,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["daily-note", date, null], saved)
      await queryClient.invalidateQueries({ queryKey: ["daily-note"] })
      toast.success(zh ? "每日备注已保存" : "Daily note saved")
    },
    onError: showError,
  })
  const remove = useMutation({
    mutationFn: () => commandGateway.deleteDailyNote({ id: record!.id, version: record!.version }),
    onSuccess: async () => {
      setDeleteOpen(false)
      queryClient.setQueryData(["daily-note", date, null], null)
      await queryClient.invalidateQueries({ queryKey: ["daily-note"] })
      toast.success(zh ? "每日备注已删除" : "Daily note deleted")
    },
    onError: showError,
  })
  const hasUnsavedChanges = value !== (record?.note ?? "")

  return (
    <section className="grid gap-3" aria-labelledby="daily-note-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="daily-note-heading" className="flex items-center gap-2 font-medium">
          <NotebookPenIcon aria-hidden="true" />
          {zh ? "当天备注" : "Daily note"}
        </h3>
        {record ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={remove.isPending || record.attachmentCount > 0}
            title={record.attachmentCount > 0 ? (zh ? "请先移除附件" : "Remove attachments first") : undefined}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            {zh ? "删除备注" : "Delete note"}
          </Button>
        ) : null}
      </div>
      <Field>
        <FieldLabel htmlFor={`daily-note-${date}`}>{zh ? "生活记录" : "Life note"}</FieldLabel>
        <Textarea
          id={`daily-note-${date}`}
          value={value}
          maxLength={10_000}
          rows={5}
          placeholder={zh ? "记录这一天发生的事情…" : "Write down what happened today…"}
          onChange={(event) => setValue(event.target.value)}
        />
        <FieldDescription>
          {zh
            ? `${value.length}/10000 字；备注和附件只保存在本机。`
            : `${value.length}/10000 characters; notes and attachments stay on this device.`}
        </FieldDescription>
      </Field>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={save.isPending || (!hasUnsavedChanges && record !== null)}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {record ? (zh ? "保存修改" : "Save changes") : zh ? "保存备注" : "Save note"}
        </Button>
      </div>

      {record ? (
        <AttachmentManager ownerType="daily_note" ownerId={record.id} />
      ) : (
        <Alert>
          <PaperclipIcon aria-hidden="true" />
          <AlertTitle>{zh ? "保存后可以添加附件" : "Save before adding attachments"}</AlertTitle>
          <AlertDescription>
            {zh
              ? "先保存当天备注，系统会创建可追溯的本地记录，然后才能关联照片、PDF 或其他文件。"
              : "Save the daily note first so files can be linked to a traceable local record."}
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{zh ? "删除当天备注？" : "Delete this daily note?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {zh
                ? "备注会从这一天移除。若存在附件，必须先逐个移除，系统不会静默删除文件。"
                : "The note will be removed from this date. Attachments must be removed first and are never deleted silently."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{zh ? "取消" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {zh ? "确认删除" : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function TransactionDayRow({ record, locale }: { record: TransactionRecord; locale: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium">{record.merchant ?? record.note ?? "—"}</span>
        <Badge variant="outline">{record.transactionType}</Badge>
      </span>
      <span className="font-medium tabular-nums">
        {formatMinorAmount(record.amountMinor, record.currencyCode, locale)}
      </span>
    </div>
  )
}

function eventValues(
  record: CalendarEventRecord | undefined,
  initialDate: string | undefined,
  timezoneId: string,
  calendarColors: CalendarColorOverrides,
): EventFormValues {
  const date = initialDate ?? format(new Date(), "yyyy-MM-dd")
  return {
    title: record?.title ?? "",
    description: record?.description ?? "",
    eventType: record?.eventType ?? "general",
    isAllDay: record?.isAllDay ?? true,
    startDate: record?.startDate ?? date,
    endDate: record?.endDateExclusive ? format(subDays(parseISO(record.endDateExclusive), 1), "yyyy-MM-dd") : date,
    startTime: record?.startAtUtc
      ? formatInTimeZone(record.startAtUtc, timezoneId, "yyyy-MM-dd'T'HH:mm")
      : `${date}T09:00`,
    endTime: record?.endAtUtc ? formatInTimeZone(record.endAtUtc, timezoneId, "yyyy-MM-dd'T'HH:mm") : `${date}T10:00`,
    priority: record?.priority ?? "normal",
    color: record?.color ?? calendarColorFor(record?.eventType ?? "general", calendarColors),
    locationId: record?.locationId ?? "",
    householdMemberId: record?.householdMemberId ?? "",
    isCompleted: record?.isCompleted ?? false,
  }
}

function eventTypes() {
  return ["general", "important", "travel", "medical", "education", "bill", "tax", "maintenance", "other"] as const
}

function showError(error: Error) {
  toast.error(error.message)
}
