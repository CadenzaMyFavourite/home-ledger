import { z } from "zod"

export const previewCsvImportInputSchema = z.object({ sourcePath: z.string().min(1), hasHeader: z.boolean() })
export const csvImportPreviewSchema = z.object({
  batchId: z.string(),
  sourceFilename: z.string(),
  delimiter: z.enum(["comma", "tab", "semicolon"]),
  headers: z.array(z.string()),
  previewRows: z.array(z.record(z.string(), z.string())),
  totalRows: z.number().int().nonnegative(),
})
export const csvImportMappingSchema = z.object({
  dateColumn: z.string().min(1),
  amountColumn: z.string().min(1),
  descriptionColumn: z.string().nullable(),
  merchantColumn: z.string().nullable(),
  transactionTypeColumn: z.string().nullable(),
  currencyColumn: z.string().nullable(),
  dateFormat: z.enum(["yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy", "yyyy/MM/dd"]),
  amountSign: z.enum(["negative_expense", "positive_expense"]),
  defaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
  paymentMethodId: z.string().nullable(),
})
export const analyzeCsvImportInputSchema = z.object({ batchId: z.string().min(1), mapping: csvImportMappingSchema })
const csvImportAnalyzedRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  transactionDate: z.string().nullable(),
  transactionType: z.string().nullable(),
  amountMinor: z.number().int().nonnegative().nullable(),
  currencyCode: z.string().nullable(),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  duplicate: z.boolean(),
  duplicateOfTransactionId: z.string().nullable(),
  error: z.string().nullable(),
})
export const csvImportAnalysisSchema = z.object({
  batchId: z.string(),
  validCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  rows: z.array(csvImportAnalyzedRowSchema),
  truncated: z.boolean(),
})
export const commitCsvImportInputSchema = z.object({
  batchId: z.string().min(1),
  mapping: csvImportMappingSchema,
  importDuplicateRowNumbers: z.array(z.number().int().positive()),
})
export const csvImportCommitResultSchema = z.object({
  batchId: z.string(),
  importedCount: z.number().int().nonnegative(),
  skippedDuplicateCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
})
export const csvImportBatchInputSchema = z.object({ batchId: z.string().min(1) })
export const csvImportUndoResultSchema = z.object({
  batchId: z.string(),
  removedCount: z.number().int().nonnegative(),
})

export type PreviewCsvImportInput = z.infer<typeof previewCsvImportInputSchema>
export type CsvImportPreview = z.infer<typeof csvImportPreviewSchema>
export type CsvImportMapping = z.infer<typeof csvImportMappingSchema>
export type AnalyzeCsvImportInput = z.infer<typeof analyzeCsvImportInputSchema>
export type CsvImportAnalysis = z.infer<typeof csvImportAnalysisSchema>
export type CommitCsvImportInput = z.infer<typeof commitCsvImportInputSchema>
export type CsvImportCommitResult = z.infer<typeof csvImportCommitResultSchema>
export type CsvImportBatchInput = z.infer<typeof csvImportBatchInputSchema>
export type CsvImportUndoResult = z.infer<typeof csvImportUndoResultSchema>
