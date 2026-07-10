import { describe, expect, it } from "vitest"

import { formatMinorAmount, minorAmountToInput, parseMoneyToMinor } from "@/lib/money"

describe("integer money helpers", () => {
  it("parses decimal text without floating point arithmetic", () => {
    expect(parseMoneyToMinor("12.30")).toBe(1230)
    expect(parseMoneyToMinor("1,234.5")).toBe(123450)
  })

  it("rejects excess precision", () => {
    expect(() => parseMoneyToMinor("1.001")).toThrow("最多支持 2 位小数")
  })

  it("formats exact minor units", () => {
    expect(formatMinorAmount(123450, "CAD", "en-CA")).toBe("CAD 1,234.50")
    expect(minorAmountToInput(123450)).toBe("1234.50")
  })
})
