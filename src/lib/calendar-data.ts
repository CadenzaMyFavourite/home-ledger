import { fromZonedTime } from "date-fns-tz"
import { z } from "zod"

import { readBrowserReferenceData, readBrowserTransactions } from "@/lib/transaction-data"

export const calendarEventTypeSchema = z.enum([
  "general",
  "important",
  "travel",
  "medical",
  "education",
  "bill",
  "tax",
  "maintenance",
  "other",
])
export const eventPrioritySchema = z.enum(["normal", "important"])

export const createCalendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).nullable(),
    eventType: calendarEventTypeSchema,
    isAllDay: z.boolean(),
    startDate: z.string().date().nullable(),
    endDateExclusive: z.string().date().nullable(),
    startAtUtc: z.string().datetime({ offset: true }).nullable(),
    endAtUtc: z.string().datetime({ offset: true }).nullable(),
    timezoneId: z.string().min(1).max(100),
    priority: eventPrioritySchema,
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    icon: z.string().trim().nullable(),
    locationId: z.string().nullable(),
    householdMemberId: z.string().nullable(),
    isCompleted: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.isAllDay) {
      if (!value.startDate || !value.endDateExclusive || value.startDate >= value.endDateExclusive) {
        context.addIssue({ code: "custom", path: ["endDateExclusive"], message: "结束日期必须晚于开始日期" })
      }
      if (value.startAtUtc || value.endAtUtc) {
        context.addIssue({ code: "custom", path: ["isAllDay"], message: "全天事件不能包含 UTC 时间" })
      }
    } else {
      if (!value.startAtUtc || !value.endAtUtc || value.startAtUtc >= value.endAtUtc) {
        context.addIssue({ code: "custom", path: ["endAtUtc"], message: "结束时间必须晚于开始时间" })
      }
      if (value.startDate || value.endDateExclusive) {
        context.addIssue({ code: "custom", path: ["isAllDay"], message: "定时事件不能包含全天日期" })
      }
    }
  })

export const updateCalendarEventInputSchema = createCalendarEventInputSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
})
export const calendarEventVersionInputSchema = z.object({ id: z.string().min(1), version: z.number().int().positive() })
export const calendarEventIdInputSchema = z.object({ id: z.string().min(1).max(100) }).strict()
export const eventTransactionLinkInputSchema = z.object({
  eventId: z.string().min(1),
  transactionId: z.string().min(1),
})
export const listCalendarEventsInputSchema = z
  .object({
    rangeStartDate: z.string().date(),
    rangeEndDateExclusive: z.string().date(),
    timezoneId: z.string().min(1).max(100),
    eventType: calendarEventTypeSchema.optional(),
    householdMemberId: z.string().min(1).optional(),
  })
  .refine((value) => value.rangeStartDate < value.rangeEndDateExclusive, {
    path: ["rangeEndDateExclusive"],
    message: "结束日期必须晚于开始日期",
  })
export const dailyFinancialSummaryInputSchema = z
  .object({
    rangeStartDate: z.string().date(),
    rangeEndDateExclusive: z.string().date(),
  })
  .refine((value) => value.rangeStartDate < value.rangeEndDateExclusive, {
    path: ["rangeEndDateExclusive"],
    message: "结束日期必须晚于开始日期",
  })
export const dailyFinancialSummarySchema = z.object({
  summaryDate: z.string().date(),
  reportingCurrencyCode: z.string().nullable(),
  incomeMinor: z.number().int(),
  expenseMinor: z.number().int(),
  plannedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
})

