import { z } from "zod"

export const transactionTypeSchema = z.enum(["income", "expense", "transfer"])
export const transactionStatusSchema = z.enum(["planned", "pending", "completed", "cancelled"])
export const transactionSortFieldSchema = z.enum(["transaction_date", "amount", "merchant", "created_at"])
export const sortDirectionSchema = z.enum(["asc", "desc"])

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryType: z.enum(["income", "expense"]),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isActive: z.boolean(),
})

export const paymentMethodSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  methodType: z.enum(["cash", "debit_card", "credit_card", "chequing", "savings", "other"]),
  institution: z.string().nullable(),
  lastFour: z.string().nullable(),
  defaultCurrencyCode: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isActive: z.boolean(),
})

export const householdMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  relationship: z.string().nullable(),
  avatarRelativePath: z.string().nullable(),
  color: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
})

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  countryCode: z.string().nullable(),
  postalCode: z.string().nullable(),
  isFavorite: z.boolean(),
  isActive: z.boolean(),
})

export const transactionReferenceDataSchema = z.object({
  categories: z.array(categorySchema),
  paymentMethods: z.array(paymentMethodSchema),
  householdMembers: z.array(householdMemberSchema).default([]),
  locations: z.array(locationSchema).default([]),
})

export const saveCategoryInputSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(100),
  categoryType: z.enum(["income", "expense"]),
  parentId: z.string().min(1).nullable(),
  icon: z.string().trim().nullable(),
  color: z.string().trim().nullable(),
  isActive: z.boolean(),
})

export const savePaymentMethodInputSchema = z.object({
  id: z.string().min(1).nullable(),
  displayName: z.string().trim().min(1).max(100),
  methodType: paymentMethodSchema.shape.methodType,
  institution: z.string().trim().nullable(),
  lastFour: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  defaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
  icon: z.string().trim().nullable(),
  color: z.string().trim().nullable(),
  isActive: z.boolean(),
})

export const saveHouseholdMemberInputSchema = z
  .object({
    id: z.string().min(1).nullable(),
    displayName: z.string().trim().min(1).max(100),
    relationship: z.string().trim().max(100).nullable(),
    color: z.string().trim().nullable(),
    isDefault: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((value) => !value.isDefault || value.isActive, {
    path: ["isActive"],
    message: "默认成员必须保持启用",
  })

export const saveLocationInputSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(160),
  addressLine: z.string().trim().nullable(),
  city: z.string().trim().nullable(),
  province: z.string().trim().nullable(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  postalCode: z.string().trim().nullable(),
  isFavorite: z.boolean(),
  isActive: z.boolean(),
})

export const createTransactionInputSchema = z.object({
  transactionDate: z.string().date(),
  transactionType: transactionTypeSchema,
  status: transactionStatusSchema,
  amountMinor: z.number().int().positive().safe(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  categoryId: z.string().nullable(),
  paymentMethodId: z.string().nullable(),
  transferToPaymentMethodId: z.string().nullable(),
  transferToAmountMinor: z.number().int().positive().safe().nullable(),
  transferToCurrencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  householdMemberId: z.string().nullable(),
  locationId: z.string().nullable(),
  merchant: z.string().max(200).nullable(),
  note: z.string().max(4000).nullable(),
})

export const updateTransactionInputSchema = createTransactionInputSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
})

export const transactionVersionInputSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
})

export const transactionMutationResultSchema = transactionVersionInputSchema
export const batchTransactionItemsInputSchema = z.object({
  items: z.array(transactionVersionInputSchema).min(1).max(500),
})
export const batchCategoryUpdateInputSchema = batchTransactionItemsInputSchema.extend({
  categoryId: z.string().min(1).nullable(),
})
export const batchTransactionMutationResultSchema = z.object({
  items: z.array(transactionMutationResultSchema),
})
const nullableIdPatchSchema = z.object({ value: z.string().min(1).nullable() }).strict()
export const batchTransactionPatchSchema = z
  .object({
    category: nullableIdPatchSchema.optional(),
    paymentMethod: nullableIdPatchSchema.optional(),
    householdMember: nullableIdPatchSchema.optional(),
    status: transactionStatusSchema.optional(),
    taxTag: z
      .object({
        taxTagId: z.string().min(1),
        selected: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.category !== undefined ||
      patch.paymentMethod !== undefined ||
      patch.householdMember !== undefined ||
      patch.status !== undefined ||
      patch.taxTag !== undefined,
    "请至少选择一个需要批量修改的字段",
  )
export const batchEditTransactionsInputSchema = batchTransactionItemsInputSchema.extend({
  patch: batchTransactionPatchSchema,
})
export const batchTransactionConflictSchema = z.object({
  id: z.string(),
  expectedVersion: z.number().int().positive(),
  actualVersion: z.number().int().positive().nullable(),
  code: z.string(),
  message: z.string(),
})
export const batchEditTransactionsResultSchema = z.object({
  operationId: z.string().min(1),
  items: z.array(transactionMutationResultSchema),
  conflicts: z.array(batchTransactionConflictSchema),
})
export const undoBatchEditInputSchema = z.object({ operationId: z.string().min(1) }).strict()

export const transactionTemplateDataSchema = createTransactionInputSchema.omit({
  transactionDate: true,
  householdMemberId: true,
  locationId: true,
})

export const saveTransactionTemplateInputSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(120),
  data: transactionTemplateDataSchema,
  isActive: z.boolean(),
})

export const transactionTemplateIdInputSchema = z.object({ id: z.string().min(1) })

export const transactionTemplateRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: transactionTemplateDataSchema,
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const transactionSavedFilterDataSchema = z
  .object({
    search: z.string().max(200),
    transactionType: transactionTypeSchema.nullable(),
    status: transactionStatusSchema.nullable(),
    dateFrom: z.string().date().nullable(),
    dateTo: z.string().date().nullable(),
    amountMinMinor: z.number().int().nonnegative().safe().nullable(),
    amountMaxMinor: z.number().int().nonnegative().safe().nullable(),
    categoryId: z.string().min(1).nullable(),
    paymentMethodId: z.string().min(1).nullable(),
    householdMemberId: z.string().min(1).nullable(),
    locationId: z.string().min(1).nullable(),
    sortBy: transactionSortFieldSchema,
    sortDirection: sortDirectionSchema,
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({ code: "custom", path: ["dateTo"], message: "结束日期不能早于开始日期" })
    }
    if (value.amountMinMinor !== null && value.amountMaxMinor !== null && value.amountMinMinor > value.amountMaxMinor) {
      context.addIssue({ code: "custom", path: ["amountMaxMinor"], message: "最高金额不能低于最低金额" })
    }
  })

