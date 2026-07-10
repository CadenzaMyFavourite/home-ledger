import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { AttachmentManager } from "@/features/attachments/attachment-manager"
import "@/lib/i18n"

describe("AttachmentManager", () => {
  beforeEach(() => {
    delete window.__TAURI_INTERNALS__
  })

  it("does not pretend that the browser preview can manage local files", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AttachmentManager ownerType="transaction" ownerId="transaction-1" />
      </QueryClientProvider>,
    )

    expect(await screen.findByText("桌面应用功能")).toBeVisible()
    expect(screen.getByRole("button", { name: "选择文件" })).toBeDisabled()
    expect(await screen.findByText("还没有附件")).toBeVisible()
  })
})
