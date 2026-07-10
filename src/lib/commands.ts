import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"

import { batchEditBrowserTransactions, undoBatchEditBrowserTransactions } from "@/lib/batch-edit-browser"

import {
  attachmentAccessInputSchema,
  attachmentOwnerInputSchema,
  attachmentRecordSchema,
  pickAttachmentInputSchema,
  type AttachmentAccessInput,
  type AttachmentOwnerInput,
  type AttachmentRecord,
  type PickAttachmentInput,
} from "@/lib/attachment-data"

import {
  backupIdInputSchema,
  backupRecordSchema,
  backupVerificationResultSchema,
  stageRestoreInputSchema,
  stageRestoreResultSchema,
  type BackupIdInput,
  type BackupRecord,
  type BackupVerificationResult,
  type StageRestoreInput,
  type StageRestoreResult,
} from "@/lib/backup-data"

import {
  analyzeCsvImportInputSchema,
  commitCsvImportInputSchema,
  csvImportAnalysisSchema,
  csvImportBatchInputSchema,
  csvImportCommitResultSchema,
  csvImportPreviewSchema,
  csvImportUndoResultSchema,
  previewCsvImportInputSchema,
  type AnalyzeCsvImportInput,
  type CommitCsvImportInput,
  type CsvImportAnalysis,
  type CsvImportBatchInput,
  type CsvImportCommitResult,
  type CsvImportPreview,
  type CsvImportUndoResult,
  type PreviewCsvImportInput,
} from "@/lib/csv-import-data"

import {
  dailyNoteRecordSchema,
  deleteBrowserDailyNote,
  deleteDailyNoteInputSchema,
  getBrowserDailyNote,
  getDailyNoteInputSchema,
  saveBrowserDailyNote,
  saveDailyNoteInputSchema,
  type DailyNoteRecord,
  type DeleteDailyNoteInput,
  type GetDailyNoteInput,
  type SaveDailyNoteInput,
} from "@/lib/daily-note-data"

import {
  exportBrowserTaxPackage,
  exportTaxPackageInputSchema,
  exportTaxPackageResultSchema,
  getBrowserTaxOrganizer,
  saveBrowserTaxTag,
  saveTaxTagInputSchema,
  setBrowserTransactionTaxTag,
  setTransactionTaxTagInputSchema,
  taxOrganizerSchema,
  taxTagMutationResultSchema,
  taxTagRecordSchema,
  taxYearInputSchema,
  type ExportTaxPackageInput,
  type ExportTaxPackageResult,
  type SaveTaxTagInput,
  type SetTransactionTaxTagInput,
  type TaxOrganizer,
  type TaxTagMutationResult,
  type TaxTagRecord,
  type TaxYearInput,
} from "@/lib/tax-data"

import {
  aiConnectionTestResultSchema,
  aiProfileRecordSchema,
  aiSuggestionQueryInputSchema,
  aiSuggestionRecordSchema,
  aiSummaryQueryInputSchema,
  aiSummaryRecordSchema,
  generateAiSummaryInputSchema,
  generateAiSuggestionsInputSchema,
  generateBrowserAiSuggestions,
  generateBrowserAiSummary,
  listBrowserAiSummaries,
  listBrowserAiProfiles,
  listBrowserAiSuggestions,
  saveAiProfileInputSchema,
  saveBrowserAiProfile,
  testBrowserAiConnection,
  reviewAiSuggestionInputSchema,
  reviewBrowserAiSuggestion,
  updateAiSummaryInputSchema,
  updateBrowserAiSummary,
  type AiConnectionTestResult,
  type AiProfileRecord,
  type AiSuggestionQueryInput,
  type AiSuggestionRecord,
  type AiSummaryQueryInput,
  type AiSummaryRecord,
  type GenerateAiSummaryInput,
  type GenerateAiSuggestionsInput,
  type ReviewAiSuggestionInput,
  type SaveAiProfileInput,
  type UpdateAiSummaryInput,
} from "@/lib/local-ai-data"

import {
  financialSummaryInputSchema,
  financialSummarySchema,
  exportBrowserFinancialReport,
  exportFinancialReportInputSchema,
  exportFinancialReportResultSchema,
  getBrowserFinancialSummary,
  getBrowserReportNote,
  reportNoteQueryInputSchema,
  reportNoteRecordSchema,
  reviewCandidateActionInputSchema,
  saveBrowserReportNote,
  saveReportNoteInputSchema,
  setBrowserReviewCandidateStatus,
  type FinancialSummary,
  type FinancialSummaryInput,
  type ExportFinancialReportInput,
  type ExportFinancialReportResult,
  type ReportNoteQueryInput,
  type ReportNoteRecord,
  type ReviewCandidateActionInput,
  type SaveReportNoteInput,
} from "@/lib/financial-summary-data"

import {
  calendarEventRecordSchema,
  calendarEventIdInputSchema,
  calendarEventVersionInputSchema,
  createBrowserCalendarEvent,
  createCalendarEventInputSchema,
  dailyFinancialSummaryInputSchema,
  dailyFinancialSummarySchema,
  deleteBrowserCalendarEvent,
  getBrowserCalendarEvent,
  eventTransactionLinkInputSchema,
  listBrowserCalendarEvents,
  listBrowserDailyFinancialSummaries,
  listCalendarEventsInputSchema,
  restoreBrowserCalendarEvent,
  setBrowserEventTransactionLink,
  updateBrowserCalendarEvent,
  updateCalendarEventInputSchema,
  type CalendarEventRecord,
  type CalendarEventIdInput,
  type CalendarEventVersionInput,
  type CreateCalendarEventInput,
  type DailyFinancialSummary,
  type DailyFinancialSummaryInput,
  type ListCalendarEventsInput,
  type EventTransactionLinkInput,
  type UpdateCalendarEventInput,
} from "@/lib/calendar-data"
import { calendarColorOverridesSchema, defaultCalendarColorOverrides } from "@/lib/calendar-colors"