export const saveTransactionFilterInputSchema = z.object({
  id: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(120),
  data: transactionSavedFilterDataSchema,
  isPinned: z.boolean(),
})

export const transactionFilterIdInputSchema = z.object({ id: z.string().min(1) })

export const transactionSavedFilterRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: transactionSavedFilterDataSchema,
  isPinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const transactionSuggestionInputSchema = z.object({
  merchant: z.string().trim().min(2).max(200),
  transactionType: transactionTypeSchema,
})

export const transactionSuggestionSchema = z.object({
  matchedCount: z.number().int().nonnegative(),
  categoryId: z.string().nullable(),
  paymentMethodId: z.string().nullable(),
  householdMemberId: z.string().nullable(),
  locationId: z.string().nullable(),
  amountMinor: z.number().int().positive().safe().nullable(),
  note: z.string().nullable(),
})

export const transactionRecordSchema = z.object({
  id: z.string(),
  transactionDate: z.string(),
  transactionType: transactionTypeSchema,
  status: transactionStatusSchema,
  amountMinor: z.number().int().safe(),
  currencyCode: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  paymentMethodId: z.string().nullable(),
  paymentMethodName: z.string().nullable(),
  transferToPaymentMethodId: z.string().nullable(),
  transferToPaymentMethodName: z.string().nullable(),
  transferToAmountMinor: z.number().int().safe().nullable(),
  transferToCurrencyCode: z.string().nullable(),
  householdMemberId: z.string().nullable(),
  householdMemberName: z.string().nullable().default(null),
  locationId: z.string().nullable().default(null),
  locationName: z.string().nullable().default(null),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  hasPossibleTaxHint: z.boolean(),
})

export const transactionPageSchema = z.object({
  records: z.array(transactionRecordSchema),
  total: z.number().int().nonnegative(),
})

export const listTransactionsInputSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    search: z.string().optional(),
    transactionType: transactionTypeSchema.optional(),
    status: transactionStatusSchema.optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    amountMinMinor: z.number().int().nonnegative().safe().optional(),
    amountMaxMinor: z.number().int().nonnegative().safe().optional(),
    categoryId: z.string().min(1).optional(),
    paymentMethodId: z.string().min(1).optional(),
    householdMemberId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    hasAttachment: z.boolean().optional(),
    isLinkedToEvent: z.boolean().optional(),
    isPossibleTaxCandidate: z.boolean().optional(),
    isRecurring: z.boolean().optional(),
    isUncategorized: z.boolean().optional(),
    sortBy: transactionSortFieldSchema.optional(),
    sortDirection: sortDirectionSchema.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({ code: "custom", path: ["dateTo"], message: "结束日期不能早于开始日期" })
    }
    if (
      value.amountMinMinor !== undefined &&
      value.amountMaxMinor !== undefined &&
      value.amountMinMinor > value.amountMaxMinor
    ) {
      context.addIssue({ code: "custom", path: ["amountMaxMinor"], message: "最大金额不能小于最小金额" })
    }
  })

