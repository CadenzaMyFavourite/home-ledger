import { z } from "zod"

import { readBrowserTransactions, writeBrowserTransactions } from "@/lib/transaction-data"

export const taxYearInputSchema = z.object({
  year: z.number().int().min(1900).max(2200),
  reportingCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
})
export const taxProfileRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  countryCode: z.string(),
  regionCode: z.string().nullable(),
  disclaimer: z.string(),
})
export const taxTagRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
})
const taxCandidateTagSchema = z.object({ id: z.string(), name: z.string(), source: z.string() })
const taxCandidateRecordSchema = z.object({
  transactionId: z.string(),
  version: z.number().int().positive(),
  transactionDate: z.string().date(),
  amountMinor: z.number().int().nonnegative(),
  currencyCode: z.string(),
  reportingAmountMinor: z.number().int().nonnegative(),
  reportingCurrencyCode: z.string(),
  categoryName: z.string().nullable(),
  paymentMethodName: z.string().nullable(),
  householdMemberName: z.string().nullable(),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  taxTags: z.array(taxCandidateTagSchema),
  reviewFlags: z.array(z.string()),
  attachmentNames: z.array(z.string()),
  hasAttachment: z.boolean(),
  needsReview: z.boolean(),
})
const taxTagTotalSchema = z.object({
  taxTagId: z.string(),
  name: z.string(),
  amountMinor: z.number().int(),
  transactionCount: z.number().int().nonnegative(),
})
export const taxOrganizerSchema = z.object({
  year: z.number().int(),
  reportingCurrencyCode: z.string(),
  profile: taxProfileRecordSchema,
  incomeMinor: z.number().int(),
  candidateExpenseMinor: z.number().int(),
  candidateCount: z.number().int().nonnegative(),
  confirmedTaggedCount: z.number().int().nonnegative(),
  missingReceiptCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  excludedCurrencyCount: z.number().int().nonnegative(),
  tags: z.array(taxTagRecordSchema),
  tagTotals: z.array(taxTagTotalSchema),
  candidates: z.array(taxCandidateRecordSchema),
})
export const setTransactionTaxTagInputSchema = z.object({
  transactionId: z.string().min(1),
  transactionVersion: z.number().int().positive(),
  taxTagId: z.string().min(1),
  selected: z.boolean(),
})
export const taxTagMutationResultSchema = z.object({
  transactionId: z.string(),
  transactionVersion: z.number().int().positive(),
  taxTagId: z.string(),
  selected: z.boolean(),
})
export const saveTaxTagInputSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullable(),
  isActive: z.boolean(),
})
export const exportTaxPackageInputSchema = taxYearInputSchema.extend({
  exportFormat: z.enum(["csv", "xlsx"]),
  destinationPath: z.string().min(1),
})
export const exportTaxPackageResultSchema = z.object({
  destinationPath: z.string(),
  exportFormat: z.enum(["csv", "xlsx"]),
  candidateCount: z.number().int().nonnegative(),
  incomeCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
})

export type TaxYearInput = z.infer<typeof taxYearInputSchema>
export type TaxOrganizer = z.infer<typeof taxOrganizerSchema>
export type SetTransactionTaxTagInput = z.infer<typeof setTransactionTaxTagInputSchema>
export type TaxTagMutationResult = z.infer<typeof taxTagMutationResultSchema>
export type SaveTaxTagInput = z.infer<typeof saveTaxTagInputSchema>
export type TaxTagRecord = z.infer<typeof taxTagRecordSchema>
export type ExportTaxPackageInput = z.infer<typeof exportTaxPackageInputSchema>
export type ExportTaxPackageResult = z.infer<typeof exportTaxPackageResultSchema>

