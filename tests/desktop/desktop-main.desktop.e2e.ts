import path from "node:path"

import { $, browser, expect } from "@wdio/globals"

const screenshots = path.resolve("artifacts/desktop-e2e/screenshots")

type TauriApi = {
  core: { invoke: (command: string, args?: unknown) => Promise<unknown> }
}

type TauriBrowser = WebdriverIO.Browser & {
  tauri: {
    execute: <T>(script: (tauri: TauriApi, ...args: never[]) => T | Promise<T>, ...args: unknown[]) => Promise<T>
    restoreAllMocks: (commandPrefix?: string) => Promise<void>
  }
}

const tauriBrowser = () => browser as TauriBrowser

type ReminderDeliveryRecord = {
  id: string
  recurringItemName: string
  occurrenceKey: string
  status: "pending" | "delivered" | "dismissed"
}

describe("HomeLedger real Tauri desktop flows", () => {
  afterEach(async () => {
    await tauriBrowser().tauri.restoreAllMocks()
  })

  it("imports CSV through the desktop UI and real local database", async () => {
    const fixture = path.resolve("tests/fixtures/desktop-import.csv")

    await link("收支记录").click()
    await link("导入 CSV").click()
    await installCsvFilePickerHook(fixture)
    await button("选择 CSV").click()
    await browser.waitUntil(async () => (await csvFilePickerCallCount()) === 1, {
      timeout: 10_000,
      timeoutMsg: "CSV choose button did not invoke the desktop E2E file picker hook",
    })
    await expect(text("desktop-import.csv")).toBeDisplayed()
    await button("检查映射与重复记录").click()
    await expect(text("2 行可导入")).toBeDisplayed()
    await labelContaining("我已检查字段映射").click()
    await button("确认并导入").click()
    await expect(text("导入完成")).toBeDisplayed()
    await browser.saveScreenshot(path.join(screenshots, "csv-import-complete.png"))
    await link("查看收支记录").click()
    await expect(text("Desktop E2E Grocery")).toBeDisplayed()
    await expect(text("Desktop E2E Refund")).toBeDisplayed()
  })

  it("requests real notification permission and delivers a recurring reminder", async () => {
    const today = new Date().toISOString().slice(0, 10)
    await invoke("save_recurring_transaction", {
      id: null,
      name: "Desktop E2E Reminder",
      frequency: "monthly",
      interval: 1,
      customRrule: null,
      startDate: today,
      endDate: null,
      occurrenceCount: 1,
      timezoneId: "America/Toronto",
      advanceNoticeDays: 0,
      materializeDaysAhead: 0,
      isActive: true,
      template: {
        transactionType: "expense",
        amountMinor: 2500,
        currencyCode: "CAD",
        categoryId: "10000000-0000-7000-8000-000000000201",
        paymentMethodId: "20000000-0000-7000-8000-000000000001",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant: "Desktop E2E Rent",
        note: null,
      },
    })
    await invoke("materialize_recurring_transactions", { asOfDate: today })
    await link("日历").click()
    await expect(text("Desktop E2E Reminder")).toBeDisplayed()
    const reminder = await findReminderDelivery("Desktop E2E Reminder")
    const notification = await requestPermissionAndSendNotification(reminder)
    if (!notification.granted) {
      const stillPending = await findReminderDelivery("Desktop E2E Reminder")
      if (stillPending.status !== "pending") {
        throw new Error(`notification permission was ${notification.permission}, but reminder status changed`)
      }
      await browser.saveScreenshot(path.join(screenshots, "notification-permission-denied.png"))
      return
    }
    await browser.waitUntil(
      async () => {
        const updated = await tryFindReminderDelivery("Desktop E2E Reminder")
        return updated === null || updated.status === "delivered"
      },
      {
        timeout: 15_000,
        timeoutMsg: "reminder was not marked delivered after the notification call",
      },
    )
    await browser.saveScreenshot(path.join(screenshots, "notification-delivered.png"))
  })

  it("stages a verified backup for an actual restart-boundary restore", async () => {
    await createTransaction("Desktop E2E Before Backup", "34.56")
    await link("备份与恢复").click()
    await button("创建完整备份").click()
    await expect(text("manual")).toBeDisplayed()
    await button("验证").click()
    await expect(text("verified")).toBeDisplayed()

    await createTransaction("Desktop E2E After Backup", "78.90")
    await link("备份与恢复").click()
    const restoreButtons = await buttons("恢复")
    await restoreButtons[0]!.click()
    await inputAfterLabelText("输入 RESTORE").setValue("RESTORE")
    await button("创建恢复点并暂存恢复").click()
    await expect(text("恢复已安全暂存")).toBeDisplayed()
    await browser.saveScreenshot(path.join(screenshots, "restore-staged.png"))
  })
})

