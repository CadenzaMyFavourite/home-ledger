import { expect, test } from "@playwright/test"

test("all core routes render without external requests", async ({ page }) => {
  const externalRequests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url())
  })

  const routes = [
    ["/", "家庭概览"],
    ["/transactions", "收支记录"],
    ["/reference-data", "常用选项"],
    ["/calendar", "家庭日历"],
    ["/reports", "财务报告"],
    ["/tax", "税务资料整理"],
    ["/backup", "备份与恢复"],
    ["/settings", "设置"],
  ] as const

  for (const [route, heading] of routes) {
    await page.goto(route)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
    await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  }
  expect(externalRequests).toEqual([])
})

test("automatic backup settings persist after reload", async ({ page }) => {
  await page.goto("/settings")
  await page.locator("#autoBackupEnabled").check()
  await page.locator("#autoBackupInterval").fill("14")
  await page.locator("#autoBackupRetention").fill("6")
  await page.getByRole("button", { name: "保存设置" }).click()
  await expect(page.getByRole("button", { name: "保存设置" })).toBeDisabled()

  await page.reload()
  await expect(page.locator("#autoBackupEnabled")).toBeChecked()
  await expect(page.locator("#autoBackupInterval")).toHaveValue("14")
  await expect(page.locator("#autoBackupRetention")).toHaveValue("6")
})

test("calendar color overrides persist and become event defaults", async ({ page }) => {
  await page.goto("/settings")
  await page.locator("#calendar-color-travel").fill("#123456")
  await page.locator('form button[type="submit"]').first().click()
  await expect(page.locator('form button[type="submit"]').first()).toBeDisabled()

  await page.reload()
  await expect(page.locator("#calendar-color-travel")).toHaveValue("#123456")

  await page.goto("/calendar")
  await page.getByRole("button", { name: "添加事件" }).click()
  await page.locator("#event-eventType").click()
  await page.getByRole("option", { name: "旅行" }).click()
  await expect(page.locator("#event-color")).toHaveValue("#123456")

  await page.goto("/settings")
  await page.getByRole("button", { name: "恢复默认颜色" }).click()
  await expect(page.locator("#calendar-color-travel")).toHaveValue("#7455d9")
  await page.locator('form button[type="submit"]').first().click()
  await page.reload()
  await expect(page.locator("#calendar-color-travel")).toHaveValue("#7455d9")
})

test("transactions can be added and rows support arrow-key navigation", async ({ page }) => {
  await page.goto("/transactions")

  for (const [merchant, amount] of [
    ["E2E Market", "42.50"],
    ["E2E Transit", "18.25"],
  ] as const) {
    await page.getByRole("button", { name: "添加记录" }).click()
    await expect(page.getByRole("heading", { name: "添加记录" })).toBeVisible()
    await page.getByLabel("金额", { exact: true }).fill(amount)
    await page.getByLabel("商家或对方", { exact: true }).fill(merchant)
    await page.getByRole("button", { name: "保存记录" }).click()
    await expect(page.getByText(merchant, { exact: true })).toBeVisible()
  }

  const rows = page.locator('tbody tr[tabindex="0"]')
  await expect(rows).toHaveCount(2)
  await rows.nth(0).focus()
  await rows.nth(0).press("ArrowDown")
  await expect(rows.nth(1)).toBeFocused()
})

test("batch edit updates only checked fields and can undo the whole operation", async ({ page }) => {
  await page.goto("/transactions")
  for (const [merchant, amount] of [
    ["Batch E2E One", "31.25"],
    ["Batch E2E Two", "47.80"],
  ] as const) {
    await page.getByRole("button", { name: "添加记录" }).click()
    await page.getByLabel("金额", { exact: true }).fill(amount)
    await page.getByLabel("商家或对方", { exact: true }).fill(merchant)
    await page.getByRole("button", { name: "保存记录" }).click()
  }
  await page.getByLabel("选择记录：Batch E2E One").check()
  await page.getByLabel("选择记录：Batch E2E Two").check()
  await page.getByRole("button", { name: "批量编辑" }).click()
  await expect(page.getByRole("heading", { name: "批量编辑 2 笔记录" })).toBeVisible()
  if (process.env.CAPTURE_BATCH_EDIT_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAPTURE_BATCH_EDIT_SCREENSHOT, fullPage: false })
  }
  await page.getByLabel("状态", { exact: true }).check()
  await page.getByLabel("批量状态").click()
  await page.getByRole("option", { name: "等待确认" }).click()
  await page.getByRole("button", { name: "应用批量修改" }).click()
  await expect(page.getByText("已修改 2 笔记录")).toBeVisible()
  await expect(page.getByRole("cell", { name: "等待确认" })).toHaveCount(2)

  await page.getByRole("button", { name: "撤销" }).click()
  await expect(page.getByText("已撤销 2 笔修改")).toBeVisible()
  await expect(page.getByRole("cell", { name: "已完成" })).toHaveCount(2)
  await expect(page.getByRole("cell", { name: "CAD 31.25" })).toHaveCount(1)
  await expect(page.getByRole("cell", { name: "CAD 47.80" })).toHaveCount(1)
})

