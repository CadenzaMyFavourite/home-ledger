import { z } from "zod"

import { listTransactionsInputSchema, transactionStatusSchema, transactionTypeSchema } from "@/lib/transaction-data"

export const naturalLanguageQueryInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => Array.from(value).every((character) => !isControlCharacter(character))),
    locale: z.enum(["zh-CN", "en-CA"]),
  })
  .strict()

const safeSearchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => Array.from(value).every((character) => !isControlCharacter(character)))
  .refine((value) => {
    const lowered = value.toLocaleLowerCase()
    return ![";", "--", "/*", "*/", "://", "../", "..\\"].some((token) => lowered.includes(token))
  })

const safeQueryFiltersSchema = z
  .object({
    search: safeSearchSchema.nullable().optional(),
    transactionType: transactionTypeSchema.nullable().optional(),
    status: transactionStatusSchema.nullable().optional(),
    dateFrom: z.string().date().nullable().optional(),
    dateTo: z.string().date().nullable().optional(),
    amountMinMinor: z.number().int().safe().min(0).max(9_000_000_000_000_000).nullable().optional(),
    amountMaxMinor: z.number().int().safe().min(0).max(9_000_000_000_000_000).nullable().optional(),
    categoryId: z.string().min(1).max(100).nullable().optional(),
    paymentMethodId: z.string().min(1).max(100).nullable().optional(),
    householdMemberId: z.string().min(1).max(100).nullable().optional(),
    locationId: z.string().min(1).max(100).nullable().optional(),
    hasAttachment: z.boolean().nullable().optional(),
    isLinkedToEvent: z.boolean().nullable().optional(),
    isPossibleTaxCandidate: z.boolean().nullable().optional(),
    isRecurring: z.boolean().nullable().optional(),
    isUncategorized: z.boolean().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo) {
      if (value.dateFrom > value.dateTo) {
        context.addIssue({ code: "custom", path: ["dateTo"], message: "Date range is reversed" })
      } else {
        const days = (Date.parse(value.dateTo) - Date.parse(value.dateFrom)) / 86_400_000
        if (days > 3_660) {
          context.addIssue({ code: "custom", path: ["dateTo"], message: "Date range exceeds ten years" })
        }
      }
    }
    if (
      value.amountMinMinor !== null &&
      value.amountMinMinor !== undefined &&
      value.amountMaxMinor !== null &&
      value.amountMaxMinor !== undefined &&
      value.amountMinMinor > value.amountMaxMinor
    ) {
      context.addIssue({ code: "custom", path: ["amountMaxMinor"], message: "Amount range is reversed" })
    }
  })

export const safeQueryPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    intent: z.literal("list_transactions"),
    filters: safeQueryFiltersSchema,
    sort: z
      .object({
        field: z.enum(["transaction_date", "amount", "merchant", "created_at"]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .nullable()
      .optional(),
    limit: z.number().int().min(1).max(200),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict()

export const validatedSafeQuerySchema = z
  .object({
    plan: safeQueryPlanSchema,
    filters: z.preprocess(
      (value) =>
        value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null))
          : value,
      listTransactionsInputSchema,
    ),
  })
  .strict()

export type NaturalLanguageQueryInput = z.infer<typeof naturalLanguageQueryInputSchema>
export type SafeQueryPlan = z.infer<typeof safeQueryPlanSchema>
export type ValidatedSafeQuery = z.infer<typeof validatedSafeQuerySchema>

function isControlCharacter(character: string) {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}
