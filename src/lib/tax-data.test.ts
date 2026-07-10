import { beforeEach, describe, expect, it } from "vitest"

import { commandGateway } from "@/lib/commands"
import { readBrowserTransactions } from "@/lib/transaction-data"

describe("browser tax organizer", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
  })

  it("uses completed actual records and preserves integer amounts when tags change", async () => {
    await commandGateway.createTransaction({
      transactionDate: "2026-03-01",
      transactionType: "income",
      status: "completed",
      amountMinor: 500_001,
      currencyCode: "CAD",
      categoryId: "salary",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Employer",
      note: null,
    })
    const expense = await commandGateway.createTransaction({
      transactionDate: "2026-03-02",
      transactionType: "expense",
      status: "completed",
      amountMinor: 12_345,
      currencyCode: "CAD",
      categoryId: "medical",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Clinic",
      note: "Candidate only",
    })
    await commandGateway.createTransaction({
      transactionDate: "2026-03-03",
      transactionType: "expense",
      status: "planned",
      amountMinor: 99_999,
      currencyCode: "CAD",
      categoryId: "medical",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Future clinic",
      note: null,
    })

    const before = await commandGateway.getTaxOrganizer({ year: 2026, reportingCurrencyCode: "CAD" })
    expect(before).toMatchObject({
      incomeMinor: 500_001,
      candidateExpenseMinor: 12_345,
      candidateCount: 1,
      missingReceiptCount: 1,
    })
    const result = await commandGateway.setTransactionTaxTag({
      transactionId: expense.id,
      transactionVersion: expense.version,
      taxTagId: "00000000-0000-7000-8000-000000000207",
      selected: true,
    })
    expect(result.transactionVersion).toBe(2)
    expect(readBrowserTransactions().find((record) => record.id === expense.id)).toMatchObject({
      amountMinor: 12_345,
      version: 2,
    })
    const after = await commandGateway.getTaxOrganizer({ year: 2026, reportingCurrencyCode: "CAD" })
    expect(after.confirmedTaggedCount).toBe(1)
    expect(after.needsReviewCount).toBe(0)
    expect(after.tagTotals).toEqual([expect.objectContaining({ amountMinor: 12_345, transactionCount: 1 })])
  })

  it("removes manually excluded hints from candidate totals", async () => {
    const expense = await commandGateway.createTransaction({
      transactionDate: "2026-04-02",
      transactionType: "expense",
      status: "completed",
      amountMinor: 44_444,
      currencyCode: "CAD",
      categoryId: "medical",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Personal purchase",
      note: null,
    })
    expect((await commandGateway.getTaxOrganizer({ year: 2026, reportingCurrencyCode: "CAD" })).candidateCount).toBe(1)
    await commandGateway.setTransactionTaxTag({
      transactionId: expense.id,
      transactionVersion: expense.version,
      taxTagId: "00000000-0000-7000-8000-000000000201",
      selected: true,
    })
    const organizer = await commandGateway.getTaxOrganizer({ year: 2026, reportingCurrencyCode: "CAD" })
    expect(organizer.candidateCount).toBe(0)
    expect(organizer.candidateExpenseMinor).toBe(0)
  })

  it("creates custom organizer tags without changing system tags", async () => {
    const saved = await commandGateway.saveTaxTag({
      id: null,
      name: "Professional review",
      description: "Ask the accountant",
      isActive: true,
    })
    expect(saved).toMatchObject({ isSystem: false, isActive: true })
    const organizer = await commandGateway.getTaxOrganizer({ year: 2026, reportingCurrencyCode: "CAD" })
    expect(organizer.tags).toContainEqual(saved)
    await expect(
      commandGateway.saveTaxTag({
        id: "00000000-0000-7000-8000-000000000207",
        name: "Changed",
        description: null,
        isActive: true,
      }),
    ).rejects.toThrow("系统税务标签不可修改")
  })
})