import {
  listBrowserRecurringTransactions,
  listBrowserRecurringEvents,
  listBrowserReminderDeliveries,
  listReminderDeliveriesInputSchema,
  materializeBrowserRecurringTransactions,
  materializeRecurringInputSchema,
  materializeRecurringResultSchema,
  recurringTransactionRecordSchema,
  recurringEventRecordSchema,
  reminderDeliveryActionInputSchema,
  reminderDeliveryRecordSchema,
  saveBrowserRecurringTransaction,
  saveBrowserRecurringEvent,
  saveRecurringEventInputSchema,
  saveRecurringTransactionInputSchema,
  setBrowserReminderStatus,
  type ListReminderDeliveriesInput,
  type MaterializeRecurringInput,
  type MaterializeRecurringResult,
  type RecurringTransactionRecord,
  type RecurringEventRecord,
  type ReminderDeliveryActionInput,
  type ReminderDeliveryRecord,
  type SaveRecurringTransactionInput,
  type SaveRecurringEventInput,
} from "@/lib/recurring-data"

import {
  batchCategoryUpdateInputSchema,
  batchEditTransactionsInputSchema,
  batchEditTransactionsResultSchema,
  batchDeleteBrowserTransactions,
  batchRestoreBrowserTransactions,
  batchTransactionItemsInputSchema,
  batchTransactionMutationResultSchema,
  batchUpdateBrowserTransactionCategory,
  createBrowserTransaction,
  createTransactionInputSchema,
  deleteBrowserTransaction,
  deleteBrowserTransactionFilter,
  listBrowserTransactions,
  listBrowserTransactionTemplates,
  listBrowserTransactionFilters,
  listTransactionsInputSchema,
  householdMemberSchema,
  locationSchema,
  readBrowserReferenceData,
  removeBrowserTransactionsByIds,
  saveBrowserCategory,
  saveBrowserHouseholdMember,
  saveBrowserLocation,
  saveBrowserPaymentMethod,
  saveBrowserTransactionTemplate,
  saveBrowserTransactionFilter,
  suggestBrowserTransaction,
  saveCategoryInputSchema,
  saveHouseholdMemberInputSchema,
  saveLocationInputSchema,
  savePaymentMethodInputSchema,
  saveTransactionTemplateInputSchema,
  saveTransactionFilterInputSchema,
  transactionPageSchema,
  transactionRecordSchema,
  transactionReferenceDataSchema,
  transactionMutationResultSchema,
  transactionVersionInputSchema,
  undoBatchEditInputSchema,
  transactionTemplateIdInputSchema,
  transactionTemplateRecordSchema,
  transactionSavedFilterRecordSchema,
  transactionSuggestionInputSchema,
  transactionSuggestionSchema,
  restoreBrowserTransaction,
  updateBrowserTransaction,
  updateTransactionInputSchema,
  applyBrowserTransactionTemplate,
  type CreateTransactionInput,
  type BatchCategoryUpdateInput,
  type BatchEditTransactionsInput,
  type BatchEditTransactionsResult,
  type BatchTransactionItemsInput,
  type BatchTransactionMutationResult,
  type ListTransactionsInput,
  type SaveCategoryInput,
  type SaveHouseholdMemberInput,
  type SaveLocationInput,
  type SavePaymentMethodInput,
  type SaveTransactionTemplateInput,
  type SaveTransactionFilterInput,
  type TransactionPage,
  type TransactionRecord,
  type TransactionReferenceData,
  type TransactionTemplateRecord,
  type TransactionSavedFilterRecord,
  type TransactionSuggestion,
  type TransactionSuggestionInput,
  type TransactionMutationResult,
  type TransactionVersionInput,
  type UpdateTransactionInput,
  type UndoBatchEditInput,
} from "@/lib/transaction-data"

import {
  naturalLanguageQueryInputSchema,
  validatedSafeQuerySchema,
  type NaturalLanguageQueryInput,
  type ValidatedSafeQuery,
} from "@/lib/safe-query-data"

import {
  globalSearchInputSchema,
  globalSearchPageSchema,
  searchBrowserData,
  type GlobalSearchInput,
  type GlobalSearchPage,
} from "@/lib/global-search-data"

export type {
  CalendarEventRecord,
  CalendarEventIdInput,
  CalendarEventType,
  CalendarEventVersionInput,
  CreateCalendarEventInput,
  DailyFinancialSummary,
  DailyFinancialSummaryInput,
  EventPriority,
  EventTransactionLinkInput,
  ListCalendarEventsInput,
  UpdateCalendarEventInput,
} from "@/lib/calendar-data"

export type {
  FinancialSummary,
  FinancialSummaryInput,
  ExportFinancialReportInput,
  ExportFinancialReportResult,
  ReportNoteQueryInput,
  ReportNoteRecord,
  ReviewCandidateActionInput,
  SaveReportNoteInput,
} from "@/lib/financial-summary-data"