const acceptedTagsKey = "home-ledger:accepted-tax-tags:v1"
const customTagsKey = "home-ledger:custom-tax-tags:v1"
const acceptedTagSchema = z.object({
  transactionId: z.string(),
  taxTagId: z.string(),
  source: z.enum(["user", "accepted_ai", "import"]),
  confirmedAt: z.string(),
})
export type BrowserAcceptedTaxTag = z.infer<typeof acceptedTagSchema>
const excludedCandidateTagIds = new Set([
  "00000000-0000-7000-8000-000000000201",
  "00000000-0000-7000-8000-000000000202",
])

const systemTags: TaxTagRecord[] = [
  ["201", "不涉及税务"],
  ["202", "个人支出"],
  ["203", "商业支出"],
  ["204", "自雇支出"],
  ["205", "出租房相关"],
  ["206", "教育相关"],
  ["207", "医疗相关"],
  ["208", "慈善捐赠"],
  ["209", "投资相关"],
  ["210", "车辆相关"],
  ["211", "家庭办公相关"],
  ["212", "需要检查"],
].map(([suffix, name], index) => ({
  id: `00000000-0000-7000-8000-000000000${suffix}`,
  name,
  description: suffix === "212" ? "候选项目，必须由用户或税务专业人士确认。" : null,
  isSystem: true,
  isActive: true,
  sortOrder: (index + 1) * 10,
}))