test("transaction and event attachment entry points render safe browser-preview states", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/transactions")
  await page.getByRole("button", { name: "添加记录" }).click()
  await page.getByLabel("金额", { exact: true }).fill("12.34")
  await page.getByLabel("商家或对方", { exact: true }).fill("Attachment E2E")
  await page.getByRole("button", { name: "保存记录" }).click()

  const transactionRow = page.getByRole("row").filter({ hasText: "Attachment E2E" })
  await expect(transactionRow).toHaveCount(1)
  await transactionRow.getByRole("button", { name: "更多操作：Attachment E2E" }).click()
  await page.getByRole("menuitem", { name: "附件" }).click()
  await expect(page.getByRole("heading", { level: 2, name: "附件" })).toBeVisible()
  await expect(page.getByText("桌面应用功能")).toBeVisible()
  await expect(page.getByRole("button", { name: "选择文件" })).toBeDisabled()
  if (process.env.CAPTURE_QA_SCREENSHOT) {
    await page.waitForTimeout(250)
    await page.screenshot({ path: process.env.CAPTURE_QA_SCREENSHOT, fullPage: false })
  }

  await page.goto("/calendar")
  await page.getByRole("button", { name: "添加事件", exact: true }).click()
  await page.getByLabel("事件标题", { exact: true }).fill("Attachment event E2E")
  await page.getByRole("button", { name: "保存事件" }).click()
  const eventCard = page.locator(".fc-event").filter({ hasText: "Attachment event E2E" })
  await expect(eventCard).toHaveCount(1)
  await eventCard.click()
  await expect(page.getByRole("heading", { name: "编辑事件" })).toBeVisible()
  await expect(page.getByText("桌面应用功能")).toBeVisible()
  await expect(page.getByRole("button", { name: "选择文件" })).toBeDisabled()

  expect(consoleErrors).toEqual([])
})

test("natural-language query requires a reviewed safe plan and never simulates AI in the browser", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.goto("/transactions")
  await page.getByRole("button", { name: "自然语言查询" }).click()
  await expect(page.getByRole("heading", { name: "安全自然语言查询" })).toBeVisible()
  await expect(page.getByText("发送范围：问题与选项名称")).toBeVisible()
  await expect(page.getByText("需要桌面应用和本地模型")).toBeVisible()

  const query = page.getByLabel("你想查什么？")
  await query.fill("列出去年教育支出中没有收据的记录")
  await expect(page.getByRole("button", { name: "生成筛选计划" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "确认并应用" })).toBeDisabled()
  await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  if (process.env.CAPTURE_SAFE_QUERY_SCREENSHOT) {
    await page.waitForTimeout(250)
    await page.screenshot({ path: process.env.CAPTURE_SAFE_QUERY_SCREENSHOT, fullPage: false })
  }
  expect(consoleErrors).toEqual([])
})

test("global search opens the matching transaction detail", async ({ page }) => {
  await page.goto("/transactions")
  await page.getByRole("button", { name: "添加记录" }).click()
  await page.getByLabel("金额", { exact: true }).fill("27.45")
  await page.getByLabel("商家或对方", { exact: true }).fill("Searchable E2E Market")
  await page.getByRole("button", { name: "保存记录" }).click()
  await expect(page.getByText("Searchable E2E Market", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "搜索账目、事件和附件" }).click()
  await expect(page.getByRole("heading", { name: "全局搜索" })).toBeVisible()
  await page.getByLabel("输入至少 2 个字符").fill("Searchable E2E")
  const result = page.getByRole("button").filter({ hasText: "Searchable E2E Market" })
  await expect(result).toHaveCount(1)
  if (process.env.CAPTURE_GLOBAL_SEARCH_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAPTURE_GLOBAL_SEARCH_SCREENSHOT, fullPage: false })
  }
  await result.click()
  await expect(page.getByRole("heading", { name: "编辑记录" })).toBeVisible()
  await expect(page.getByLabel("商家或对方", { exact: true })).toHaveValue("Searchable E2E Market")
})

test("year overview renders twelve keyboard-accessible months and opens the selected month", async ({ page }) => {
  await page.goto("/calendar")
  await page.getByRole("button", { name: "年度概览" }).click()
  await expect(page.getByRole("heading", { name: `${new Date().getFullYear()} 年度概览` })).toBeVisible()
  const months = page.locator('button[aria-label^="打开"]')
  await expect(months).toHaveCount(12)
  if (process.env.CAPTURE_YEAR_OVERVIEW_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAPTURE_YEAR_OVERVIEW_SCREENSHOT, fullPage: false })
  }
  const january = page.locator('button[aria-label^="打开一月"]')
  await expect(january).toHaveCount(1)
  await january.focus()
  await january.press("Enter")
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByRole("button", { name: "年度概览" })).toBeVisible()
})

test("calendar day detail persists a local daily note and exposes its attachment workspace", async ({ page }) => {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  await page.goto("/calendar")
  await page.locator(`[data-date="${date}"]`).first().click()
  await expect(page.getByRole("heading", { name: date })).toBeVisible()
  await page.getByLabel("生活记录").fill("E2E family day note")
  await page.getByRole("button", { name: "保存备注" }).click()
  await expect(page.getByText("每日备注已保存")).toBeVisible()
  await expect(page.getByRole("heading", { name: "附件" })).toBeVisible()
  await expect(page.getByText("桌面应用功能")).toBeVisible()
  if (process.env.CAPTURE_DAILY_NOTE_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAPTURE_DAILY_NOTE_SCREENSHOT, fullPage: false })
  }

  await page.reload()
  await page.locator(`[data-date="${date}"]`).first().click()
  await expect(page.getByLabel("生活记录")).toHaveValue("E2E family day note")
  await page.getByRole("button", { name: "删除备注" }).click()
  await page.getByRole("button", { name: "确认删除" }).click()
  await expect(page.getByText("每日备注已删除")).toBeVisible()
  await expect(page.getByLabel("生活记录")).toHaveValue("")
})
