import { z } from "zod"

import { readBrowserReferenceData, readBrowserTransactions } from "@/lib/transaction-data"
import { getBrowserRecurringTransactionIds } from "@/lib/recurring-data"

export const financialSummaryInputSchema = z
  .object({
    periodStartDate: z.string().date(),
    periodEndDateExclusive: z.string().date(),
    reportingCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine((value) => value.periodStartDate < value.periodEndDateExclusive, {
    path: ["periodEndDateExclusive"],
    message: "统计结束日期必须晚于开始日期",
  })

const dailyFinancialPointSchema = z.object({
  summaryDate: z.string().date(),
  incomeMinor: z.number().int(),
  expenseMinor: z.number().int(),
})
const namedFinancialTotalSchema = z.object({
  id: z.string(),
  name: z.string(),
  amountMinor: z.number().int().nonnegative(),
})
const largestExpenseSchema = z.object({
  transactionId: z.string(),
  transactionDate: z.string().date(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int().nonnegative(),
  categoryName: z.string().nullable(),
})
export const financialReviewFlagSchema = z.enum([
  "possible_duplicate",
  "unusually_high",
  "missing_attachment",
  "uncategorized",
  "missing_fx",
  "possible_tax_candidate",
  "tax_review",
  "subscription_change",
])
export const reviewCandidateActionInputSchema = z.object({
  transactionId: z.string().min(1),
  flagType: financialReviewFlagSchema,
  status: z.enum(["confirmed", "dismissed"]),
})
export const reportNoteQueryInputSchema = z
  .object({
    reportType: z.enum(["monthly", "annual", "tax"]),
    periodStartDate: z.string().date(),
    periodEndDateExclusive: z.string().date(),
  })
  .refine((value) => value.periodStartDate < value.periodEndDateExclusive, {
    path: ["periodEndDateExclusive"],
    message: "报告结束日期必须晚于开始日期",
  })
export const saveReportNoteInputSchema = reportNoteQueryInputSchema.safeExtend({
  note: z.string().max(10_000),
  expectedVersion: z.number().int().positive().nullable(),
})
export const reportNoteRecordSchema = reportNoteQueryInputSchema.safeExtend({
  id: z.string(),
  note: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const exportFinancialReportInputSchema = financialSummaryInputSchema.safeExtend({
  reportType: z.enum(["monthly", "annual"]),
  exportFormat: z.enum(["csv", "xlsx"]),
  destinationPath: z.string().min(1),
})
export const exportFinancialReportResultSchema = z.object({
  destinationPath: z.string(),
  exportFormat: z.enum(["csv", "xlsx"]),
  recordCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
})
const financialReviewCandidateSchema = z.object({
  transactionId: z.string(),
  transactionDate: z.string().date(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int().nonnegative(),
  flagType: financialReviewFlagSchema,
  severity: z.enum(["info", "warning", "high"]),
  relatedTransactionId: z.string().nullable(),
})
export const financialSummarySchema = z.object({
  periodStartDate: z.string().date(),
  periodEndDateExclusive: z.string().date(),
  reportingCurrencyCode: z.string(),
  incomeMinor: z.number().int().nonnegative(),
  expenseMinor: z.number().int().nonnegative(),
  fixedExpenseMinor: z.number().int().nonnegative(),
  variableExpenseMinor: z.number().int().nonnegative(),
  netMinor: z.number().int(),
  actualTransactionCount: z.number().int().nonnegative(),
  excludedCurrencyCount: z.number().int().nonnegative(),
  dailyTrend: z.array(dailyFinancialPointSchema),
  categoryTotals: z.array(namedFinancialTotalSchema),
  paymentMethodTotals: z.array(namedFinancialTotalSchema),
  householdMemberTotals: z.array(namedFinancialTotalSchema),
  largestExpense: largestExpenseSchema.nullable(),
  reviewCandidates: z.array(financialReviewCandidateSchema),
})

export type FinancialSummaryInput = z.infer<typeof financialSummaryInputSchema>
export type FinancialSummary = z.infer<typeof financialSummarySchema>
export type ReviewCandidateActionInput = z.infer<typeof reviewCandidateActionInputSchema>
export type ReportNoteQueryInput = z.infer<typeof reportNoteQueryInputSchema>
export type SaveReportNoteInput = z.infer<typeof saveReportNoteInputSchema>
export type ReportNoteRecord = z.infer<typeof reportNoteRecordSchema>
export type ExportFinancialReportInput = z.infer<typeof exportFinancialReportInputSchema>
export type ExportFinancialReportResult = z.infer<typeof exportFinancialReportResultSchema>

const browserReviewStatusStorageKey = "home-ledger:financial-review-statuses:v1"
const browserReportNotesStorageKey = "home-ledger:report-notes:v1"

export function getBrowserFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  const validated = financialSummaryInputSchema.parse(input)
  const references = readBrowserReferenceData()
  const records = readBrowserTransactions().filter(
    (record) =>
      record.status === "completed" &&
      record.transactionType !== "transfer" &&
      record.transactionDate >= validated.periodStartDate &&
      record.transactionDate < validated.periodEndDateExclusive,
  )
  const included = records.filter((record) => record.currencyCode === validated.reportingCurrencyCode)
  let incomeMinor = 0
  let expenseMinor = 0
  let fixedExpenseMinor = 0
  let variableExpenseMinor = 0
  const recurringTransactionIds = getBrowserRecurringTransactionIds()
  const daily = new Map<string, { incomeMinor: number; expenseMinor: number }>()
  const categories = new Map<string, { name: string; amountMinor: number }>()
  const payments = new Map<string, { name: string; amountMinor: number }>()
  const members = new Map<string, { name: string; amountMinor: number }>()
  let largestExpense: FinancialSummary["largestExpense"] = null
  for (const record of included) {
    const point = daily.get(record.transactionDate) ?? { incomeMinor: 0, expenseMinor: 0 }
    if (record.transactionType === "income") {
      incomeMinor += record.amountMinor
      point.incomeMinor += record.amountMinor
    } else {
      expenseMinor += record.amountMinor
      if (recurringTransactionIds.has(record.id)) fixedExpenseMinor += record.amountMinor
      else variableExpenseMinor += record.amountMinor
      point.expenseMinor += record.amountMinor
      addCategory(categories, record.categoryId, record.amountMinor, references)
      addNamed(payments, record.paymentMethodId, record.paymentMethodName, "未设置支付方式", record.amountMinor)
      addNamed(members, record.householdMemberId, record.householdMemberName, "未设置成员", record.amountMinor)
      if (!largestExpense || record.amountMinor > largestExpense.amountMinor) {
        largestExpense = {
          transactionId: record.id,
          transactionDate: record.transactionDate,
          merchant: record.merchant,
          amountMinor: record.amountMinor,
          categoryName: record.categoryName,
        }
      }
    }
    daily.set(record.transactionDate, point)
  }
  return financialSummarySchema.parse({
    periodStartDate: validated.periodStartDate,
    periodEndDateExclusive: validated.periodEndDateExclusive,
    reportingCurrencyCode: validated.reportingCurrencyCode,
    incomeMinor,
    expenseMinor,
    fixedExpenseMinor,
    variableExpenseMinor,
    netMinor: incomeMinor - expenseMinor,
    actualTransactionCount: included.length,
    excludedCurrencyCount: records.length - included.length,
    dailyTrend: [...daily.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([summaryDate, point]) => ({ summaryDate, ...point })),
    categoryTotals: totals(categories),
    paymentMethodTotals: totals(payments),
    householdMemberTotals: totals(members),
    largestExpense,
    reviewCandidates: buildBrowserReviewCandidates(included),
  })
}

function buildBrowserReviewCandidates(records: ReturnType<typeof readBrowserTransactions>) {
  const candidates: z.infer<typeof financialReviewCandidateSchema>[] = []
  const duplicateGroups = new Map<string, string[]>()
  for (const record of records) {
    const add = (
      flagType: z.infer<typeof financialReviewFlagSchema>,
      severity: "info" | "warning" | "high" = "warning",
    ) =>
      candidates.push({
        transactionId: record.id,
        transactionDate: record.transactionDate,
        merchant: record.merchant,
        amountMinor: record.amountMinor,
        flagType,
        severity,
        relatedTransactionId: null,
      })
    if (record.transactionType === "expense" && !record.categoryId) add("uncategorized")
    if (record.transactionType === "expense" && record.amountMinor >= 100_000) add("unusually_high")
    if (record.transactionType === "expense" && record.amountMinor >= 50_000) add("missing_attachment")
    if (record.hasPossibleTaxHint) add("possible_tax_candidate", "info")
    const fingerprint = [
      record.transactionDate,
      record.transactionType,
      record.amountMinor,
      record.currencyCode,
      record.paymentMethodId ?? "",
      record.merchant?.trim().toLocaleLowerCase() ?? "",
    ].join("|")
    const group = duplicateGroups.get(fingerprint) ?? []
    group.push(record.id)
    duplicateGroups.set(fingerprint, group)
  }
  for (const ids of duplicateGroups.values()) {
    if (ids.length < 2) continue
    const [original, ...duplicates] = ids.toSorted()
    for (const id of duplicates) {
      const record = records.find((item) => item.id === id)!
      candidates.push({
        transactionId: record.id,
        transactionDate: record.transactionDate,
        merchant: record.merchant,
        amountMinor: record.amountMinor,
        flagType: "possible_duplicate",
        severity: "warning",
        relatedTransactionId: original,
      })
    }
  }
  const severityOrder = { high: 0, warning: 1, info: 2 }
  const reviewed = readBrowserReviewStatuses()
  return candidates
    .filter((candidate) => !reviewed.has(reviewKey(candidate)))
    .toSorted(
      (left, right) =>
        severityOrder[left.severity] - severityOrder[right.severity] ||
        right.transactionDate.localeCompare(left.transactionDate) ||
        right.amountMinor - left.amountMinor ||
        left.transactionId.localeCompare(right.transactionId) ||
        left.flagType.localeCompare(right.flagType),
    )
}

export function setBrowserReviewCandidateStatus(input: ReviewCandidateActionInput) {
  const validated = reviewCandidateActionInputSchema.parse(input)
  if (!readBrowserTransactions().some((transaction) => transaction.id === validated.transactionId)) {
    throw new Error("交易记录不存在")
  }
  const stored = readBrowserReviewStatusRecords().filter(
    (record) => !(record.transactionId === validated.transactionId && record.flagType === validated.flagType),
  )
  stored.push(validated)
  window.localStorage.setItem(browserReviewStatusStorageKey, JSON.stringify(stored))
  return validated
}

function reviewKey(value: { transactionId: string; flagType: string }) {
  return `${value.transactionId}|${value.flagType}`
}

function readBrowserReviewStatuses() {
  return new Set(readBrowserReviewStatusRecords().map(reviewKey))
}

function readBrowserReviewStatusRecords(): ReviewCandidateActionInput[] {
  const stored = window.localStorage.getItem(browserReviewStatusStorageKey)
  if (!stored) return []
  try {
    return z.array(reviewCandidateActionInputSchema).parse(JSON.parse(stored))
  } catch {
    return []
  }
}

export function getBrowserReportNote(input: ReportNoteQueryInput) {
  const validated = reportNoteQueryInputSchema.parse(input)
  return (
    readBrowserReportNotes().find(
      (record) =>
        record.reportType === validated.reportType &&
        record.periodStartDate === validated.periodStartDate &&
        record.periodEndDateExclusive === validated.periodEndDateExclusive,
    ) ?? null
  )
}

export function saveBrowserReportNote(input: SaveReportNoteInput) {
  const validated = saveReportNoteInputSchema.parse(input)
  const records = readBrowserReportNotes()
  const index = records.findIndex(
    (record) =>
      record.reportType === validated.reportType &&
      record.periodStartDate === validated.periodStartDate &&
      record.periodEndDateExclusive === validated.periodEndDateExclusive,
  )
  const existing = records[index]
  if (existing && validated.expectedVersion !== existing.version) {
    throw new Error("报告说明已在其他窗口修改，请重新载入后再保存")
  }
  if (!existing && validated.expectedVersion !== null) {
    throw new Error("报告说明不存在，请重新载入后再保存")
  }
  const now = new Date().toISOString()
  const saved = reportNoteRecordSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    reportType: validated.reportType,
    periodStartDate: validated.periodStartDate,
    periodEndDateExclusive: validated.periodEndDateExclusive,
    note: validated.note,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  if (index >= 0) records[index] = saved
  else records.push(saved)
  window.localStorage.setItem(browserReportNotesStorageKey, JSON.stringify(records))
  return saved
}

function readBrowserReportNotes() {
  const stored = window.localStorage.getItem(browserReportNotesStorageKey)
  if (!stored) return []
  try {
    return z.array(reportNoteRecordSchema).parse(JSON.parse(stored))
  } catch {
    return []
  }
}

export function exportBrowserFinancialReport(input: ExportFinancialReportInput): ExportFinancialReportResult {
  const validated = exportFinancialReportInputSchema.parse(input)
  if (validated.exportFormat !== "csv") throw new Error("Excel 导出仅在 Tauri 桌面应用中可用")
  const records = readBrowserTransactions().filter(
    (record) =>
      record.status === "completed" &&
      record.transactionType !== "transfer" &&
      record.transactionDate >= validated.periodStartDate &&
      record.transactionDate < validated.periodEndDateExclusive &&
      record.currencyCode === validated.reportingCurrencyCode,
  )
  const header = [
    "transaction_date",
    "transaction_type",
    "amount_minor",
    "currency_code",
    "reporting_amount_minor",
    "reporting_currency_code",
    "category",
    "payment_method",
    "household_member",
    "merchant",
    "note",
    "expense_kind",
  ]
  const recurringIds = getBrowserRecurringTransactionIds()
  const lines = records.map((record) =>
    [
      record.transactionDate,
      record.transactionType,
      String(record.amountMinor),
      record.currencyCode,
      String(record.amountMinor),
      record.currencyCode,
      record.categoryName ?? "",
      record.paymentMethodName ?? "",
      record.householdMemberName ?? "",
      record.merchant ?? "",
      record.note ?? "",
      record.transactionType === "expense" ? (recurringIds.has(record.id) ? "fixed" : "variable") : "",
    ]
      .map(csvCell)
      .join(","),
  )
  const text = `\u{feff}${header.join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`
  const bytes = new TextEncoder().encode(text)
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = validated.destinationPath
  anchor.click()
  URL.revokeObjectURL(url)
  return {
    destinationPath: validated.destinationPath,
    exportFormat: validated.exportFormat,
    recordCount: records.length,
    byteCount: bytes.byteLength,
  }
}

function csvCell(value: string) {
  const sanitized = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${sanitized.replaceAll('"', '""')}"`
}

function addCategory(
  result: Map<string, { name: string; amountMinor: number }>,
  categoryId: string | null,
  amountMinor: number,
  references: ReturnType<typeof readBrowserReferenceData>,
) {
  const category = references.categories.find((item) => item.id === categoryId)
  const parent = category?.parentId ? references.categories.find((item) => item.id === category.parentId) : undefined
  addNamed(result, parent?.id ?? category?.id ?? null, parent?.name ?? category?.name ?? null, "未分类", amountMinor)
}

function addNamed(
  result: Map<string, { name: string; amountMinor: number }>,
  id: string | null,
  name: string | null,
  fallback: string,
  amountMinor: number,
) {
  const key = id ?? "unassigned"
  const current = result.get(key) ?? { name: name ?? fallback, amountMinor: 0 }
  current.amountMinor += amountMinor
  result.set(key, current)
}

function totals(result: Map<string, { name: string; amountMinor: number }>) {
  return [...result.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .toSorted((left, right) => right.amountMinor - left.amountMinor || left.name.localeCompare(right.name))
}