export type TransactionType = z.infer<typeof transactionTypeSchema>
export type TransactionStatus = z.infer<typeof transactionStatusSchema>
export type TransactionSortField = z.infer<typeof transactionSortFieldSchema>
export type SortDirection = z.infer<typeof sortDirectionSchema>
export type Category = z.infer<typeof categorySchema>
export type PaymentMethod = z.infer<typeof paymentMethodSchema>
export type HouseholdMember = z.infer<typeof householdMemberSchema>
export type Location = z.infer<typeof locationSchema>
export type TransactionReferenceData = z.infer<typeof transactionReferenceDataSchema>
export type SaveCategoryInput = z.infer<typeof saveCategoryInputSchema>
export type SavePaymentMethodInput = z.infer<typeof savePaymentMethodInputSchema>
export type SaveHouseholdMemberInput = z.infer<typeof saveHouseholdMemberInputSchema>
export type SaveLocationInput = z.infer<typeof saveLocationInputSchema>
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>
export type TransactionVersionInput = z.infer<typeof transactionVersionInputSchema>
export type TransactionMutationResult = z.infer<typeof transactionMutationResultSchema>
export type BatchTransactionItemsInput = z.infer<typeof batchTransactionItemsInputSchema>
export type BatchCategoryUpdateInput = z.infer<typeof batchCategoryUpdateInputSchema>
export type BatchTransactionMutationResult = z.infer<typeof batchTransactionMutationResultSchema>
export type BatchTransactionPatch = z.infer<typeof batchTransactionPatchSchema>
export type BatchEditTransactionsInput = z.infer<typeof batchEditTransactionsInputSchema>
export type BatchTransactionConflict = z.infer<typeof batchTransactionConflictSchema>
export type BatchEditTransactionsResult = z.infer<typeof batchEditTransactionsResultSchema>
export type UndoBatchEditInput = z.infer<typeof undoBatchEditInputSchema>
export type TransactionTemplateData = z.infer<typeof transactionTemplateDataSchema>
export type SaveTransactionTemplateInput = z.infer<typeof saveTransactionTemplateInputSchema>
export type TransactionTemplateRecord = z.infer<typeof transactionTemplateRecordSchema>
export type TransactionSavedFilterData = z.infer<typeof transactionSavedFilterDataSchema>
export type SaveTransactionFilterInput = z.infer<typeof saveTransactionFilterInputSchema>
export type TransactionSavedFilterRecord = z.infer<typeof transactionSavedFilterRecordSchema>
export type TransactionSuggestionInput = z.infer<typeof transactionSuggestionInputSchema>
export type TransactionSuggestion = z.infer<typeof transactionSuggestionSchema>
export type TransactionRecord = z.infer<typeof transactionRecordSchema>
export type TransactionPage = z.infer<typeof transactionPageSchema>
export type ListTransactionsInput = z.infer<typeof listTransactionsInputSchema>

const browserStorageKey = "home-ledger.browser-transactions"
const browserDeletedStorageKey = "home-ledger.browser-deleted-transactions"
const browserReferenceStorageKey = "home-ledger.browser-reference-data"
const browserTemplateStorageKey = "home-ledger.browser-transaction-templates"
const browserFilterStorageKey = "home-ledger.browser-transaction-filters"

export const browserReferenceData: TransactionReferenceData = {
  categories: [
    ["food", "饮食", "expense", null, null],
    ["food-grocery", "超市", "expense", "food", "饮食"],
    ["food-restaurant", "餐厅", "expense", "food", "饮食"],
    ["housing", "住房", "expense", null, null],
    ["housing-rent", "房租", "expense", "housing", "住房"],
    ["education", "教育", "expense", null, null],
    ["transport", "交通", "expense", null, null],
    ["shopping", "购物", "expense", null, null],
    ["medical", "医疗", "expense", null, null],
    ["travel", "旅行", "expense", null, null],
    ["other-expense", "其他", "expense", null, null],
    ["salary", "工资", "income", null, null],
    ["bonus", "奖金", "income", null, null],
    ["refund", "退款", "income", null, null],
    ["other-income", "其他收入", "income", null, null],
  ].map(([id, name, categoryType, parentId, parentName]) => ({
    id: id as string,
    name: name as string,
    categoryType: categoryType as "income" | "expense",
    parentId: parentId as string | null,
    parentName: parentName as string | null,
    icon: null,
    color: null,
    isActive: true,
  })),
  paymentMethods: [
    {
      id: "cash",
      displayName: "现金",
      methodType: "cash",
      institution: null,
      lastFour: null,
      defaultCurrencyCode: "CAD",
      icon: "banknote",
      color: null,
      isActive: true,
    },
    {
      id: "demo-credit",
      displayName: "示例信用卡 5678",
      methodType: "credit_card",
      institution: "示例银行",
      lastFour: "5678",
      defaultCurrencyCode: "CAD",
      icon: "credit-card",
      color: null,
      isActive: true,
    },
  ],
  householdMembers: [
    {
      id: "browser-default-member",
      displayName: "我",
      relationship: "self",
      avatarRelativePath: null,
      color: "#0F766E",
      isDefault: true,
      isActive: true,
    },
  ],
  locations: [],
}

export function readBrowserReferenceData(): TransactionReferenceData {
  const stored = window.localStorage.getItem(browserReferenceStorageKey)
  if (!stored) return browserReferenceData
  try {
    const parsed = transactionReferenceDataSchema.safeParse(JSON.parse(stored) as unknown)
    if (!parsed.success) return browserReferenceData
    return {
      ...parsed.data,
      householdMembers: parsed.data.householdMembers.length
        ? parsed.data.householdMembers
        : browserReferenceData.householdMembers,
    }
  } catch {
    return browserReferenceData
  }
}

