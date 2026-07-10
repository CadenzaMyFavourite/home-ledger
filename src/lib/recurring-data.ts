import { addDays, addWeeks, format, parseISO } from "date-fns"
import { fromZonedTime } from "date-fns-tz"
import { z } from "zod"

import { calendarEventTypeSchema, createBrowserCalendarEvent, eventPrioritySchema } from "@/lib/calendar-data"
import { createBrowserTransaction, readBrowserReferenceData, transactionTypeSchema } from "@/lib/transaction-data"

export const recurringFrequencySchema = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"])
export const recurringTransactionTemplateSchema = z.object({
  transactionType: transactionTypeSchema,
  amountMinor: z.number().int().positive().safe(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  categoryId: z.string().nullable(),
  paymentMethodId: z.string().nullable(),
  transferToPaymentMethodId: z.string().nullable(),
  transferToAmountMinor: z.number().int().positive().safe().nullable(),
  transferToCurrencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  householdMemberId: z.string().nullable(),
  locationId: z.string().nullable(),
  merchant: z.string().trim().max(200).nullable(),
  note: z.string().max(4000).nullable(),
})
export const saveRecurringTransactionInputSchema = z
  .object({
    id: z.string().min(1).nullable(),
    name: z.string().trim().min(1).max(120),
    frequency: recurringFrequencySchema,
    interval: z.number().int().min(1).max(365),
    customRrule: z.string().trim().max(500).nullable().default(null),
    startDate: z.string().date(),
    endDate: z.string().date().nullable(),
    occurrenceCount: z.number().int().min(1).max(10_000).nullable(),
    timezoneId: z.string().min(1).max(100),
    advanceNoticeDays: z.number().int().min(0).max(365),
    materializeDaysAhead: z.number().int().min(0).max(730),
    isActive: z.boolean(),
    template: recurringTransactionTemplateSchema,
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "结束日期不能早于开始日期",
  })
  .superRefine((value, context) => {
    try {
      if (value.frequency === "custom") parseCustomRrule(value.customRrule ?? "")
      else if (value.customRrule) throw new Error("只有自定义频率可以设置 RRULE")
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["customRrule"],
        message: error instanceof Error ? error.message : "RRULE 无效",
      })
    }
  })
export const recurringTransactionRecordSchema = saveRecurringTransactionInputSchema.safeExtend({
  id: z.string(),
  lastEvaluatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const recurringEventTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable(),
  eventType: calendarEventTypeSchema,
  durationDays: z.number().int().min(1).max(366),
  priority: eventPrioritySchema,
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable(),
  icon: z.string().trim().nullable(),
  locationId: z.string().nullable(),
  householdMemberId: z.string().nullable(),
})
export const saveRecurringEventInputSchema = z
  .object({
    id: z.string().min(1).nullable(),
    name: z.string().trim().min(1).max(120),
    frequency: recurringFrequencySchema,
    interval: z.number().int().min(1).max(365),
    customRrule: z.string().trim().max(500).nullable().default(null),
    startDate: z.string().date(),
    endDate: z.string().date().nullable(),
    occurrenceCount: z.number().int().min(1).max(10_000).nullable(),
    timezoneId: z.string().min(1).max(100),
    advanceNoticeDays: z.number().int().min(0).max(365),
    materializeDaysAhead: z.number().int().min(0).max(730),
    isActive: z.boolean(),
    template: recurringEventTemplateSchema,
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "结束日期不能早于开始日期",
  })
  .superRefine((value, context) => {
    try {
      if (value.frequency === "custom") parseCustomRrule(value.customRrule ?? "")
      else if (value.customRrule) throw new Error("只有自定义频率可以设置 RRULE")
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["customRrule"],
        message: error instanceof Error ? error.message : "RRULE 无效",
      })
    }
  })