export type {
  AiConnectionTestResult,
  AiProfileRecord,
  AiSuggestionQueryInput,
  AiSuggestionRecord,
  AiSuggestionType,
  AiSummaryQueryInput,
  AiSummaryRecord,
  GenerateAiSuggestionsInput,
  GenerateAiSummaryInput,
  ReviewAiSuggestionInput,
  SaveAiProfileInput,
  UpdateAiSummaryInput,
} from "@/lib/local-ai-data"

export type {
  ExportTaxPackageInput,
  ExportTaxPackageResult,
  SaveTaxTagInput,
  SetTransactionTaxTagInput,
  TaxOrganizer,
  TaxTagMutationResult,
  TaxTagRecord,
  TaxYearInput,
} from "@/lib/tax-data"

export type {
  AttachmentAccessInput,
  AttachmentOwnerInput,
  AttachmentOwnerType,
  AttachmentRecord,
  AttachmentType,
  PickAttachmentInput,
} from "@/lib/attachment-data"

export type {
  AnalyzeCsvImportInput,
  CommitCsvImportInput,
  CsvImportAnalysis,
  CsvImportBatchInput,
  CsvImportCommitResult,
  CsvImportMapping,
  CsvImportPreview,
  CsvImportUndoResult,
  PreviewCsvImportInput,
} from "@/lib/csv-import-data"

export type {
  DailyNoteRecord,
  DeleteDailyNoteInput,
  GetDailyNoteInput,
  SaveDailyNoteInput,
} from "@/lib/daily-note-data"

export type {
  BackupIdInput,
  BackupRecord,
  BackupVerificationResult,
  StageRestoreInput,
  StageRestoreResult,
} from "@/lib/backup-data"

export type {
  ListReminderDeliveriesInput,
  MaterializeRecurringInput,
  MaterializeRecurringResult,
  RecurringFrequency,
  RecurringEventRecord,
  RecurringTransactionRecord,
  ReminderDeliveryActionInput,
  ReminderDeliveryRecord,
  SaveRecurringTransactionInput,
  SaveRecurringEventInput,
} from "@/lib/recurring-data"

export type {
  BatchCategoryUpdateInput,
  BatchEditTransactionsInput,
  BatchEditTransactionsResult,
  BatchTransactionPatch,
  BatchTransactionItemsInput,
  BatchTransactionMutationResult,
  Category,
  CreateTransactionInput,
  HouseholdMember,
  ListTransactionsInput,
  Location,
  PaymentMethod,
  SaveCategoryInput,
  SaveHouseholdMemberInput,
  SaveLocationInput,
  SavePaymentMethodInput,
  SaveTransactionTemplateInput,
  SaveTransactionFilterInput,
  TransactionPage,
  TransactionRecord,
  TransactionReferenceData,
  TransactionTemplateData,
  TransactionTemplateRecord,
  TransactionSavedFilterData,
  TransactionSavedFilterRecord,
  TransactionSuggestion,
  TransactionSuggestionInput,
  TransactionMutationResult,
  TransactionVersionInput,
  UndoBatchEditInput,
  TransactionStatus,
  TransactionType,
  UpdateTransactionInput,
} from "@/lib/transaction-data"

export type { NaturalLanguageQueryInput, SafeQueryPlan, ValidatedSafeQuery } from "@/lib/safe-query-data"
export type { GlobalSearchInput, GlobalSearchPage, GlobalSearchResult } from "@/lib/global-search-data"

const themeSchema = z.enum(["system", "light", "dark"])
const appSettingsSchema = z.object({
  locale: z.enum(["zh-CN", "en-CA"]),
  timezoneId: z.string(),
  reportingCurrencyCode: z.string(),
  countryCode: z.string(),
  regionCode: z.string(),
  theme: themeSchema,
  autoBackupPolicy: z.object({
    enabled: z.boolean(),
    intervalDays: z.number().int().min(1).max(365),
    retentionCount: z.number().int().min(1).max(100),
  }),
  calendarColorOverrides: calendarColorOverridesSchema.default({ ...defaultCalendarColorOverrides }),
})
const appStatusSchema = z.object({
  appVersion: z.string(),
  databaseReady: z.boolean(),
  schemaVersion: z.number().int().nonnegative(),
  storageMode: z.enum(["local_only", "browser_preview"]),
})

export type AppSettings = z.infer<typeof appSettingsSchema>
export type AppStatus = z.infer<typeof appStatusSchema>
const exampleDataStatusSchema = z.object({
  loaded: z.boolean(),
  transactionCount: z.number().int().nonnegative(),
})
export type ExampleDataStatus = z.infer<typeof exampleDataStatusSchema>

const defaultSettings: AppSettings = {
  locale: "zh-CN",
  timezoneId: "America/Toronto",
  reportingCurrencyCode: "CAD",
  countryCode: "CA",
  regionCode: "ON",
  theme: "system",
  autoBackupPolicy: { enabled: false, intervalDays: 7, retentionCount: 8 },
  calendarColorOverrides: { ...defaultCalendarColorOverrides },
}

const browserExampleDataStorageKey = "home-ledger.browser-example-data-ids"