function writeBrowserReferenceData(value: TransactionReferenceData) {
  window.localStorage.setItem(browserReferenceStorageKey, JSON.stringify(value))
}

export function saveBrowserCategory(input: SaveCategoryInput): Category {
  const validated = saveCategoryInputSchema.parse(input)
  const data = readBrowserReferenceData()
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    data.categories.some(
      (item) =>
        item.id !== id &&
        item.categoryType === validated.categoryType &&
        item.parentId === validated.parentId &&
        item.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase(),
    )
  ) {
    throw new Error("同一层级已经存在同名分类")
  }
  const parent = data.categories.find((item) => item.id === validated.parentId)
  if (parent && (parent.parentId || parent.categoryType !== validated.categoryType)) {
    throw new Error("父分类无效或类型不一致")
  }
  const category: Category = {
    id,
    name: validated.name,
    categoryType: validated.categoryType,
    parentId: validated.parentId,
    parentName: parent?.name ?? null,
    icon: validated.icon || null,
    color: validated.color || null,
    isActive: validated.isActive,
  }
  const remainingCategories = data.categories
    .filter((item) => item.id !== id)
    .map((item) => (item.parentId === id ? { ...item, parentName: category.name } : item))
  writeBrowserReferenceData({
    ...data,
    categories: [category, ...remainingCategories],
  })
  writeBrowserTransactions(
    readBrowserTransactions().map((record) =>
      record.categoryId === id ? { ...record, categoryName: category.name } : record,
    ),
  )
  writeBrowserDeletedTransactions(
    readBrowserDeletedTransactions().map((record) =>
      record.categoryId === id ? { ...record, categoryName: category.name } : record,
    ),
  )
  return category
}

export function saveBrowserPaymentMethod(input: SavePaymentMethodInput): PaymentMethod {
  const validated = savePaymentMethodInputSchema.parse(input)
  const data = readBrowserReferenceData()
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    data.paymentMethods.some(
      (item) => item.id !== id && item.displayName.toLocaleLowerCase() === validated.displayName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("已经存在同名支付方式")
  }
  const method: PaymentMethod = {
    id,
    displayName: validated.displayName,
    methodType: validated.methodType,
    institution: validated.institution || null,
    lastFour: validated.lastFour,
    defaultCurrencyCode: validated.defaultCurrencyCode,
    icon: validated.icon || null,
    color: validated.color || null,
    isActive: validated.isActive,
  }
  writeBrowserReferenceData({
    ...data,
    paymentMethods: [method, ...data.paymentMethods.filter((item) => item.id !== id)],
  })
  const updateMethodNames = (record: TransactionRecord): TransactionRecord => ({
    ...record,
    paymentMethodName: record.paymentMethodId === id ? method.displayName : record.paymentMethodName,
    transferToPaymentMethodName:
      record.transferToPaymentMethodId === id ? method.displayName : record.transferToPaymentMethodName,
  })
  writeBrowserTransactions(readBrowserTransactions().map(updateMethodNames))
  writeBrowserDeletedTransactions(readBrowserDeletedTransactions().map(updateMethodNames))
  return method
}

export function saveBrowserHouseholdMember(input: SaveHouseholdMemberInput): HouseholdMember {
  const validated = saveHouseholdMemberInputSchema.parse(input)
  const data = readBrowserReferenceData()
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    data.householdMembers.some(
      (member) =>
        member.id !== id && member.displayName.toLocaleLowerCase() === validated.displayName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("已经存在同名家庭成员")
  }
  const member: HouseholdMember = {
    id,
    displayName: validated.displayName,
    relationship: validated.relationship || null,
    avatarRelativePath: data.householdMembers.find((candidate) => candidate.id === id)?.avatarRelativePath ?? null,
    color: validated.color || null,
    isDefault: validated.isDefault,
    isActive: validated.isActive,
  }
  const members = [
    member,
    ...data.householdMembers
      .filter((candidate) => candidate.id !== id)
      .map((candidate) => (member.isDefault ? { ...candidate, isDefault: false } : candidate)),
  ]
  if (members.filter((candidate) => candidate.isDefault && candidate.isActive).length !== 1) {
    throw new Error("必须保留一个已启用的默认家庭成员")
  }
  writeBrowserReferenceData({ ...data, householdMembers: members })
  const updateMemberName = (record: TransactionRecord): TransactionRecord =>
    record.householdMemberId === id ? { ...record, householdMemberName: member.displayName } : record
  writeBrowserTransactions(readBrowserTransactions().map(updateMemberName))
  writeBrowserDeletedTransactions(readBrowserDeletedTransactions().map(updateMemberName))
  return member
}