export const recurringEventRecordSchema = saveRecurringEventInputSchema.safeExtend({
  id: z.string(),
  lastEvaluatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const materializeRecurringInputSchema = z.object({ asOfDate: z.string().date() })
export const materializeRecurringResultSchema = z.object({
  createdCount: z.number().int().nonnegative(),
  alreadyMaterializedCount: z.number().int().nonnegative(),
})
export const listReminderDeliveriesInputSchema = z.object({
  rangeStartUtc: z.string().datetime({ offset: true }),
  rangeEndUtc: z.string().datetime({ offset: true }),
})
export const reminderDeliveryActionInputSchema = z.object({ id: z.string().min(1) })
export const reminderDeliveryRecordSchema = z.object({
  id: z.string(),
  recurringItemId: z.string(),
  recurringItemName: z.string(),
  occurrenceKey: z.string().date(),
  scheduledForUtc: z.string(),
  transactionId: z.string().nullable(),
  transactionStatus: z.string().nullable(),
  amountMinor: z.number().int().nullable(),
  currencyCode: z.string().nullable(),
})

export type RecurringFrequency = z.infer<typeof recurringFrequencySchema>
export type SaveRecurringTransactionInput = z.infer<typeof saveRecurringTransactionInputSchema>
export type RecurringTransactionRecord = z.infer<typeof recurringTransactionRecordSchema>
export type SaveRecurringEventInput = z.infer<typeof saveRecurringEventInputSchema>
export type RecurringEventRecord = z.infer<typeof recurringEventRecordSchema>
export type MaterializeRecurringInput = z.infer<typeof materializeRecurringInputSchema>
export type MaterializeRecurringResult = z.infer<typeof materializeRecurringResultSchema>
export type ListReminderDeliveriesInput = z.infer<typeof listReminderDeliveriesInputSchema>
export type ReminderDeliveryActionInput = z.infer<typeof reminderDeliveryActionInputSchema>
export type ReminderDeliveryRecord = z.infer<typeof reminderDeliveryRecordSchema>

const itemsKey = "home-ledger.browser-recurring-transactions"
const eventItemsKey = "home-ledger.browser-recurring-events"
const occurrencesKey = "home-ledger.browser-recurring-occurrences"
const remindersKey = "home-ledger.browser-reminder-deliveries"

type StoredBrowserReminder = ReminderDeliveryRecord & { status: "pending" | "delivered" | "dismissed" }
const storedBrowserReminderSchema = reminderDeliveryRecordSchema.extend({
  status: z.enum(["pending", "delivered", "dismissed"]),
})

function readItems(): RecurringTransactionRecord[] {
  try {
    const parsed = z
      .array(recurringTransactionRecordSchema)
      .safeParse(JSON.parse(localStorage.getItem(itemsKey) ?? "[]"))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeItems(items: RecurringTransactionRecord[]) {
  localStorage.setItem(itemsKey, JSON.stringify(items))
}

function readEventItems(): RecurringEventRecord[] {
  try {
    const parsed = z
      .array(recurringEventRecordSchema)
      .safeParse(JSON.parse(localStorage.getItem(eventItemsKey) ?? "[]"))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeEventItems(items: RecurringEventRecord[]) {
  localStorage.setItem(eventItemsKey, JSON.stringify(items))
}

function readOccurrenceKeys(): Set<string> {
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(localStorage.getItem(occurrencesKey) ?? "[]"))
    return new Set(parsed.success ? parsed.data : [])
  } catch {
    return new Set()
  }
}

export function listBrowserRecurringTransactions() {
  return readItems().toSorted(
    (left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name),
  )
}

export function listBrowserRecurringEvents() {
  return readEventItems().toSorted(
    (left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name),
  )
}

export function saveBrowserRecurringTransaction(input: SaveRecurringTransactionInput): RecurringTransactionRecord {
  const validated = saveRecurringTransactionInputSchema.parse(input)
  validateReferences(validated)
  const items = readItems()
  const existing = validated.id ? items.find((item) => item.id === validated.id) : undefined
  if (validated.id && !existing) throw new Error("周期项目不存在")
  const now = new Date().toISOString()
  const record: RecurringTransactionRecord = {
    ...validated,
    id: existing?.id ?? crypto.randomUUID(),
    lastEvaluatedAt: existing?.lastEvaluatedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeItems([record, ...items.filter((item) => item.id !== record.id)])
  return record
}

export function saveBrowserRecurringEvent(input: SaveRecurringEventInput): RecurringEventRecord {
  const validated = saveRecurringEventInputSchema.parse(input)
  validateEventReferences(validated)
  const items = readEventItems()
  const existing = validated.id ? items.find((item) => item.id === validated.id) : undefined
  if (validated.id && !existing) throw new Error("周期事件不存在")
  const references = readBrowserReferenceData()
  const defaultMember = references.householdMembers.find((item) => item.isDefault && item.isActive)
  const now = new Date().toISOString()
  const record: RecurringEventRecord = {
    ...validated,
    id: existing?.id ?? crypto.randomUUID(),
    template: {
      ...validated.template,
      householdMemberId: validated.template.householdMemberId ?? defaultMember?.id ?? null,
    },
    lastEvaluatedAt: existing?.lastEvaluatedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeEventItems([record, ...items.filter((item) => item.id !== record.id)])
  return record
}

export function materializeBrowserRecurringTransactions(input: MaterializeRecurringInput): MaterializeRecurringResult {
  const { asOfDate } = materializeRecurringInputSchema.parse(input)
  const occurrenceKeys = readOccurrenceKeys()
  const reminders = readBrowserReminders()
  let createdCount = 0
  let alreadyMaterializedCount = 0
  const evaluatedAt = new Date().toISOString()
  const items = readItems().map((item) => {
    if (!item.isActive) return item
    const through = format(addDays(parseISO(asOfDate), item.materializeDaysAhead), "yyyy-MM-dd")
    for (const date of occurrenceDates(item, through)) {
      const key = `${item.id}:${date}`
      if (occurrenceKeys.has(key)) {
        alreadyMaterializedCount += 1
        continue
      }
      const transaction = createBrowserTransaction({
        transactionDate: date,
        status: "planned",
        ...item.template,
      })
      occurrenceKeys.add(key)
      const dueAt = fromZonedTime(`${date}T09:00:00`, item.timezoneId)
      reminders.push({
        id: crypto.randomUUID(),
        recurringItemId: item.id,
        recurringItemName: item.name,
        occurrenceKey: date,
        scheduledForUtc: new Date(dueAt.getTime() - item.advanceNoticeDays * 24 * 60 * 60 * 1000).toISOString(),
        transactionId: transaction.id,
        transactionStatus: transaction.status,
        amountMinor: transaction.amountMinor,
        currencyCode: transaction.currencyCode,
        status: "pending",
      })
      createdCount += 1
    }
    return { ...item, lastEvaluatedAt: evaluatedAt }
  })
  const eventItems = readEventItems().map((item) => {
    if (!item.isActive) return item
    const through = format(addDays(parseISO(asOfDate), item.materializeDaysAhead), "yyyy-MM-dd")
    for (const date of occurrenceDates(item, through)) {
      const key = `${item.id}:${date}`
      if (occurrenceKeys.has(key)) {
        alreadyMaterializedCount += 1
        continue
      }
      createBrowserCalendarEvent({
        title: item.template.title,
        description: item.template.description,
        eventType: item.template.eventType,
        isAllDay: true,
        startDate: date,
        endDateExclusive: format(addDays(parseISO(date), item.template.durationDays), "yyyy-MM-dd"),
        startAtUtc: null,
        endAtUtc: null,
        timezoneId: item.timezoneId,
        priority: item.template.priority,
        color: item.template.color,
        icon: item.template.icon,
        locationId: item.template.locationId,
        householdMemberId: item.template.householdMemberId,
        isCompleted: false,
      })
      occurrenceKeys.add(key)
      const dueAt = fromZonedTime(`${date}T09:00:00`, item.timezoneId)
      reminders.push({
        id: crypto.randomUUID(),
        recurringItemId: item.id,
        recurringItemName: item.name,
        occurrenceKey: date,
        scheduledForUtc: new Date(dueAt.getTime() - item.advanceNoticeDays * 24 * 60 * 60 * 1000).toISOString(),
        transactionId: null,
        transactionStatus: null,
        amountMinor: null,
        currencyCode: null,
        status: "pending",
      })
      createdCount += 1
    }
    return { ...item, lastEvaluatedAt: evaluatedAt }
  })
  localStorage.setItem(occurrencesKey, JSON.stringify([...occurrenceKeys]))
  writeBrowserReminders(reminders)
  writeItems(items)
  writeEventItems(eventItems)
  return { createdCount, alreadyMaterializedCount }
}

export function listBrowserReminderDeliveries(input: ListReminderDeliveriesInput): ReminderDeliveryRecord[] {
  const validated = listReminderDeliveriesInputSchema.parse(input)
  return readBrowserReminders()
    .filter(
      (item) =>
        item.status === "pending" &&
        item.scheduledForUtc >= validated.rangeStartUtc &&
        item.scheduledForUtc < validated.rangeEndUtc,
    )
    .toSorted((left, right) => left.scheduledForUtc.localeCompare(right.scheduledForUtc))
    .map((item) => reminderDeliveryRecordSchema.parse(item))
}

export function setBrowserReminderStatus(input: ReminderDeliveryActionInput, status: "delivered" | "dismissed") {
  const validated = reminderDeliveryActionInputSchema.parse(input)
  const reminders = readBrowserReminders()
  const existing = reminders.find((item) => item.id === validated.id && item.status === "pending")
  if (!existing) throw new Error("提醒已处理或不存在")
  writeBrowserReminders(reminders.map((item) => (item.id === validated.id ? { ...item, status } : item)))
}

function readBrowserReminders(): StoredBrowserReminder[] {
  try {
    const parsed = z
      .array(storedBrowserReminderSchema)
      .safeParse(JSON.parse(localStorage.getItem(remindersKey) ?? "[]"))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function getBrowserRecurringTransactionIds() {
  return new Set(
    readBrowserReminders()
      .map((reminder) => reminder.transactionId)
      .filter((id): id is string => id !== null),
  )
}

function writeBrowserReminders(reminders: StoredBrowserReminder[]) {
  localStorage.setItem(remindersKey, JSON.stringify(reminders))
}

function occurrenceDates(item: RecurringTransactionRecord | RecurringEventRecord, through: string) {
  if (item.frequency === "custom") return customOccurrenceDates(item, through)
  const dates: string[] = []
  const end = item.endDate && item.endDate < through ? item.endDate : through
  const maxCount = item.occurrenceCount ?? 10_000
  for (let step = 0; dates.length < maxCount && step < 120_000; step += 1) {
    const date = occurrenceAt(item.startDate, item.frequency, item.interval, step)
    if (!date) continue
    if (date > end) break
    dates.push(date)
  }
  return dates
}

function occurrenceAt(start: string, frequency: RecurringFrequency, interval: number, step: number) {
  const date = parseISO(start)
  if (frequency === "daily") return format(addDays(date, interval * step), "yyyy-MM-dd")
  if (frequency === "weekly") return format(addWeeks(date, interval * step), "yyyy-MM-dd")
  if (frequency === "custom") return null
  const monthMultiplier = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12
  const targetMonth = date.getMonth() + monthMultiplier * interval * step
  const target = new Date(date.getFullYear(), targetMonth, date.getDate())
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  if (target.getMonth() !== normalizedMonth || target.getDate() !== date.getDate()) return null
  return format(target, "yyyy-MM-dd")
}

type ParsedCustomRrule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly"
  interval: number
  byDay: number[]
  byMonthDay: number[]
  byMonth: number[]
  count: number | null
  until: string | null
}

function parseCustomRrule(value: string): ParsedCustomRrule {
  const source = value.trim().replace(/^RRULE:/i, "")
  if (!source) throw new Error("请输入自定义 RRULE")
  const rule: ParsedCustomRrule = {
    frequency: "daily",
    interval: 1,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    count: null,
    until: null,
  }
  let hasFrequency = false
  for (const part of source.split(";")) {
    const [rawKey, rawValue, ...extra] = part.split("=")
    if (!rawKey || !rawValue || extra.length) throw new Error("RRULE 每一项必须使用 KEY=VALUE")
    const key = rawKey.trim().toUpperCase()
    const item = rawValue.trim().toUpperCase()
    if (key === "FREQ") {
      const frequencies = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]
      if (!frequencies.includes(item)) throw new Error("不支持该 FREQ")
      rule.frequency = item.toLowerCase() as ParsedCustomRrule["frequency"]
      hasFrequency = true
    } else if (key === "INTERVAL") rule.interval = parseRuleNumber(item, 1, 365, "INTERVAL")
    else if (key === "BYDAY") {
      const weekdays: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
      rule.byDay = item.split(",").map((weekday) => {
        const number = weekdays[weekday]
        if (number === undefined) throw new Error("BYDAY 只支持 MO 到 SU")
        return number
      })
    } else if (key === "BYMONTHDAY") rule.byMonthDay = parseRuleList(item, 1, 31, "BYMONTHDAY")
    else if (key === "BYMONTH") rule.byMonth = parseRuleList(item, 1, 12, "BYMONTH")
    else if (key === "COUNT") rule.count = parseRuleNumber(item, 1, 10_000, "COUNT")
    else if (key === "UNTIL") {
      const normalized = item.replace(/T000000Z$/, "")
      if (!/^\d{8}$/.test(normalized)) throw new Error("UNTIL 必须为 YYYYMMDD")
      const until = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
      if (!z.string().date().safeParse(until).success) throw new Error("UNTIL 日期无效")
      rule.until = until
    } else throw new Error("RRULE 包含不支持的字段")
  }
  if (!hasFrequency) throw new Error("RRULE 缺少 FREQ")
  return rule
}

function customOccurrenceDates(item: RecurringTransactionRecord | RecurringEventRecord, through: string) {
  const rule = parseCustomRrule(item.customRrule ?? "")
  const end = [through, item.endDate, rule.until].filter((value): value is string => Boolean(value)).toSorted()[0]
  const maxCount = Math.min(item.occurrenceCount ?? 10_000, rule.count ?? 10_000)
  const start = parseISO(item.startDate)
  const dates: string[] = []
  for (
    let cursor = start;
    format(cursor, "yyyy-MM-dd") <= end && dates.length < maxCount;
    cursor = addDays(cursor, 1)
  ) {
    const days = Math.floor((cursor.getTime() - start.getTime()) / 86_400_000)
    const months = (cursor.getFullYear() - start.getFullYear()) * 12 + cursor.getMonth() - start.getMonth()
    const baseMatches =
      rule.frequency === "daily"
        ? days % rule.interval === 0
        : rule.frequency === "weekly"
          ? Math.floor(days / 7) % rule.interval === 0
          : rule.frequency === "monthly"
            ? months % rule.interval === 0
            : (cursor.getFullYear() - start.getFullYear()) % rule.interval === 0
    const defaultMatches =
      rule.frequency === "daily" ||
      (rule.frequency === "weekly" && (rule.byDay.length > 0 || cursor.getDay() === start.getDay())) ||
      (rule.frequency === "monthly" && (rule.byMonthDay.length > 0 || cursor.getDate() === start.getDate())) ||
      (rule.frequency === "yearly" &&
        (rule.byMonth.length > 0 || cursor.getMonth() === start.getMonth()) &&
        (rule.byMonthDay.length > 0 || cursor.getDate() === start.getDate()))
    if (
      baseMatches &&
      defaultMatches &&
      (!rule.byDay.length || rule.byDay.includes(cursor.getDay())) &&
      (!rule.byMonthDay.length || rule.byMonthDay.includes(cursor.getDate())) &&
      (!rule.byMonth.length || rule.byMonth.includes(cursor.getMonth() + 1))
    ) {
      dates.push(format(cursor, "yyyy-MM-dd"))
    }
  }
  return dates
}

function parseRuleNumber(value: string, min: number, max: number, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} 数值超出范围`)
  return parsed
}

function parseRuleList(value: string, min: number, max: number, label: string) {
  return value.split(",").map((item) => parseRuleNumber(item, min, max, label))
}

function validateReferences(input: SaveRecurringTransactionInput) {
  const references = readBrowserReferenceData()
  const template = input.template
  if (template.categoryId && !references.categories.some((item) => item.id === template.categoryId && item.isActive)) {
    throw new Error("所选分类不存在或已停用")
  }
  for (const paymentId of [template.paymentMethodId, template.transferToPaymentMethodId]) {
    if (paymentId && !references.paymentMethods.some((item) => item.id === paymentId && item.isActive)) {
      throw new Error("所选支付方式不存在或已停用")
    }
  }
}

function validateEventReferences(input: SaveRecurringEventInput) {
  const references = readBrowserReferenceData()
  const template = input.template
  if (
    template.householdMemberId &&
    !references.householdMembers.some((item) => item.id === template.householdMemberId && item.isActive)
  ) {
    throw new Error("所选家庭成员不存在或已停用")
  }
  if (template.locationId && !references.locations.some((item) => item.id === template.locationId && item.isActive)) {
    throw new Error("所选地点不存在或已停用")
  }
}
