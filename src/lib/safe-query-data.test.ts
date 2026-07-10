import { describe, expect, it } from "vitest"

import { naturalLanguageQueryInputSchema, safeQueryPlanSchema, validatedSafeQuerySchema } from "@/lib/safe-query-data"

const validPlan = {
  schemaVersion: 1,
  intent: "list_transactions",
  filters: {
    transactionType: "expense",
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    hasAttachment: false,
  },
  sort: { field: "amount", direction: "desc" },
  limit: 100,
  explanation: "Review expenses without attachments.",
} as const

describe("safe query schemas", () => {
  it("accepts a bounded typed plan and normalizes null compiled filters", () => {
    expect(safeQueryPlanSchema.parse(validPlan)).toMatchObject(validPlan)
    const validated = validatedSafeQuerySchema.parse({
      plan: validPlan,
      filters: {
        search: null,
        transactionType: "expense",
        status: null,
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        limit: 100,
        offset: 0,
      },
    })
    expect(validated.filters.search).toBeUndefined()
    expect(validated.filters.transactionType).toBe("expense")
  })

  it("rejects unknown operators, SQL, paths, network text, and invalid ranges", () => {
    for (const search of ["x'; DROP TABLE transactions;--", "file://../../secret", "https://example.com"]) {
      expect(() => safeQueryPlanSchema.parse({ ...validPlan, filters: { search } })).toThrow()
    }
    expect(() => safeQueryPlanSchema.parse({ ...validPlan, filters: {}, sql: "SELECT * FROM transactions" })).toThrow()
    expect(() =>
      safeQueryPlanSchema.parse({
        ...validPlan,
        filters: { dateFrom: "2010-01-01", dateTo: "2026-01-01" },
      }),
    ).toThrow()
    expect(() =>
      safeQueryPlanSchema.parse({ ...validPlan, filters: { amountMinMinor: 200, amountMaxMinor: 100 } }),
    ).toThrow()
  })

  it("bounds the user question and rejects control characters", () => {
    expect(naturalLanguageQueryInputSchema.parse({ query: "去年教育支出", locale: "zh-CN" })).toBeTruthy()
    expect(() => naturalLanguageQueryInputSchema.parse({ query: "bad\u0000query", locale: "zh-CN" })).toThrow()
    expect(() => naturalLanguageQueryInputSchema.parse({ query: "x".repeat(501), locale: "en-CA" })).toThrow()
  })
})