export function saveBrowserLocation(input: SaveLocationInput): Location {
  const validated = saveLocationInputSchema.parse(input)
  const data = readBrowserReferenceData()
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    data.locations.some(
      (location) =>
        location.id !== id &&
        location.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase() &&
        (location.city ?? "").toLocaleLowerCase() === (validated.city ?? "").toLocaleLowerCase(),
    )
  ) {
    throw new Error("同一城市已经存在同名地点")
  }
  const location: Location = {
    id,
    name: validated.name,
    addressLine: validated.addressLine || null,
    city: validated.city || null,
    province: validated.province || null,
    countryCode: validated.countryCode,
    postalCode: validated.postalCode || null,
    isFavorite: validated.isFavorite,
    isActive: validated.isActive,
  }
  writeBrowserReferenceData({
    ...data,
    locations: [location, ...data.locations.filter((candidate) => candidate.id !== id)],
  })
  const updateLocationName = (record: TransactionRecord): TransactionRecord =>
    record.locationId === id ? { ...record, locationName: location.name } : record
  writeBrowserTransactions(readBrowserTransactions().map(updateLocationName))
  writeBrowserDeletedTransactions(readBrowserDeletedTransactions().map(updateLocationName))
  return location
}

export function listBrowserTransactionTemplates(includeInactive = false): TransactionTemplateRecord[] {
  const stored = window.localStorage.getItem(browserTemplateStorageKey)
  if (!stored) return []
  try {
    const parsed = z.array(transactionTemplateRecordSchema).safeParse(JSON.parse(stored) as unknown)
    if (!parsed.success) return []
    return parsed.data
      .filter((template) => includeInactive || template.isActive)
      .toSorted(
        (left, right) =>
          Number(right.isActive) - Number(left.isActive) ||
          right.usageCount - left.usageCount ||
          (right.lastUsedAt ?? right.createdAt).localeCompare(left.lastUsedAt ?? left.createdAt),
      )
  } catch {
    return []
  }
}

function writeBrowserTransactionTemplates(templates: TransactionTemplateRecord[]) {
  window.localStorage.setItem(browserTemplateStorageKey, JSON.stringify(templates))
}

export function saveBrowserTransactionTemplate(input: SaveTransactionTemplateInput): TransactionTemplateRecord {
  const validated = saveTransactionTemplateInputSchema.parse(input)
  const templates = listBrowserTransactionTemplates(true)
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    templates.some(
      (template) => template.id !== id && template.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase(),
    )
  ) {
    throw new Error("已经存在同名交易模板")
  }
  const existing = templates.find((template) => template.id === id)
  if (validated.id && !existing) throw new Error("交易模板不存在")
  const now = new Date().toISOString()
  const record: TransactionTemplateRecord = {
    id,
    name: validated.name,
    data: validated.data,
    usageCount: existing?.usageCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
    isActive: validated.isActive,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeBrowserTransactionTemplates([record, ...templates.filter((template) => template.id !== id)])
  return record
}

export function applyBrowserTransactionTemplate(id: string): TransactionTemplateRecord {
  const validated = transactionTemplateIdInputSchema.parse({ id })
  const templates = listBrowserTransactionTemplates(true)
  const template = templates.find((candidate) => candidate.id === validated.id && candidate.isActive)
  if (!template) throw new Error("交易模板不存在或已停用")
  const now = new Date().toISOString()
  const used = { ...template, usageCount: template.usageCount + 1, lastUsedAt: now, updatedAt: now }
  writeBrowserTransactionTemplates([used, ...templates.filter((candidate) => candidate.id !== used.id)])
  return used
}

