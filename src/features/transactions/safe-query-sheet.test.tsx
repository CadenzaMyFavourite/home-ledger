import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SafeQuerySheet } from "@/features/transactions/safe-query-sheet"
import { commandGateway, type ValidatedSafeQuery } from "@/lib/commands"
import "@/lib/i18n"

describe("SafeQuerySheet", () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it("shows a validated plan and requires explicit application", async () => {
    window.__TAURI_INTERNALS__ = {}
    const validated: ValidatedSafeQuery = {
      plan: {
        schemaVersion: 1,
        intent: "list_transactions",
        filters: { transactionType: "expense", categoryId: "education", hasAttachment: false },
        sort: { field: "amount", direction: "desc" },
        limit: 100,
        explanation: "列出教育支出中没有附件的记录。",
      },
      filters: {
        transactionType: "expense",
        categoryId: "education",
        hasAttachment: false,
        sortBy: "amount",
        sortDirection: "desc",
        limit: 100,
        offset: 0,
      },
    }
    vi.spyOn(commandGateway, "translateSafeQuery").mockResolvedValue(validated)
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <SafeQuerySheet open onOpenChange={vi.fn()} onApply={onApply} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText("你想查什么？"), "去年教育支出中没有收据的记录")
    await user.click(screen.getByRole("button", { name: "生成筛选计划" }))
    expect(await screen.findByText("列出教育支出中没有附件的记录。")).toBeVisible()
    expect(onApply).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "确认并应用" }))
    expect(onApply).toHaveBeenCalledWith(validated)
  })
})