export function getBrowserTaxOrganizer(input: TaxYearInput): TaxOrganizer {
  const validated = taxYearInputSchema.parse(input)
  const tags = [...systemTags, ...readCustomTags()]
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  const accepted = readAcceptedTags()
  const records = readBrowserTransactions().filter(
    (record) =>
      record.status === "completed" &&
      record.transactionDate >= `${validated.year}-01-01` &&
      record.transactionDate < `${validated.year + 1}-01-01`,
  )
  const included = records.filter((record) => record.currencyCode === validated.reportingCurrencyCode)
  const candidates = included
    .filter(
      (record) =>
        record.transactionType === "expense" &&
        (record.hasPossibleTaxHint ||
          accepted.some((tag) => tag.transactionId === record.id && !excludedCandidateTagIds.has(tag.taxTagId))),
    )
    .map((record) => {
      const taxTags = accepted
        .filter((tag) => tag.transactionId === record.id)
        .map((tag) => ({ id: tag.taxTagId, name: tagById.get(tag.taxTagId)?.name ?? tag.taxTagId, source: tag.source }))
      const reviewFlags = record.hasPossibleTaxHint ? ["possible_tax_candidate"] : []
      return {
        transactionId: record.id,
        version: record.version,
        transactionDate: record.transactionDate,
        amountMinor: record.amountMinor,
        currencyCode: record.currencyCode,
        reportingAmountMinor: record.amountMinor,
        reportingCurrencyCode: record.currencyCode,
        categoryName: record.categoryName,
        paymentMethodName: record.paymentMethodName,
        householdMemberName: record.householdMemberName,
        merchant: record.merchant,
        note: record.note,
        taxTags,
        reviewFlags,
        attachmentNames: [],
        hasAttachment: false,
        needsReview: taxTags.length === 0 || reviewFlags.length > 0 || taxTags.some((tag) => tag.id.endsWith("212")),
      }
    })
    .toSorted((left, right) => right.transactionDate.localeCompare(left.transactionDate))
  const totals = new Map<string, z.infer<typeof taxTagTotalSchema>>()
  for (const candidate of candidates) {
    for (const tag of candidate.taxTags) {
      const total = totals.get(tag.id) ?? {
        taxTagId: tag.id,
        name: tag.name,
        amountMinor: 0,
        transactionCount: 0,
      }
      total.amountMinor += candidate.reportingAmountMinor
      total.transactionCount += 1
      totals.set(tag.id, total)
    }
  }
  return taxOrganizerSchema.parse({
    year: validated.year,
    reportingCurrencyCode: validated.reportingCurrencyCode,
    profile: {
      id: "browser-ca-on",
      name: "Canada / Ontario",
      countryCode: "CA",
      regionCode: "ON",
      disclaimer:
        "系统只能帮助整理记录、分类和生成候选清单，不能保证某项支出可以抵税。最终税务处理应由用户或专业人士确认。",
    },
    incomeMinor: included
      .filter((record) => record.transactionType === "income")
      .reduce((sum, record) => sum + record.amountMinor, 0),
    candidateExpenseMinor: candidates.reduce((sum, record) => sum + record.reportingAmountMinor, 0),
    candidateCount: candidates.length,
    confirmedTaggedCount: candidates.filter((record) => record.taxTags.length > 0).length,
    missingReceiptCount: candidates.filter((record) => !record.hasAttachment).length,
    needsReviewCount: candidates.filter((record) => record.needsReview).length,
    excludedCurrencyCount: records.filter(
      (record) =>
        record.currencyCode !== validated.reportingCurrencyCode &&
        record.transactionType === "expense" &&
        (record.hasPossibleTaxHint ||
          accepted.some((tag) => tag.transactionId === record.id && !excludedCandidateTagIds.has(tag.taxTagId))),
    ).length,
    tags,
    tagTotals: [...totals.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
    candidates,
  })
}

export function setBrowserTransactionTaxTag(input: SetTransactionTaxTagInput): TaxTagMutationResult {
  const validated = setTransactionTaxTagInputSchema.parse(input)
  const records = readBrowserTransactions()
  const index = records.findIndex((record) => record.id === validated.transactionId)
  const record = records[index]
  if (!record || record.version !== validated.transactionVersion) throw new Error("交易已修改，请刷新后重试")
  if (record.transactionType === "transfer") throw new Error("转账不能设置税务候选标签")
  const tag = [...systemTags, ...readCustomTags()].find((item) => item.id === validated.taxTagId && item.isActive)
  if (!tag) throw new Error("税务标签不存在或已停用")
  const accepted = readAcceptedTags().filter(
    (item) => !(item.transactionId === record.id && item.taxTagId === validated.taxTagId),
  )
  if (validated.selected) {
    accepted.push({
      transactionId: record.id,
      taxTagId: validated.taxTagId,
      source: "user",
      confirmedAt: new Date().toISOString(),
    })
  }
  localStorage.setItem(acceptedTagsKey, JSON.stringify(accepted))
  const transactionVersion = record.version + 1
  records[index] = {
    ...record,
    version: transactionVersion,
    updatedAt: new Date().toISOString(),
    hasPossibleTaxHint: validated.selected && !validated.taxTagId.endsWith("212") ? false : record.hasPossibleTaxHint,
  }
  writeBrowserTransactions(records)
  return taxTagMutationResultSchema.parse({ ...validated, transactionVersion })
}

export function isBrowserTaxTagActive(taxTagId: string) {
  return [...systemTags, ...readCustomTags()].some((tag) => tag.id === taxTagId && tag.isActive)
}

export function getBrowserAcceptedTaxTag(transactionId: string, taxTagId: string): BrowserAcceptedTaxTag | null {
  return readAcceptedTags().find((tag) => tag.transactionId === transactionId && tag.taxTagId === taxTagId) ?? null
}

export function writeBrowserAcceptedTaxTag(
  transactionId: string,
  taxTagId: string,
  value: BrowserAcceptedTaxTag | null,
) {
  const tags = readAcceptedTags().filter((tag) => !(tag.transactionId === transactionId && tag.taxTagId === taxTagId))
  if (value) tags.push(acceptedTagSchema.parse(value))
  localStorage.setItem(acceptedTagsKey, JSON.stringify(tags))
}

export function saveBrowserTaxTag(input: SaveTaxTagInput): TaxTagRecord {
  const validated = saveTaxTagInputSchema.parse(input)
  if (validated.id && systemTags.some((tag) => tag.id === validated.id)) throw new Error("系统税务标签不可修改")
  const tags = readCustomTags()
  const existing = tags.find((tag) => tag.id === validated.id)
  if (validated.id && !existing) throw new Error("自定义税务标签不存在")
  if (
    tags.some((tag) => tag.id !== validated.id && tag.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase())
  ) {
    throw new Error("同名税务标签已经存在")
  }
  const saved = taxTagRecordSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    name: validated.name,
    description: validated.description,
    isSystem: false,
    isActive: validated.isActive,
    sortOrder:
      existing?.sortOrder ??
      Math.max(...systemTags.map((tag) => tag.sortOrder), ...tags.map((tag) => tag.sortOrder), 0) + 10,
  })
  const updated = tags.filter((tag) => tag.id !== saved.id)
  updated.push(saved)
  localStorage.setItem(customTagsKey, JSON.stringify(updated))
  return saved
}

