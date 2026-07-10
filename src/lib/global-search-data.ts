import { z } from "zod"

import { listBrowserCalendarEvents } from "@/lib/calendar-data"
import { listBrowserTransactions } from "@/lib/transaction-data"

export const globalSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict()

export const globalSearchResultSchema = z
  .object({
    kind: z.enum(["transaction", "event", "attachment"]),
    id: z.string().min(1),
    ownerType: z.enum(["transaction", "event"]),
    ownerId: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().nullable(),
    occurredOn: z.string().nullable(),
  })
  .strict()

export const globalSearchPageSchema = z
  .object({
    records: z.array(globalSearchResultSchema),
    total: z.number().int().nonnegative(),
  })
  .strict()

export type GlobalSearchInput = z.infer<typeof globalSearchInputSchema>
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>
export type GlobalSearchPage = z.infer<typeof globalSearchPageSchema>

export function searchBrowserData(input: GlobalSearchInput): GlobalSearchPage {
  const validated = globalSearchInputSchema.parse(input)
  const query = validated.query.toLocaleLowerCase()
  const transactionPage = listBrowserTransactions({ search: validated.query, limit: 500, offset: 0 })
  const transactions: GlobalSearchResult[] = transactionPage.records.map((record) => ({
    kind: "transaction",
    id: record.id,
    ownerType: "transaction",
    ownerId: record.id,
    title: record.merchant ?? record.note ?? record.transactionDate,
    subtitle: [record.categoryName, record.paymentMethodName].filter(Boolean).join(" · ") || null,
    occurredOn: record.transactionDate,
  }))
  const events: GlobalSearchResult[] = listBrowserCalendarEvents({
    rangeStartDate: "1900-01-01",
    rangeEndDateExclusive: "2100-01-01",
    timezoneId: "America/Toronto",
  })
    .filter((record) =>
      [record.title, record.description, record.locationName, record.householdMemberName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    )
    .map((record) => ({
      kind: "event",
      id: record.id,
      ownerType: "event",
      ownerId: record.id,
      title: record.title,
      subtitle: [record.eventType, record.locationName].filter(Boolean).join(" · ") || null,
      occurredOn: record.startDate ?? record.startAtUtc?.slice(0, 10) ?? null,
    }))
  const records = [...transactions, ...events].sort((left, right) =>
    (right.occurredOn ?? "").localeCompare(left.occurredOn ?? ""),
  )
  const offset = validated.offset ?? 0
  const limit = validated.limit ?? 30
  return { records: records.slice(offset, offset + limit), total: records.length }
}
