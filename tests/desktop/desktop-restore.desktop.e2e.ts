import path from "node:path"

import { $, browser, expect } from "@wdio/globals"

describe("HomeLedger restore after a real desktop restart", () => {
  it("atomically restores the staged database without retaining later records", async () => {
    await (await $("a=收支记录")).click()
    const search = await $("input[aria-label='搜索商家、备注、分类、成员或地点']")
    await search.setValue("Desktop E2E Before Backup")
    await expect(text("Desktop E2E Before Backup")).toBeDisplayed()
    await search.setValue("Desktop E2E After Backup")
    await browser.waitUntil(async () => !(await text("Desktop E2E After Backup").isExisting()), {
      timeout: 15_000,
      timeoutMsg: "record created after the backup still exists after restore",
    })
    await search.setValue("Desktop E2E Grocery")
    await expect(text("Desktop E2E Grocery")).toBeDisplayed()
    await browser.saveScreenshot(path.resolve("artifacts/desktop-e2e/screenshots/restore-after-restart.png"))
  })
})

function text(value: string) {
  return $(`//*[contains(normalize-space(.), ${xpathLiteral(value)})]`)
}

function xpathLiteral(value: string) {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`
}