function readBrowserExampleDataIds(): string[] {
  try {
    const parsed = z
      .array(z.string())
      .safeParse(JSON.parse(window.localStorage.getItem(browserExampleDataStorageKey) ?? "[]"))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function browserExampleDataStatus(): ExampleDataStatus {
  const ids = new Set(readBrowserExampleDataIds())
  const existing = listBrowserTransactions({ limit: 500 }).records.filter((record) => ids.has(record.id)).length
  return { loaded: existing > 0, transactionCount: existing }
}

function shiftedBrowserDate(monthOffset: number, day: number) {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + monthOffset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}-${String(day).padStart(2, "0")}`
}

function loadBrowserExampleData(): ExampleDataStatus {
  if (browserExampleDataStatus().loaded) throw new Error("示例数据已经加载")
  removeBrowserTransactionsByIds(new Set(readBrowserExampleDataIds()))
  const base = {
    currencyCode: "CAD",
    paymentMethodId: "cash",
    transferToPaymentMethodId: null,
    transferToAmountMinor: null,
    transferToCurrencyCode: null,
    householdMemberId: null,
    locationId: null,
  }
  const fixtures: CreateTransactionInput[] = [
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 1),
      transactionType: "income",
      status: "completed",
      amountMinor: 420000,
      categoryId: "salary",
      merchant: "示例雇主",
      note: "月度工资示例",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 2),
      transactionType: "expense",
      status: "completed",
      amountMinor: 18650,
      categoryId: "food-grocery",
      merchant: "Costco",
      note: "家庭食品采购",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 6),
      transactionType: "expense",
      status: "completed",
      amountMinor: 7850,
      categoryId: "food-restaurant",
      merchant: "家庭餐厅",
      note: "周末聚餐",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 10),
      transactionType: "expense",
      status: "completed",
      amountMinor: 12000,
      categoryId: "medical",
      merchant: "社区诊所",
      note: "医疗候选记录；是否符合税务条件需专业确认",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 15),
      transactionType: "expense",
      status: "completed",
      amountMinor: 289900,
      categoryId: "shopping",
      merchant: "家电商店",
      note: "异常高额示例",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(0, 28),
      transactionType: "expense",
      status: "planned",
      amountMinor: 210000,
      categoryId: "housing-rent",
      merchant: "房东",
      note: "计划房租，不计入实际支出",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(-1, 8),
      transactionType: "expense",
      status: "completed",
      amountMinor: 68000,
      categoryId: "travel",
      merchant: "Vancouver Hotel",
      note: "温哥华旅行酒店",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(-1, 9),
      transactionType: "expense",
      status: "completed",
      amountMinor: 25000,
      currencyCode: "USD",
      categoryId: "travel",
      merchant: "Airline USD",
      note: "外币示例，汇率由程序保存",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(-1, 10),
      transactionType: "expense",
      status: "completed",
      amountMinor: 9450,
      categoryId: "food-restaurant",
      merchant: "Vancouver Restaurant",
      note: "旅行餐饮",
    },
    {
      ...base,
      transactionDate: shiftedBrowserDate(-2, 5),
      transactionType: "income",
      status: "completed",
      amountMinor: 35000,
      categoryId: "refund",
      merchant: "Insurance Refund",
      note: "退款示例",
    },
  ]
  const ids = fixtures.map((fixture) => createBrowserTransaction(fixture).id)
  window.localStorage.setItem(browserExampleDataStorageKey, JSON.stringify(ids))
  return { loaded: true, transactionCount: ids.length }
}

function removeBrowserExampleData(): ExampleDataStatus {
  const ids = readBrowserExampleDataIds()
  if (!ids.length) throw new Error("没有可移除的示例数据")
  removeBrowserTransactionsByIds(new Set(ids))
  window.localStorage.removeItem(browserExampleDataStorageKey)
  return { loaded: false, transactionCount: 0 }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined
}

async function invokeAndParse<T>(command: string, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<T> {
  const result = await invoke<unknown>(command, args)
  return schema.parse(result)
}

function readBrowserSettings(): AppSettings {
  const stored = window.localStorage.getItem("home-ledger.browser-settings")
  if (!stored) return defaultSettings
  try {
    const parsed = appSettingsSchema.safeParse(JSON.parse(stored) as unknown)
    return parsed.success ? parsed.data : defaultSettings
  } catch {
    return defaultSettings
  }
}

export const commandGateway = {
  async globalSearch(input: GlobalSearchInput): Promise<GlobalSearchPage> {
    const validated = globalSearchInputSchema.parse(input)
    if (!isTauriRuntime()) return searchBrowserData(validated)
    return invokeAndParse("global_search", globalSearchPageSchema, { input: validated })
  },

  async translateSafeQuery(input: NaturalLanguageQueryInput): Promise<ValidatedSafeQuery> {
    const validated = naturalLanguageQueryInputSchema.parse(input)
    if (!isTauriRuntime()) {
      throw new Error("自然语言安全查询需要在 HomeLedger 桌面应用中使用本地模型")
    }
    return invokeAndParse("translate_safe_query", validatedSafeQuerySchema, { input: validated })
  },

  async listAttachments(input: AttachmentOwnerInput): Promise<AttachmentRecord[]> {
    const validated = attachmentOwnerInputSchema.parse(input)
    if (!isTauriRuntime()) return []
    return invokeAndParse("list_attachments", z.array(attachmentRecordSchema), { input: validated })
  },

  async pickAttachment(input: PickAttachmentInput): Promise<AttachmentRecord | null> {
    const validated = pickAttachmentInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("附件选择和托管存储需要在 Tauri 桌面应用中使用")
    return invokeAndParse("pick_attachment", attachmentRecordSchema.nullable(), { input: validated })
  },

  async openAttachment(input: AttachmentAccessInput): Promise<void> {
    const validated = attachmentAccessInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("打开托管附件需要在 Tauri 桌面应用中使用")
    await invoke("open_attachment", { input: validated })
  },

  async deleteAttachment(input: AttachmentAccessInput): Promise<void> {
    const validated = attachmentAccessInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("删除托管附件需要在 Tauri 桌面应用中使用")
    await invoke("delete_attachment", { input: validated })
  },

  async listAiProfiles(): Promise<AiProfileRecord[]> {
    if (isTauriRuntime()) return invokeAndParse("list_ai_profiles", z.array(aiProfileRecordSchema))
    return listBrowserAiProfiles()
  },

  async saveAiProfile(input: SaveAiProfileInput): Promise<AiProfileRecord> {
    const validated = saveAiProfileInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_ai_profile", aiProfileRecordSchema, { input: validated })
    }
    return saveBrowserAiProfile(validated)
  },

  async testAiConnection(input: SaveAiProfileInput): Promise<AiConnectionTestResult> {
    const validated = saveAiProfileInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("test_ai_connection", aiConnectionTestResultSchema, { input: validated })
    }
    return testBrowserAiConnection(validated)
  },

  async listAiSummaries(input: AiSummaryQueryInput): Promise<AiSummaryRecord[]> {
    const validated = aiSummaryQueryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_ai_summaries", z.array(aiSummaryRecordSchema), { input: validated })
    }
    return listBrowserAiSummaries(validated)
  },

  async generateAiSummary(input: GenerateAiSummaryInput): Promise<AiSummaryRecord> {
    const validated = generateAiSummaryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("generate_ai_summary", aiSummaryRecordSchema, { input: validated })
    }
    const current = getBrowserFinancialSummary({
      periodStartDate: validated.periodStartDate,
      periodEndDateExclusive: validated.periodEndDateExclusive,
      reportingCurrencyCode: validated.reportingCurrencyCode,
    })
    const previous = getBrowserFinancialSummary({
      periodStartDate: validated.previousPeriodStartDate,
      periodEndDateExclusive: validated.periodStartDate,
      reportingCurrencyCode: validated.reportingCurrencyCode,
    })
    return generateBrowserAiSummary(validated, current, previous)
  },

  async updateAiSummary(input: UpdateAiSummaryInput): Promise<AiSummaryRecord> {
    const validated = updateAiSummaryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("update_ai_summary", aiSummaryRecordSchema, { input: validated })
    }
    return updateBrowserAiSummary(validated)
  },

  async listAiSuggestions(input: AiSuggestionQueryInput): Promise<AiSuggestionRecord[]> {
    const validated = aiSuggestionQueryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_ai_suggestions", z.array(aiSuggestionRecordSchema), { input: validated })
    }
    return listBrowserAiSuggestions(validated)
  },

  async generateAiSuggestions(input: GenerateAiSuggestionsInput): Promise<AiSuggestionRecord[]> {
    const validated = generateAiSuggestionsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("generate_ai_suggestions", z.array(aiSuggestionRecordSchema), { input: validated })
    }
    return generateBrowserAiSuggestions(validated)
  },

  async reviewAiSuggestion(input: ReviewAiSuggestionInput): Promise<AiSuggestionRecord> {
    const validated = reviewAiSuggestionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("review_ai_suggestion", aiSuggestionRecordSchema, { input: validated })
    }
    return reviewBrowserAiSuggestion(validated)
  },

  async getAppStatus(): Promise<AppStatus> {
    if (isTauriRuntime()) return invokeAndParse("get_app_status", appStatusSchema)
    return appStatusSchema.parse({
      appVersion: "0.1.0",
      databaseReady: true,
      schemaVersion: 5,
      storageMode: "browser_preview",
    })
  },

  async getSettings(): Promise<AppSettings> {
    if (isTauriRuntime()) return invokeAndParse("get_settings", appSettingsSchema)
    return readBrowserSettings()
  },

  async updateSettings(input: AppSettings): Promise<AppSettings> {
    const validated = appSettingsSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("update_settings", appSettingsSchema, { input: validated })
    }
    window.localStorage.setItem("home-ledger.browser-settings", JSON.stringify(validated))
    return validated
  },

  async getExampleDataStatus(): Promise<ExampleDataStatus> {
    if (isTauriRuntime()) return invokeAndParse("get_example_data_status", exampleDataStatusSchema)
    return exampleDataStatusSchema.parse(browserExampleDataStatus())
  },

  async loadExampleData(): Promise<ExampleDataStatus> {
    if (isTauriRuntime()) return invokeAndParse("load_example_data", exampleDataStatusSchema)
    return exampleDataStatusSchema.parse(loadBrowserExampleData())
  },

  async removeExampleData(): Promise<ExampleDataStatus> {
    if (isTauriRuntime()) return invokeAndParse("remove_example_data", exampleDataStatusSchema)
    return exampleDataStatusSchema.parse(removeBrowserExampleData())
  },

  async listBackups(): Promise<BackupRecord[]> {
    if (!isTauriRuntime()) return []
    return invokeAndParse("list_backups", z.array(backupRecordSchema))
  },

  async createBackup(): Promise<BackupRecord> {
    if (!isTauriRuntime()) throw new Error("完整备份需要在 Tauri 桌面应用中使用")
    return invokeAndParse("create_backup", backupRecordSchema)
  },

  async verifyBackup(input: BackupIdInput): Promise<BackupVerificationResult> {
    const validated = backupIdInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("备份验证需要在 Tauri 桌面应用中使用")
    return invokeAndParse("verify_backup", backupVerificationResultSchema, { input: validated })
  },

  async stageBackupRestore(input: StageRestoreInput): Promise<StageRestoreResult> {
    const validated = stageRestoreInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("备份恢复需要在 Tauri 桌面应用中使用")
    return invokeAndParse("stage_backup_restore", stageRestoreResultSchema, { input: validated })
  },

  async previewCsvImport(input: PreviewCsvImportInput): Promise<CsvImportPreview> {
    const validated = previewCsvImportInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("CSV 导入需要在 Tauri 桌面应用中使用")
    return invokeAndParse("preview_csv_import", csvImportPreviewSchema, { input: validated })
  },

  async analyzeCsvImport(input: AnalyzeCsvImportInput): Promise<CsvImportAnalysis> {
    const validated = analyzeCsvImportInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("CSV 导入需要在 Tauri 桌面应用中使用")
    return invokeAndParse("analyze_csv_import", csvImportAnalysisSchema, { input: validated })
  },

  async commitCsvImport(input: CommitCsvImportInput): Promise<CsvImportCommitResult> {
    const validated = commitCsvImportInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("CSV 导入需要在 Tauri 桌面应用中使用")
    return invokeAndParse("commit_csv_import", csvImportCommitResultSchema, { input: validated })
  },

  async undoCsvImport(input: CsvImportBatchInput): Promise<CsvImportUndoResult> {
    const validated = csvImportBatchInputSchema.parse(input)
    if (!isTauriRuntime()) throw new Error("CSV 导入需要在 Tauri 桌面应用中使用")
    return invokeAndParse("undo_csv_import", csvImportUndoResultSchema, { input: validated })
  },

  async listCalendarEvents(input: ListCalendarEventsInput): Promise<CalendarEventRecord[]> {
    const validated = listCalendarEventsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_calendar_events", z.array(calendarEventRecordSchema), { input: validated })
    }
    return listBrowserCalendarEvents(validated)
  },

  async getCalendarEvent(input: CalendarEventIdInput): Promise<CalendarEventRecord> {
    const validated = calendarEventIdInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("get_calendar_event", calendarEventRecordSchema, { input: validated })
    }
    return getBrowserCalendarEvent(validated)
  },

  async listDailyFinancialSummaries(input: DailyFinancialSummaryInput): Promise<DailyFinancialSummary[]> {
    const validated = dailyFinancialSummaryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_daily_financial_summaries", z.array(dailyFinancialSummarySchema), {
        input: validated,
      })
    }
    return listBrowserDailyFinancialSummaries(validated)
  },

  async getDailyNote(input: GetDailyNoteInput): Promise<DailyNoteRecord | null> {
    const validated = getDailyNoteInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("get_daily_note", dailyNoteRecordSchema.nullable(), { input: validated })
    }
    return getBrowserDailyNote(validated)
  },

  async saveDailyNote(input: SaveDailyNoteInput): Promise<DailyNoteRecord> {
    const validated = saveDailyNoteInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_daily_note", dailyNoteRecordSchema, { input: validated })
    }
    return saveBrowserDailyNote(validated)
  },

  async deleteDailyNote(input: DeleteDailyNoteInput): Promise<void> {
    const validated = deleteDailyNoteInputSchema.parse(input)
    if (isTauriRuntime()) {
      await invokeAndParse("delete_daily_note", z.null(), { input: validated })
      return
    }
    deleteBrowserDailyNote(validated)
  },

  async getFinancialSummary(input: FinancialSummaryInput): Promise<FinancialSummary> {
    const validated = financialSummaryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("get_financial_summary", financialSummarySchema, { input: validated })
    }
    return getBrowserFinancialSummary(validated)
  },

  async setFinancialReviewCandidateStatus(input: ReviewCandidateActionInput): Promise<ReviewCandidateActionInput> {
    const validated = reviewCandidateActionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("set_financial_review_candidate_status", reviewCandidateActionInputSchema, {
        input: validated,
      })
    }
    return setBrowserReviewCandidateStatus(validated)
  },

  async getReportNote(input: ReportNoteQueryInput): Promise<ReportNoteRecord | null> {
    const validated = reportNoteQueryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("get_report_note", reportNoteRecordSchema.nullable(), { input: validated })
    }
    return getBrowserReportNote(validated)
  },

  async saveReportNote(input: SaveReportNoteInput): Promise<ReportNoteRecord> {
    const validated = saveReportNoteInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_report_note", reportNoteRecordSchema, { input: validated })
    }
    return saveBrowserReportNote(validated)
  },

  async exportFinancialReport(input: ExportFinancialReportInput): Promise<ExportFinancialReportResult> {
    const validated = exportFinancialReportInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("export_financial_report", exportFinancialReportResultSchema, { input: validated })
    }
    return exportBrowserFinancialReport(validated)
  },

  async getTaxOrganizer(input: TaxYearInput): Promise<TaxOrganizer> {
    const validated = taxYearInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("get_tax_organizer", taxOrganizerSchema, { input: validated })
    }
    return getBrowserTaxOrganizer(validated)
  },

  async setTransactionTaxTag(input: SetTransactionTaxTagInput): Promise<TaxTagMutationResult> {
    const validated = setTransactionTaxTagInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("set_transaction_tax_tag", taxTagMutationResultSchema, { input: validated })
    }
    return setBrowserTransactionTaxTag(validated)
  },

  async saveTaxTag(input: SaveTaxTagInput): Promise<TaxTagRecord> {
    const validated = saveTaxTagInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_tax_tag", taxTagRecordSchema, { input: validated })
    }
    return saveBrowserTaxTag(validated)
  },

  async exportTaxPackage(input: ExportTaxPackageInput): Promise<ExportTaxPackageResult> {
    const validated = exportTaxPackageInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("export_tax_package", exportTaxPackageResultSchema, { input: validated })
    }
    return exportBrowserTaxPackage(validated)
  },

  async createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEventRecord> {
    const validated = createCalendarEventInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("create_calendar_event", calendarEventRecordSchema, { input: validated })
    }
    return createBrowserCalendarEvent(validated)
  },

  async updateCalendarEvent(input: UpdateCalendarEventInput): Promise<CalendarEventRecord> {
    const validated = updateCalendarEventInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("update_calendar_event", calendarEventRecordSchema, { input: validated })
    }
    return updateBrowserCalendarEvent(validated)
  },

  async deleteCalendarEvent(input: CalendarEventVersionInput): Promise<CalendarEventVersionInput> {
    const validated = calendarEventVersionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("delete_calendar_event", calendarEventVersionInputSchema, { input: validated })
    }
    return deleteBrowserCalendarEvent(validated)
  },

  async restoreCalendarEvent(input: CalendarEventVersionInput): Promise<CalendarEventRecord> {
    const validated = calendarEventVersionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("restore_calendar_event", calendarEventRecordSchema, { input: validated })
    }
    return restoreBrowserCalendarEvent(validated)
  },

  async linkEventTransaction(input: EventTransactionLinkInput): Promise<CalendarEventRecord> {
    const validated = eventTransactionLinkInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("link_event_transaction", calendarEventRecordSchema, { input: validated })
    }
    return setBrowserEventTransactionLink(validated, true)
  },

  async unlinkEventTransaction(input: EventTransactionLinkInput): Promise<CalendarEventRecord> {
    const validated = eventTransactionLinkInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("unlink_event_transaction", calendarEventRecordSchema, { input: validated })
    }
    return setBrowserEventTransactionLink(validated, false)
  },

  async listRecurringTransactions(): Promise<RecurringTransactionRecord[]> {
    if (isTauriRuntime()) {
      return invokeAndParse("list_recurring_transactions", z.array(recurringTransactionRecordSchema))
    }
    return listBrowserRecurringTransactions()
  },

  async listRecurringEvents(): Promise<RecurringEventRecord[]> {
    if (isTauriRuntime()) {
      return invokeAndParse("list_recurring_events", z.array(recurringEventRecordSchema))
    }
    return listBrowserRecurringEvents()
  },

  async saveRecurringTransaction(input: SaveRecurringTransactionInput): Promise<RecurringTransactionRecord> {
    const validated = saveRecurringTransactionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_recurring_transaction", recurringTransactionRecordSchema, { input: validated })
    }
    return saveBrowserRecurringTransaction(validated)
  },

  async saveRecurringEvent(input: SaveRecurringEventInput): Promise<RecurringEventRecord> {
    const validated = saveRecurringEventInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_recurring_event", recurringEventRecordSchema, { input: validated })
    }
    return saveBrowserRecurringEvent(validated)
  },

  async materializeRecurringTransactions(input: MaterializeRecurringInput): Promise<MaterializeRecurringResult> {
    const validated = materializeRecurringInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("materialize_recurring_transactions", materializeRecurringResultSchema, {
        input: validated,
      })
    }
    return materializeRecurringResultSchema.parse(materializeBrowserRecurringTransactions(validated))
  },

  async listReminderDeliveries(input: ListReminderDeliveriesInput): Promise<ReminderDeliveryRecord[]> {
    const validated = listReminderDeliveriesInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_reminder_deliveries", z.array(reminderDeliveryRecordSchema), {
        input: validated,
      })
    }
    return listBrowserReminderDeliveries(validated)
  },

  async markReminderDelivered(input: ReminderDeliveryActionInput): Promise<void> {
    const validated = reminderDeliveryActionInputSchema.parse(input)
    if (isTauriRuntime()) {
      await invoke("mark_reminder_delivered", { input: validated })
      return
    }
    setBrowserReminderStatus(validated, "delivered")
  },

  async dismissReminder(input: ReminderDeliveryActionInput): Promise<void> {
    const validated = reminderDeliveryActionInputSchema.parse(input)
    if (isTauriRuntime()) {
      await invoke("dismiss_reminder", { input: validated })
      return
    }
    setBrowserReminderStatus(validated, "dismissed")
  },

  async listTransactionReferenceData(): Promise<TransactionReferenceData> {
    if (isTauriRuntime()) {
      return invokeAndParse("list_transaction_reference_data", transactionReferenceDataSchema)
    }
    return transactionReferenceDataSchema.parse(readBrowserReferenceData())
  },

  async saveCategory(input: SaveCategoryInput) {
    const validated = saveCategoryInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_category", transactionReferenceDataSchema.shape.categories.element, {
        input: validated,
      })
    }
    return saveBrowserCategory(validated)
  },

  async saveHouseholdMember(input: SaveHouseholdMemberInput) {
    const validated = saveHouseholdMemberInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_household_member", householdMemberSchema, { input: validated })
    }
    return saveBrowserHouseholdMember(validated)
  },

  async saveLocation(input: SaveLocationInput) {
    const validated = saveLocationInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_location", locationSchema, {
        input: validated,
      })
    }
    return saveBrowserLocation(validated)
  },

  async savePaymentMethod(input: SavePaymentMethodInput) {
    const validated = savePaymentMethodInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_payment_method", transactionReferenceDataSchema.shape.paymentMethods.element, {
        input: validated,
      })
    }
    return saveBrowserPaymentMethod(validated)
  },

  async listTransactionTemplates(includeInactive = false): Promise<TransactionTemplateRecord[]> {
    if (isTauriRuntime()) {
      return invokeAndParse("list_transaction_templates", z.array(transactionTemplateRecordSchema), {
        includeInactive,
      })
    }
    return listBrowserTransactionTemplates(includeInactive)
  },

  async saveTransactionTemplate(input: SaveTransactionTemplateInput): Promise<TransactionTemplateRecord> {
    const validated = saveTransactionTemplateInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_transaction_template", transactionTemplateRecordSchema, { input: validated })
    }
    return saveBrowserTransactionTemplate(validated)
  },

  async useTransactionTemplate(id: string): Promise<TransactionTemplateRecord> {
    const input = transactionTemplateIdInputSchema.parse({ id })
    if (isTauriRuntime()) {
      return invokeAndParse("use_transaction_template", transactionTemplateRecordSchema, { input })
    }
    return applyBrowserTransactionTemplate(input.id)
  },

  async listTransactionFilters(): Promise<TransactionSavedFilterRecord[]> {
    if (isTauriRuntime()) {
      return invokeAndParse("list_transaction_filters", z.array(transactionSavedFilterRecordSchema))
    }
    return listBrowserTransactionFilters()
  },

  async saveTransactionFilter(input: SaveTransactionFilterInput): Promise<TransactionSavedFilterRecord> {
    const validated = saveTransactionFilterInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("save_transaction_filter", transactionSavedFilterRecordSchema, { input: validated })
    }
    return saveBrowserTransactionFilter(validated)
  },

  async deleteTransactionFilter(id: string): Promise<void> {
    const input = { id: z.string().min(1).parse(id) }
    if (isTauriRuntime()) {
      await invoke("delete_transaction_filter", { input })
      return
    }
    deleteBrowserTransactionFilter(input.id)
  },

  async suggestTransaction(input: TransactionSuggestionInput): Promise<TransactionSuggestion> {
    const validated = transactionSuggestionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("suggest_transaction", transactionSuggestionSchema, { input: validated })
    }
    return suggestBrowserTransaction(validated)
  },

  async listTransactions(input: ListTransactionsInput = {}): Promise<TransactionPage> {
    const validated = listTransactionsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("list_transactions", transactionPageSchema, { input: validated })
    }
    return listBrowserTransactions(validated)
  },

  async createTransaction(input: CreateTransactionInput): Promise<TransactionRecord> {
    const validated = createTransactionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("create_transaction", transactionRecordSchema, { input: validated })
    }
    return createBrowserTransaction(validated)
  },

  async updateTransaction(input: UpdateTransactionInput): Promise<TransactionRecord> {
    const validated = updateTransactionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("update_transaction", transactionRecordSchema, { input: validated })
    }
    return updateBrowserTransaction(validated)
  },

  async deleteTransaction(input: TransactionVersionInput): Promise<TransactionMutationResult> {
    const validated = transactionVersionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("delete_transaction", transactionMutationResultSchema, { input: validated })
    }
    return deleteBrowserTransaction(validated)
  },

  async restoreTransaction(input: TransactionVersionInput): Promise<TransactionRecord> {
    const validated = transactionVersionInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("restore_transaction", transactionRecordSchema, { input: validated })
    }
    return restoreBrowserTransaction(validated)
  },

  async batchUpdateTransactionCategory(input: BatchCategoryUpdateInput): Promise<BatchTransactionMutationResult> {
    const validated = batchCategoryUpdateInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("batch_update_transaction_category", batchTransactionMutationResultSchema, {
        input: validated,
      })
    }
    return batchUpdateBrowserTransactionCategory(validated)
  },

  async batchEditTransactions(input: BatchEditTransactionsInput): Promise<BatchEditTransactionsResult> {
    const validated = batchEditTransactionsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("batch_edit_transactions", batchEditTransactionsResultSchema, { input: validated })
    }
    return batchEditBrowserTransactions(validated)
  },

  async undoBatchEditTransactions(input: UndoBatchEditInput): Promise<BatchEditTransactionsResult> {
    const validated = undoBatchEditInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("undo_batch_edit_transactions", batchEditTransactionsResultSchema, { input: validated })
    }
    return undoBatchEditBrowserTransactions(validated)
  },

  async batchDeleteTransactions(input: BatchTransactionItemsInput): Promise<BatchTransactionMutationResult> {
    const validated = batchTransactionItemsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("batch_delete_transactions", batchTransactionMutationResultSchema, { input: validated })
    }
    return batchDeleteBrowserTransactions(validated)
  },

  async batchRestoreTransactions(input: BatchTransactionItemsInput): Promise<BatchTransactionMutationResult> {
    const validated = batchTransactionItemsInputSchema.parse(input)
    if (isTauriRuntime()) {
      return invokeAndParse("batch_restore_transactions", batchTransactionMutationResultSchema, { input: validated })
    }
    return batchRestoreBrowserTransactions(validated)
  },
}