async function invoke(command: string, input: unknown) {
  return tauriBrowser().tauri.execute(
    (tauri, commandName, commandInput) => {
      return tauri.core.invoke(commandName as string, { input: commandInput })
    },
    command,
    input,
  )
}

async function installCsvFilePickerHook(fixture: string) {
  await browser.execute((fixturePath) => {
    const win = window as typeof window & {
      __HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__?: number
      __HOME_LEDGER_DESKTOP_E2E_OPEN_FILE__?: () => string
    }
    win.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__ = 0
    win.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE__ = () => {
      win.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__ = (win.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__ ?? 0) + 1
      return fixturePath
    }
  }, fixture)
}

async function csvFilePickerCallCount() {
  return browser.execute(() => {
    return (
      (
        window as typeof window & {
          __HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__?: number
        }
      ).__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE_CALLS__ ?? 0
    )
  })
}

async function findReminderDelivery(name: string) {
  const reminder = await tryFindReminderDelivery(name)
  if (!reminder) throw new Error(`reminder delivery not found: ${name}`)
  return reminder
}

async function tryFindReminderDelivery(name: string) {
  const now = new Date()
  const deliveries = (await invoke("list_reminder_deliveries", {
    rangeStartUtc: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    rangeEndUtc: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  })) as ReminderDeliveryRecord[]
  return deliveries.find((item) => item.recurringItemName === name) ?? null
}

async function requestPermissionAndSendNotification(reminder: ReminderDeliveryRecord) {
  return tauriBrowser().tauri.execute(
    async (tauri, title, body, id) => {
      const permission = (await tauri.core.invoke("plugin:notification|request_permission")) as NotificationPermission
      if (permission !== "granted") {
        return { granted: false, permission }
      }
      await tauri.core.invoke("plugin:notification|notify", {
        options: { title, body },
      })
      await tauri.core.invoke("mark_reminder_delivered", { input: { id } })
      return { granted: true, permission }
    },
    reminder.recurringItemName,
    `Occurrence ${reminder.occurrenceKey}`,
    reminder.id,
  ) as Promise<{ granted: boolean; permission: NotificationPermission }>
}

async function createTransaction(merchant: string, amount: string) {
  await link("收支记录").click()
  await button("添加记录").click()
  await $("#transaction-amountText").setValue(amount)
  await $("#transaction-merchant").setValue(merchant)
  await button("保存记录").click()
  await expect(text(merchant)).toBeDisplayed()
}

function text(value: string) {
  return $(`//*[contains(normalize-space(.), ${xpathLiteral(value)})]`)
}

function labelContaining(value: string) {
  return $(`//label[contains(normalize-space(.), ${xpathLiteral(value)})]`)
}

function inputAfterLabelText(value: string) {
  return $(`//*[contains(normalize-space(.), ${xpathLiteral(value)})]/following::input[1]`)
}

function link(value: string) {
  return $(`//a[normalize-space(.)=${xpathLiteral(value)} or contains(normalize-space(.), ${xpathLiteral(value)})]`)
}

function button(value: string) {
  return $(
    `//button[normalize-space(.)=${xpathLiteral(value)} or contains(normalize-space(.), ${xpathLiteral(value)})]`,
  )
}

function buttons(value: string) {
  return $$(
    `//button[normalize-space(.)=${xpathLiteral(value)} or contains(normalize-space(.), ${xpathLiteral(value)})]`,
  )
}

function xpathLiteral(value: string) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`
}