export function listBrowserTransactionFilters(): TransactionSavedFilterRecord[] {
  const stored = window.localStorage.getItem(browserFilterStorageKey)
  if (!stored) return []
  try {
    const parsed = z.array(transactionSavedFilterRecordSchema).safeParse(JSON.parse(stored) as unknown)
    if (!parsed.success) return []
    return parsed.data.toSorted(
      (left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.localeCompare(left.updatedAt),
    )
  } catch {
    return []
  }
}

function writeBrowserTransactionFilters(filters: TransactionSavedFilterRecord[]) {
  window.localStorage.setItem(browserFilterStorageKey, JSON.stringify(filters))
}

export function saveBrowserTransactionFilter(input: SaveTransactionFilterInput): TransactionSavedFilterRecord {
  const validated = saveTransactionFilterInputSchema.parse(input)
  const filters = listBrowserTransactionFilters()
  const id = validated.id ?? window.crypto.randomUUID()
  if (
    filters.some((filter) => filter.id !== id && filter.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase())
  ) {
    throw new Error("已经存在同名筛选")
  }
  const existing = filters.find((filter) => filter.id === id)
  if (validated.id && !existing) throw new Error("筛选不存在")
  const now = new Date().toISOString()
  const record: TransactionSavedFilterRecord = {
    id,
    name: validated.name,
    data: validated.data,
    isPinned: validated.isPinned,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeBrowserTransactionFilters([record, ...filters.filter((filter) => filter.id !== id)])
  return record
}

export function deleteBrowserTransactionFilter(id: string) {
  const validated = transactionFilterIdInputSchema.parse({ id })
  const filters = listBrowserTransactionFilters()
  if (!filters.some((filter) => filter.id === validated.id)) throw new Error("筛选不存在")
  writeBrowserTransactionFilters(filters.filter((filter) => filter.id !== validated.id))
}

export function suggestBrowserTransaction(input: TransactionSuggestionInput): TransactionSuggestion {
  const validated = transactionSuggestionInputSchema.parse(input)
  const merchant = validated.merchant.toLocaleLowerCase()
  const matches = readBrowserTransactions().filter(
    (record) =>
      record.status === "completed" &&
      record.transactionType === validated.transactionType &&
      record.merchant?.toLocaleLowerCase() === merchant,
  )
  const references = readBrowserReferenceData()
  const activeCategories = new Set(references.categories.filter((item) => item.isActive).map((item) => item.id))
  const activeMethods = new Set(references.paymentMethods.filter((item) => item.isActive).map((item) => item.id))
  const activeMembers = new Set(references.householdMembers.filter((item) => item.isActive).map((item) => item.id))
  const activeLocations = new Set(references.locations.filter((item) => item.isActive).map((item) => item.id))
  const amount = mostFrequent(matches.map((record) => String(record.amountMinor)))
  return {
    matchedCount: matches.length,
    categoryId: mostFrequent(
      matches.map((record) => record.categoryId).filter((id): id is string => id !== null && activeCategories.has(id)),
    ),
    paymentMethodId: mostFrequent(
      matches
        .map((record) => record.paymentMethodId)
        .filter((id): id is string => id !== null && activeMethods.has(id)),
    ),
    householdMemberId: mostFrequent(
      matches
        .map((record) => record.householdMemberId)
        .filter((id): id is string => id !== null && activeMembers.has(id)),
    ),
    locationId: mostFrequent(
      matches.map((record) => record.locationId).filter((id): id is string => id !== null && activeLocations.has(id)),
    ),
    amountMinor: amount === null ? null : Number(amount),
    note: matches.find((record) => record.note?.trim())?.note ?? null,
  }
}

function mostFrequent(values: Array<string | null>): string | null {
  const counts = new Map<string, { count: number; firstIndex: number }>()
  values.forEach((value, index) => {
    if (value === null) return
    const existing = counts.get(value)
    counts.set(value, { count: (existing?.count ?? 0) + 1, firstIndex: existing?.firstIndex ?? index })
  })
  let best: { value: string; count: number; firstIndex: number } | null = null
  for (const [value, score] of counts) {
    if (!best || score.count > best.count || (score.count === best.count && score.firstIndex < best.firstIndex)) {
      best = { value, ...score }
    }
  }
  return best?.value ?? null
}

export function readBrowserTransactions(): TransactionRecord[] {
  const stored = window.localStorage.getItem(browserStorageKey)
  if (!stored) return []
  try {
    const parsed = z.array(transactionRecordSchema).safeParse(JSON.parse(stored) as unknown)
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function writeBrowserTransactions(records: TransactionRecord[]) {
  window.localStorage.setItem(browserStorageKey, JSON.stringify(records))
}

export function removeBrowserTransactionsByIds(ids: ReadonlySet<string>) {
  writeBrowserTransactions(readBrowserTransactions().filter((record) => !ids.has(record.id)))
  writeBrowserDeletedTransactions(readBrowserDeletedTransactions().filter((record) => !ids.has(record.id)))
}

function readBrowserDeletedTransactions(): TransactionRecord[] {
  const stored = window.localStorage.getItem(browserDeletedStorageKey)
  if (!stored) return []
  try {
    const parsed = z.array(transactionRecordSchema).safeParse(JSON.parse(stored) as unknown)
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeBrowserDeletedTransactions(records: TransactionRecord[]) {
  window.localStorage.setItem(browserDeletedStorageKey, JSON.stringify(records))
}

export function createBrowserTransaction(input: CreateTransactionInput): TransactionRecord {
  const validated = createTransactionInputSchema.parse(input)
  const record = buildBrowserRecord(validated)
  const records = readBrowserTransactions()
  writeBrowserTransactions([record, ...records])
  return record
}

export function updateBrowserTransaction(input: UpdateTransactionInput): TransactionRecord {
  const validated = updateTransactionInputSchema.parse(input)
  const records = readBrowserTransactions()
  const index = records.findIndex((record) => record.id === validated.id && record.version === validated.version)
  if (index === -1) throw new Error("这笔记录已被修改或删除，请刷新后重试。")
  const existing = records[index]
  const record = buildBrowserRecord(validated, existing)
  records[index] = record
  writeBrowserTransactions(records)
  return record
}

export function deleteBrowserTransaction(input: TransactionVersionInput): TransactionMutationResult {
  const validated = transactionVersionInputSchema.parse(input)
  const records = readBrowserTransactions()
  const index = records.findIndex((record) => record.id === validated.id && record.version === validated.version)
  if (index === -1) throw new Error("这笔记录已被修改或删除，请刷新后重试。")
  const [existing] = records.splice(index, 1)
  const deleted = { ...existing, version: existing.version + 1, updatedAt: new Date().toISOString() }
  writeBrowserTransactions(records)
  writeBrowserDeletedTransactions([
    deleted,
    ...readBrowserDeletedTransactions().filter((item) => item.id !== deleted.id),
  ])
  return { id: deleted.id, version: deleted.version }
}

export function restoreBrowserTransaction(input: TransactionVersionInput): TransactionRecord {
  const validated = transactionVersionInputSchema.parse(input)
  const deletedRecords = readBrowserDeletedTransactions()
  const index = deletedRecords.findIndex((record) => record.id === validated.id && record.version === validated.version)
  if (index === -1) throw new Error("这笔记录无法恢复，可能已经恢复或再次修改。")
  const [deleted] = deletedRecords.splice(index, 1)
  const restored = { ...deleted, version: deleted.version + 1, updatedAt: new Date().toISOString() }
  writeBrowserDeletedTransactions(deletedRecords)
  writeBrowserTransactions([restored, ...readBrowserTransactions().filter((item) => item.id !== restored.id)])
  return restored
}

export function batchUpdateBrowserTransactionCategory(input: BatchCategoryUpdateInput): BatchTransactionMutationResult {
  const validated = batchCategoryUpdateInputSchema.parse(input)
  assertUniqueBatchItems(validated.items)
  const records = readBrowserTransactions()
  const selected = validated.items.map((item) => {
    const record = records.find((candidate) => candidate.id === item.id && candidate.version === item.version)
    if (!record) throw new Error("批量分类失败：至少一笔记录已被修改或删除。")
    return record
  })
  const category = validated.categoryId
    ? readBrowserReferenceData().categories.find((candidate) => candidate.id === validated.categoryId)
    : null
  if (validated.categoryId && (!category || !category.isActive)) throw new Error("所选分类不存在或已停用")
  const resolvedCategory = category ?? null
  if (
    selected.some(
      (record) =>
        record.transactionType === "transfer" ||
        (resolvedCategory !== null && record.transactionType !== resolvedCategory.categoryType),
    )
  ) {
    throw new Error("所选分类与部分交易类型不一致")
  }
  const selectedIds = new Set(selected.map((record) => record.id))
  const taxHint =
    resolvedCategory !== null &&
    ["教育", "医疗", "车辆", "家庭办公", "慈善捐赠", "出租房相关"].includes(
      resolvedCategory.parentName ?? resolvedCategory.name,
    )
  const updated = records.map((record) =>
    selectedIds.has(record.id)
      ? {
          ...record,
          categoryId: resolvedCategory?.id ?? null,
          categoryName: resolvedCategory?.name ?? null,
          hasPossibleTaxHint: taxHint,
          version: record.version + 1,
          updatedAt: new Date().toISOString(),
        }
      : record,
  )
  writeBrowserTransactions(updated)
  return {
    items: selected.map((record) => ({ id: record.id, version: record.version + 1 })),
  }
}

export function batchDeleteBrowserTransactions(input: BatchTransactionItemsInput): BatchTransactionMutationResult {
  const validated = batchTransactionItemsInputSchema.parse(input)
  assertUniqueBatchItems(validated.items)
  const records = readBrowserTransactions()
  const selected = validated.items.map((item) => {
    const record = records.find((candidate) => candidate.id === item.id && candidate.version === item.version)
    if (!record) throw new Error("批量删除失败：至少一笔记录已被修改或删除。")
    return record
  })
  const selectedIds = new Set(selected.map((record) => record.id))
  const now = new Date().toISOString()
  const deleted = selected.map((record) => ({ ...record, version: record.version + 1, updatedAt: now }))
  writeBrowserTransactions(records.filter((record) => !selectedIds.has(record.id)))
  writeBrowserDeletedTransactions([
    ...deleted,
    ...readBrowserDeletedTransactions().filter((record) => !selectedIds.has(record.id)),
  ])
  return { items: deleted.map((record) => ({ id: record.id, version: record.version })) }
}

export function batchRestoreBrowserTransactions(input: BatchTransactionItemsInput): BatchTransactionMutationResult {
  const validated = batchTransactionItemsInputSchema.parse(input)
  assertUniqueBatchItems(validated.items)
  const deletedRecords = readBrowserDeletedTransactions()
  const selected = validated.items.map((item) => {
    const record = deletedRecords.find((candidate) => candidate.id === item.id && candidate.version === item.version)
    if (!record) throw new Error("批量恢复失败：至少一笔记录已恢复或再次修改。")
    return record
  })
  const selectedIds = new Set(selected.map((record) => record.id))
  const now = new Date().toISOString()
  const restored = selected.map((record) => ({ ...record, version: record.version + 1, updatedAt: now }))
  writeBrowserDeletedTransactions(deletedRecords.filter((record) => !selectedIds.has(record.id)))
  writeBrowserTransactions([...restored, ...readBrowserTransactions().filter((record) => !selectedIds.has(record.id))])
  return { items: restored.map((record) => ({ id: record.id, version: record.version })) }
}

function assertUniqueBatchItems(items: TransactionVersionInput[]) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("批量操作包含重复记录")
  }
}

function buildBrowserRecord(validated: CreateTransactionInput, existing?: TransactionRecord): TransactionRecord {
  const referenceData = readBrowserReferenceData()
  const category = referenceData.categories.find((item) => item.id === validated.categoryId)
  const source = referenceData.paymentMethods.find((item) => item.id === validated.paymentMethodId)
  const target = referenceData.paymentMethods.find((item) => item.id === validated.transferToPaymentMethodId)
  const householdMember = validated.householdMemberId
    ? referenceData.householdMembers.find((item) => item.id === validated.householdMemberId)
    : referenceData.householdMembers.find((item) => item.isDefault && item.isActive)
  const location = referenceData.locations.find((item) => item.id === validated.locationId)
  const now = new Date().toISOString()
  const record: TransactionRecord = {
    id: existing?.id ?? window.crypto.randomUUID(),
    transactionDate: validated.transactionDate,
    transactionType: validated.transactionType,
    status: validated.status,
    amountMinor: validated.amountMinor,
    currencyCode: validated.currencyCode,
    categoryId: validated.categoryId,
    categoryName: category?.name ?? null,
    paymentMethodId: validated.paymentMethodId,
    paymentMethodName: source?.displayName ?? null,
    transferToPaymentMethodId: validated.transferToPaymentMethodId,
    transferToPaymentMethodName: target?.displayName ?? null,
    transferToAmountMinor: validated.transferToAmountMinor,
    transferToCurrencyCode: validated.transferToCurrencyCode,
    householdMemberId: householdMember?.id ?? null,
    householdMemberName: householdMember?.displayName ?? null,
    locationId: location?.id ?? null,
    locationName: location?.name ?? null,
    merchant: validated.merchant?.trim() || null,
    note: validated.note?.trim() || null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    hasPossibleTaxHint:
      validated.transactionType === "expense" &&
      ["教育", "医疗", "车辆", "家庭办公", "慈善捐赠", "出租房相关"].includes(
        category?.parentName ?? category?.name ?? "",
      ),
  }
  return record
}

export function listBrowserTransactions(input: ListTransactionsInput): TransactionPage {
  const filters = listTransactionsInputSchema.parse(input)
  const normalizedSearch = filters.search?.trim().toLocaleLowerCase()
  const records = readBrowserTransactions()
    .filter((record) => !filters.id || record.id === filters.id)
    .filter((record) => !filters.transactionType || record.transactionType === filters.transactionType)
    .filter((record) => !filters.status || record.status === filters.status)
    .filter((record) => !filters.dateFrom || record.transactionDate >= filters.dateFrom)
    .filter((record) => !filters.dateTo || record.transactionDate <= filters.dateTo)
    .filter((record) => filters.amountMinMinor === undefined || record.amountMinor >= filters.amountMinMinor)
    .filter((record) => filters.amountMaxMinor === undefined || record.amountMinor <= filters.amountMaxMinor)
    .filter((record) => {
      if (!filters.categoryId) return true
      if (record.categoryId === filters.categoryId) return true
      return (
        readBrowserReferenceData().categories.find((category) => category.id === record.categoryId)?.parentId ===
        filters.categoryId
      )
    })
    .filter((record) => !filters.paymentMethodId || record.paymentMethodId === filters.paymentMethodId)
    .filter((record) => !filters.householdMemberId || record.householdMemberId === filters.householdMemberId)
    .filter((record) => !filters.locationId || record.locationId === filters.locationId)
    .filter(
      (record) =>
        filters.isPossibleTaxCandidate === undefined || record.hasPossibleTaxHint === filters.isPossibleTaxCandidate,
    )
    .filter(
      (record) =>
        filters.isUncategorized === undefined ||
        (record.categoryId === null && record.transactionType !== "transfer") === filters.isUncategorized,
    )
    .filter(() => filters.hasAttachment === undefined || filters.hasAttachment === false)
    .filter(() => filters.isLinkedToEvent === undefined || filters.isLinkedToEvent === false)
    .filter(() => filters.isRecurring === undefined || filters.isRecurring === false)
    .filter(
      (record) =>
        !normalizedSearch ||
        [
          record.merchant,
          record.note,
          record.categoryName,
          record.paymentMethodName,
          record.householdMemberName,
          record.locationName,
        ]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .toSorted((left, right) => compareBrowserTransactions(left, right, filters))
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? 100
  return { records: records.slice(offset, offset + limit), total: records.length }
}

function compareBrowserTransactions(left: TransactionRecord, right: TransactionRecord, filters: ListTransactionsInput) {
  const direction = filters.sortDirection === "asc" ? 1 : -1
  switch (filters.sortBy ?? "transaction_date") {
    case "amount":
      return (
        direction * (left.amountMinor - right.amountMinor) || right.transactionDate.localeCompare(left.transactionDate)
      )
    case "merchant":
      return (
        direction * (left.merchant ?? "").localeCompare(right.merchant ?? "") ||
        right.transactionDate.localeCompare(left.transactionDate)
      )
    case "created_at":
      return direction * left.createdAt.localeCompare(right.createdAt)
    case "transaction_date":
      return (
        direction * left.transactionDate.localeCompare(right.transactionDate) ||
        direction * left.createdAt.localeCompare(right.createdAt)
      )
  }
}