export const calendarEventRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  eventType: calendarEventTypeSchema,
  isAllDay: z.boolean(),
  startDate: z.string().nullable(),
  endDateExclusive: z.string().nullable(),
  startAtUtc: z.string().nullable(),
  endAtUtc: z.string().nullable(),
  timezoneId: z.string(),
  priority: eventPrioritySchema,
  color: z.string().nullable(),
  icon: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  householdMemberId: z.string().nullable(),
  householdMemberName: z.string().nullable(),
  isCompleted: z.boolean(),
  linkedTransactionCount: z.number().int().nonnegative(),
  linkedTransactionIds: z.array(z.string()).default([]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type CalendarEventType = z.infer<typeof calendarEventTypeSchema>
export type EventPriority = z.infer<typeof eventPrioritySchema>
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventInputSchema>
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventInputSchema>
export type CalendarEventVersionInput = z.infer<typeof calendarEventVersionInputSchema>
export type CalendarEventIdInput = z.infer<typeof calendarEventIdInputSchema>
export type EventTransactionLinkInput = z.infer<typeof eventTransactionLinkInputSchema>
export type ListCalendarEventsInput = z.infer<typeof listCalendarEventsInputSchema>
export type CalendarEventRecord = z.infer<typeof calendarEventRecordSchema>
export type DailyFinancialSummaryInput = z.infer<typeof dailyFinancialSummaryInputSchema>
export type DailyFinancialSummary = z.infer<typeof dailyFinancialSummarySchema>

const browserEventStorageKey = "home-ledger.browser-calendar-events"
const browserDeletedEventStorageKey = "home-ledger.browser-deleted-calendar-events"

function readEvents(key: string): CalendarEventRecord[] {
  try {
    const parsed = z.array(calendarEventRecordSchema).safeParse(JSON.parse(window.localStorage.getItem(key) ?? "[]"))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeEvents(key: string, events: CalendarEventRecord[]) {
  window.localStorage.setItem(key, JSON.stringify(events))
}

export function listBrowserCalendarEvents(input: ListCalendarEventsInput): CalendarEventRecord[] {
  const validated = listCalendarEventsInputSchema.parse(input)
  const startUtc = fromZonedTime(`${validated.rangeStartDate}T00:00:00`, validated.timezoneId).toISOString()
  const endUtc = fromZonedTime(`${validated.rangeEndDateExclusive}T00:00:00`, validated.timezoneId).toISOString()
  return readEvents(browserEventStorageKey)
    .filter((event) =>
      event.isAllDay
        ? event.startDate! < validated.rangeEndDateExclusive && event.endDateExclusive! > validated.rangeStartDate
        : event.startAtUtc! < endUtc && event.endAtUtc! > startUtc,
    )
    .filter((event) => !validated.eventType || event.eventType === validated.eventType)
    .filter((event) => !validated.householdMemberId || event.householdMemberId === validated.householdMemberId)
    .toSorted((left, right) =>
      (left.startDate ?? left.startAtUtc ?? "").localeCompare(right.startDate ?? right.startAtUtc ?? ""),
    )
}

export function getBrowserCalendarEvent(input: CalendarEventIdInput): CalendarEventRecord {
  const validated = calendarEventIdInputSchema.parse(input)
  const record = readEvents(browserEventStorageKey).find((event) => event.id === validated.id)
  if (!record) throw new Error("事件不存在")
  return record
}

export function listBrowserDailyFinancialSummaries(input: DailyFinancialSummaryInput): DailyFinancialSummary[] {
  const validated = dailyFinancialSummaryInputSchema.parse(input)
  const summaries = new Map<string, DailyFinancialSummary>()
  for (const transaction of readBrowserTransactions()) {
    if (
      transaction.transactionDate < validated.rangeStartDate ||
      transaction.transactionDate >= validated.rangeEndDateExclusive ||
      transaction.transactionType === "transfer" ||
      transaction.status === "cancelled"
    ) {
      continue
    }
    if (transaction.status === "completed") {
      const key = `${transaction.transactionDate}:${transaction.currencyCode}`
      const summary = summaries.get(key) ?? {
        summaryDate: transaction.transactionDate,
        reportingCurrencyCode: transaction.currencyCode,
        incomeMinor: 0,
        expenseMinor: 0,
        plannedCount: 0,
        pendingCount: 0,
      }
      if (transaction.transactionType === "income") summary.incomeMinor += transaction.amountMinor
      else summary.expenseMinor += transaction.amountMinor
      summaries.set(key, summary)
    } else {
      const key = `${transaction.transactionDate}:planned`
      const summary = summaries.get(key) ?? {
        summaryDate: transaction.transactionDate,
        reportingCurrencyCode: null,
        incomeMinor: 0,
        expenseMinor: 0,
        plannedCount: 0,
        pendingCount: 0,
      }
      if (transaction.status === "planned") summary.plannedCount += 1
      else summary.pendingCount += 1
      summaries.set(key, summary)
    }
  }
  return [...summaries.values()].toSorted((left, right) => left.summaryDate.localeCompare(right.summaryDate))
}

export function createBrowserCalendarEvent(input: CreateCalendarEventInput): CalendarEventRecord {
  return saveBrowserEvent(createCalendarEventInputSchema.parse(input))
}

export function updateBrowserCalendarEvent(input: UpdateCalendarEventInput): CalendarEventRecord {
  const validated = updateCalendarEventInputSchema.parse(input)
  const events = readEvents(browserEventStorageKey)
  const existing = events.find((event) => event.id === validated.id && event.version === validated.version)
  if (!existing) throw new Error("事件已被修改或删除，请刷新后重试")
  return saveBrowserEvent(validated, existing)
}

function saveBrowserEvent(
  input: CreateCalendarEventInput | UpdateCalendarEventInput,
  existing?: CalendarEventRecord,
): CalendarEventRecord {
  const references = readBrowserReferenceData()
  const member = input.householdMemberId
    ? references.householdMembers.find((item) => item.id === input.householdMemberId && item.isActive)
    : references.householdMembers.find((item) => item.isDefault && item.isActive)
  const location = input.locationId
    ? references.locations.find((item) => item.id === input.locationId && item.isActive)
    : undefined
  if (!member) throw new Error("所选家庭成员不存在或已停用")
  if (input.locationId && !location) throw new Error("所选地点不存在或已停用")
  const now = new Date().toISOString()
  const record: CalendarEventRecord = {
    id: existing?.id ?? window.crypto.randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    eventType: input.eventType,
    isAllDay: input.isAllDay,
    startDate: input.startDate,
    endDateExclusive: input.endDateExclusive,
    startAtUtc: input.startAtUtc,
    endAtUtc: input.endAtUtc,
    timezoneId: input.timezoneId,
    priority: input.priority,
    color: input.color,
    icon: input.icon?.trim() || null,
    locationId: location?.id ?? null,
    locationName: location?.name ?? null,
    householdMemberId: member.id,
    householdMemberName: member.displayName,
    isCompleted: input.isCompleted,
    linkedTransactionCount: existing?.linkedTransactionCount ?? 0,
    linkedTransactionIds: existing?.linkedTransactionIds ?? [],
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const events = readEvents(browserEventStorageKey)
  writeEvents(browserEventStorageKey, [record, ...events.filter((event) => event.id !== record.id)])
  return record
}

export function deleteBrowserCalendarEvent(input: CalendarEventVersionInput): CalendarEventVersionInput {
  const validated = calendarEventVersionInputSchema.parse(input)
  const events = readEvents(browserEventStorageKey)
  const existing = events.find((event) => event.id === validated.id && event.version === validated.version)
  if (!existing) throw new Error("事件已被修改或删除，请刷新后重试")
  const deleted = { ...existing, version: existing.version + 1, updatedAt: new Date().toISOString() }
  writeEvents(
    browserEventStorageKey,
    events.filter((event) => event.id !== existing.id),
  )
  writeEvents(browserDeletedEventStorageKey, [
    deleted,
    ...readEvents(browserDeletedEventStorageKey).filter((event) => event.id !== existing.id),
  ])
  return { id: deleted.id, version: deleted.version }
}

export function restoreBrowserCalendarEvent(input: CalendarEventVersionInput): CalendarEventRecord {
  const validated = calendarEventVersionInputSchema.parse(input)
  const deletedEvents = readEvents(browserDeletedEventStorageKey)
  const existing = deletedEvents.find((event) => event.id === validated.id && event.version === validated.version)
  if (!existing) throw new Error("事件无法恢复，请刷新后重试")
  const restored = { ...existing, version: existing.version + 1, updatedAt: new Date().toISOString() }
  writeEvents(
    browserDeletedEventStorageKey,
    deletedEvents.filter((event) => event.id !== restored.id),
  )
  writeEvents(browserEventStorageKey, [restored, ...readEvents(browserEventStorageKey)])
  return restored
}

export function setBrowserEventTransactionLink(input: EventTransactionLinkInput, linked: boolean): CalendarEventRecord {
  const validated = eventTransactionLinkInputSchema.parse(input)
  const events = readEvents(browserEventStorageKey)
  const existing = events.find((event) => event.id === validated.eventId)
  const transactionExists = readBrowserTransactions().some((record) => record.id === validated.transactionId)
  if (!existing || !transactionExists) throw new Error("äº‹ä»¶æˆ–äº¤æ˜“ä¸å­˜åœ¨")

  const linkedIds = new Set(existing.linkedTransactionIds)
  if (linked) linkedIds.add(validated.transactionId)
  else linkedIds.delete(validated.transactionId)
  const updated: CalendarEventRecord = {
    ...existing,
    linkedTransactionIds: [...linkedIds],
    linkedTransactionCount: linkedIds.size,
    updatedAt: new Date().toISOString(),
  }
  writeEvents(
    browserEventStorageKey,
    events.map((event) => (event.id === updated.id ? updated : event)),
  )
  return updated
}
