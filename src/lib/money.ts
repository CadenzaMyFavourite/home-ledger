export function parseMoneyToMinor(value: string, fractionDigits = 2): number {
  const normalized = value.trim().replaceAll(",", "")
  const pattern = new RegExp(`^(?:0|[1-9]\\d*)(?:\\.(\\d{0,${fractionDigits}}))?$`)
  const match = pattern.exec(normalized)
  if (!match) throw new Error(`金额最多支持 ${fractionDigits} 位小数`)

  const fraction = (match[1] ?? "").padEnd(fractionDigits, "0")
  const factor = 10n ** BigInt(fractionDigits)
  const minor = BigInt(normalized.split(".")[0]) * factor + BigInt(fraction || "0")
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("金额必须大于零且不能超过系统上限")
  }
  return Number(minor)
}

export function formatMinorAmount(amountMinor: number, currencyCode: string, locale = "zh-CN", fractionDigits = 2) {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("金额必须是安全整数")
  const negative = amountMinor < 0
  const absolute = BigInt(Math.abs(amountMinor))
  const factor = 10n ** BigInt(fractionDigits)
  const whole = absolute / factor
  const fraction = (absolute % factor).toString().padStart(fractionDigits, "0")
  const grouped = whole.toLocaleString(locale)
  return `${negative ? "-" : ""}${currencyCode} ${grouped}.${fraction}`
}

export function minorAmountToInput(amountMinor: number, fractionDigits = 2) {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("金额必须是安全整数")
  const negative = amountMinor < 0
  const absolute = BigInt(Math.abs(amountMinor))
  const factor = 10n ** BigInt(fractionDigits)
  const whole = absolute / factor
  const fraction = (absolute % factor).toString().padStart(fractionDigits, "0")
  return `${negative ? "-" : ""}${whole}.${fraction}`
}
