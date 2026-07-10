import { z } from "zod"

import {
  batchEditTransactionsInputSchema,
  batchEditTransactionsResultSchema,
  readBrowserReferenceData,
  readBrowserTransactions,
  transactionRecordSchema,
  undoBatchEditInputSchema,
  writeBrowserTransactions,
  type BatchEditTransactionsInput,
  type BatchEditTransactionsResult,
  type BatchTransactionConflict,
  type TransactionRecord,
  type UndoBatchEditInput,
} from "@/lib/transaction-data"
import {
  getBrowserAcceptedTaxTag,
  isBrowserTaxTagActive,
  writeBrowserAcceptedTaxTag,
  type BrowserAcceptedTaxTag,
} from "@/lib/tax-data"

const operationsKey = "home-ledger:batch-edit-operations:v1"
const operationSchema = z.object({
  operationId: z.string(),
  undone: z.boolean(),
  items: z.array(
    z.object({
      before: transactionRecordSchema,
      taxTagId: z.string().nullable(),
      taxTagBefore: z
        .object({
          transactionId: z.string(),
          taxTagId: z.string(),
          source: z.enum(["user", "accepted_ai", "import"]),
          confirmedAt: z.string(),
        })
        .nullable(),
    }),
  ),
})
type BrowserBatchOperation = z.infer<typeof operationSchema>

export function batchEditBrowserTransactions(input: BatchEditTransactionsInput): BatchEditTransactionsResult {
  const validated = batchEditTransactionsInputSchema.parse(input)
  if (new Set(validated.items.map((item) => item.id)).size !== validated.items.length) {
    throw new Error("批量操作包含重复记录")
  }
  const references = readBrowserReferenceData()
  const category = validated.patch.category?.value
    ? references.categories.find((item) => item.id === validated.patch.category?.value && item.isActive)
    : null
  if (validated.patch.category?.value && !category) throw new Error("所选分类不存在或已停用")
  const paymentMethod = validated.patch.paymentMethod?.value
    ? references.paymentMethods.find((item) => item.id === validated.patch.paymentMethod?.value && item.isActive)
    : null
  if (validated.patch.paymentMethod?.value && !paymentMethod) throw new Error("所选支付方式不存在或已停用")
  const member = validated.patch.householdMember?.value
    ? references.householdMembers.find((item) => item.id === validated.patch.householdMember?.value && item.isActive)
    : null
  if (validated.patch.householdMember?.value && !member) throw new Error("所选家庭成员不存在或已停用")
  if (validated.patch.taxTag && !isBrowserTaxTagActive(validated.patch.taxTag.taxTagId)) {
    throw new Error("所选税务标签不存在或已停用")
  }

  const records = readBrowserTransactions()
  const recordById = new Map(records.map((record) => [record.id, record]))
  const conflicts: BatchTransactionConflict[] = []
  const before: Array<{
    before: TransactionRecord
    taxTagId: string | null
    taxTagBefore: BrowserAcceptedTaxTag | null
  }> = []
  const updatedById = new Map<string, TransactionRecord>()
  const now = new Date().toISOString()

  for (const item of validated.items) {
    const record = recordById.get(item.id)
    const conflict = validateRecord(record, item.version, validated, category?.categoryType ?? null)
    if (conflict) {
      conflicts.push({ id: item.id, expectedVersion: item.version, ...conflict })
      continue
    }
    const existing = record!
    const taxTagBefore = validated.patch.taxTag
      ? getBrowserAcceptedTaxTag(existing.id, validated.patch.taxTag.taxTagId)
      : null
    before.push({
      before: existing,
      taxTagId: validated.patch.taxTag?.taxTagId ?? null,
      taxTagBefore,
    })
    const possibleTaxHint =
      category != null &&
      ["教育", "医疗", "车辆", "家庭办公", "慈善捐赠", "出租房相关"].includes(category.parentName ?? category.name)
    const updated: TransactionRecord = {
      ...existing,
      ...(validated.patch.category
        ? {
            categoryId: category?.id ?? null,
            categoryName: category?.name ?? null,
            hasPossibleTaxHint: possibleTaxHint,
          }
        : {}),
      ...(validated.patch.paymentMethod
        ? {
            paymentMethodId: paymentMethod?.id ?? null,
            paymentMethodName: paymentMethod?.displayName ?? null,
          }
        : {}),
      ...(validated.patch.householdMember
        ? {
            householdMemberId: member?.id ?? null,
            householdMemberName: member?.displayName ?? null,
          }
        : {}),
      ...(validated.patch.status ? { status: validated.patch.status } : {}),
      ...(validated.patch.taxTag?.selected && !validated.patch.taxTag.taxTagId.endsWith("212")
        ? { hasPossibleTaxHint: false }
        : {}),
      version: existing.version + 1,
      updatedAt: now,
    }
    updatedById.set(existing.id, updated)
  }

  writeBrowserTransactions(records.map((record) => updatedById.get(record.id) ?? record))
  if (validated.patch.taxTag) {
    for (const item of before) {
      writeBrowserAcceptedTaxTag(
        item.before.id,
        validated.patch.taxTag.taxTagId,
        validated.patch.taxTag.selected
          ? {
              transactionId: item.before.id,
              taxTagId: validated.patch.taxTag.taxTagId,
              source: "user",
              confirmedAt: now,
            }
          : null,
      )
    }
  }
  const operationId = window.crypto.randomUUID()
  if (before.length > 0) {
    writeOperations([{ operationId, undone: false, items: before }, ...readOperations()])
  }
  return batchEditTransactionsResultSchema.parse({
    operationId,
    items: before.map((item) => ({ id: item.before.id, version: item.before.version + 1 })),
    conflicts,
  })
}