export function exportBrowserTaxPackage(input: ExportTaxPackageInput): ExportTaxPackageResult {
  const validated = exportTaxPackageInputSchema.parse(input)
  if (validated.exportFormat !== "csv") throw new Error("Excel 导出仅在 Tauri 桌面应用中可用")
  const organizer = getBrowserTaxOrganizer(validated)
  const records = readBrowserTransactions().filter(
    (record) =>
      record.status === "completed" &&
      record.transactionType === "income" &&
      record.currencyCode === validated.reportingCurrencyCode &&
      record.transactionDate >= `${validated.year}-01-01` &&
      record.transactionDate < `${validated.year + 1}-01-01`,
  )
  const header =
    "record_type,transaction_id,transaction_date,amount_minor,currency_code,reporting_amount_minor,reporting_currency_code,category,payment_method,household_member,merchant,note,tax_tags,tax_tag_sources,review_flags,missing_receipt,attachment_names"
  const lines = [
    ...records.map((record) =>
      [
        "income",
        record.id,
        record.transactionDate,
        String(record.amountMinor),
        record.currencyCode,
        String(record.amountMinor),
        record.currencyCode,
        record.categoryName ?? "",
        record.paymentMethodName ?? "",
        record.householdMemberName ?? "",
        record.merchant ?? "",
        record.note ?? "",
        "",
        "",
        "",
        "false",
        "",
      ]
        .map(csvCell)
        .join(","),
    ),
    ...organizer.candidates.map((record) =>
      [
        "tax_candidate_expense",
        record.transactionId,
        record.transactionDate,
        String(record.amountMinor),
        record.currencyCode,
        String(record.reportingAmountMinor),
        record.reportingCurrencyCode,
        record.categoryName ?? "",
        record.paymentMethodName ?? "",
        record.householdMemberName ?? "",
        record.merchant ?? "",
        record.note ?? "",
        record.taxTags.map((tag) => tag.name).join("; "),
        record.taxTags.map((tag) => tag.source).join("; "),
        record.reviewFlags.join("; "),
        String(!record.hasAttachment),
        record.attachmentNames.join("; "),
      ]
        .map(csvCell)
        .join(","),
    ),
  ]
  const bytes = new TextEncoder().encode(`\ufeff${header}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`)
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = validated.destinationPath
  anchor.click()
  URL.revokeObjectURL(url)
  return {
    destinationPath: validated.destinationPath,
    exportFormat: "csv",
    candidateCount: organizer.candidateCount,
    incomeCount: records.length,
    byteCount: bytes.byteLength,
  }
}

function readAcceptedTags() {
  try {
    return z.array(acceptedTagSchema).parse(JSON.parse(localStorage.getItem(acceptedTagsKey) ?? "[]"))
  } catch {
    return []
  }
}

function readCustomTags() {
  try {
    return z.array(taxTagRecordSchema).parse(JSON.parse(localStorage.getItem(customTagsKey) ?? "[]"))
  } catch {
    return []
  }
}

function csvCell(value: string) {
  const sanitized = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${sanitized.replaceAll('"', '""')}"`
}