export function undoBatchEditBrowserTransactions(input: UndoBatchEditInput): BatchEditTransactionsResult {
  const validated = undoBatchEditInputSchema.parse(input)
  const operations = readOperations()
  const operation = operations.find((item) => item.operationId === validated.operationId)
  if (!operation) throw new Error("批量编辑操作不存在")
  if (operation.undone) throw new Error("这次批量编辑已经撤销")
  const records = readBrowserTransactions()
  const byId = new Map(records.map((record) => [record.id, record]))
  const conflicts = operation.items.flatMap<BatchTransactionConflict>((item) => {
    const current = byId.get(item.before.id)
    return current?.version === item.before.version + 1
      ? []
      : [
          {
            id: item.before.id,
            expectedVersion: item.before.version + 1,
            actualVersion: current?.version ?? null,
            code: "undo_conflict",
            message: "批量编辑后这笔记录又发生了变化，未覆盖新数据",
          },
        ]
  })
  if (conflicts.length > 0) {
    return batchEditTransactionsResultSchema.parse({
      operationId: operation.operationId,
      items: [],
      conflicts,
    })
  }
  const now = new Date().toISOString()
  const restoredById = new Map(
    operation.items.map((item) => [
      item.before.id,
      { ...item.before, version: item.before.version + 2, updatedAt: now },
    ]),
  )
  writeBrowserTransactions(records.map((record) => restoredById.get(record.id) ?? record))
  for (const item of operation.items) {
    if (item.taxTagId) {
      writeBrowserAcceptedTaxTag(item.before.id, item.taxTagId, item.taxTagBefore)
    }
  }
  writeOperations(
    operations.map((item) => (item.operationId === operation.operationId ? { ...item, undone: true } : item)),
  )
  return batchEditTransactionsResultSchema.parse({
    operationId: operation.operationId,
    items: operation.items.map((item) => ({ id: item.before.id, version: item.before.version + 2 })),
    conflicts: [],
  })
}

function validateRecord(
  record: TransactionRecord | undefined,
  expectedVersion: number,
  input: BatchEditTransactionsInput,
  categoryType: "income" | "expense" | null,
): Omit<BatchTransactionConflict, "id" | "expectedVersion"> | null {
  if (!record) return { actualVersion: null, code: "not_found", message: "记录不存在或已删除" }
  if (record.version !== expectedVersion) {
    return {
      actualVersion: record.version,
      code: "version_conflict",
      message: "记录已被其他操作修改，请刷新后重试",
    }
  }
  if (
    input.patch.category &&
    (record.transactionType === "transfer" ||
      (input.patch.category.value !== null && categoryType !== record.transactionType))
  ) {
    return {
      actualVersion: record.version,
      code: "incompatible_category",
      message: record.transactionType === "transfer" ? "转账不能设置分类" : "所选分类与交易类型不一致",
    }
  }
  if (
    input.patch.paymentMethod &&
    record.transactionType === "transfer" &&
    (!input.patch.paymentMethod.value || input.patch.paymentMethod.value === record.transferToPaymentMethodId)
  ) {
    return {
      actualVersion: record.version,
      code: "invalid_transfer_account",
      message: "转账必须保留不同的转出和转入账户",
    }
  }
  if (input.patch.taxTag && record.transactionType === "transfer") {
    return {
      actualVersion: record.version,
      code: "transfer_tax_tag",
      message: "转账不能设置税务标签",
    }
  }
  return null
}

function readOperations(): BrowserBatchOperation[] {
  try {
    return z.array(operationSchema).parse(JSON.parse(localStorage.getItem(operationsKey) ?? "[]"))
  } catch {
    return []
  }
}

function writeOperations(operations: BrowserBatchOperation[]) {
  localStorage.setItem(operationsKey, JSON.stringify(operations.slice(0, 50)))
}
