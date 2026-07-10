import { beforeEach, describe, expect, it, vi } from "vitest"

import { commandGateway } from "@/lib/commands"
import { getBrowserAcceptedTaxTag } from "@/lib/tax-data"

describe("browser command gateway", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete window.__TAURI_INTERNALS__
    vi.unstubAllGlobals()
  })

  it("keeps attachment file operations desktop-only and validates logical owners", async () => {
    await expect(commandGateway.listAttachments({ ownerType: "transaction", ownerId: "tx-1" })).resolves.toEqual([])
    await expect(
      commandGateway.pickAttachment({ ownerType: "transaction", ownerId: "tx-1", attachmentType: "receipt" }),
    ).rejects.toThrow("Tauri")
    await expect(commandGateway.listAttachments({ ownerType: "transaction", ownerId: "" })).rejects.toThrow()
  })

  it("keeps natural-language translation desktop-only and validates the question before invoking", async () => {
    await expect(commandGateway.translateSafeQuery({ query: "去年教育支出", locale: "zh-CN" })).rejects.toThrow(
      "桌面应用",
    )
    await expect(commandGateway.translateSafeQuery({ query: "", locale: "zh-CN" })).rejects.toThrow()
  })

  it("searches browser-preview transactions and events with bounded pagination", async () => {
    const transaction = await commandGateway.createTransaction({
      transactionDate: "2026-07-01",
      transactionType: "expense",
      status: "completed",
      amountMinor: 1234,
      currencyCode: "CAD",
      categoryId: null,
      paymentMethodId: null,
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Global Search Market",
      note: null,
    })
    const event = await commandGateway.createCalendarEvent({
      title: "Global Search Trip",
      description: null,
      eventType: "travel",
      isAllDay: true,
      startDate: "2026-07-10",
      endDateExclusive: "2026-07-12",
      startAtUtc: null,
      endAtUtc: null,
      timezoneId: "America/Toronto",
      priority: "normal",
      color: null,
      icon: null,
      locationId: null,
      householdMemberId: null,
      isCompleted: false,
    })

    await expect(commandGateway.globalSearch({ query: "Global Search", limit: 1, offset: 0 })).resolves.toMatchObject({
      total: 2,
      records: [{ ownerId: event.id }],
    })
    await expect(commandGateway.globalSearch({ query: "Market" })).resolves.toMatchObject({
      total: 1,
      records: [{ ownerId: transaction.id, kind: "transaction" }],
    })
    await expect(commandGateway.globalSearch({ query: "x" })).rejects.toThrow()
  })

  it("batch edits only explicit fields, reports conflicts, and undoes the successful subset", async () => {
    const first = await commandGateway.createTransaction({
      transactionDate: "2026-07-01",
      transactionType: "expense",
      status: "completed",
      amountMinor: 12_345,
      currencyCode: "CAD",
      categoryId: "medical",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: "browser-default-member",
      locationId: null,
      merchant: "Batch Market",
      note: "Keep this note",
    })
    const second = await commandGateway.createTransaction({
      ...first,
      transactionDate: "2026-07-02",
      amountMinor: 6_789,
      merchant: "Conflict Market",
    })
    const changed = await commandGateway.batchEditTransactions({
      items: [
        { id: first.id, version: first.version },
        { id: second.id, version: second.version + 1 },
      ],
      patch: {
        category: { value: "food-grocery" },
        paymentMethod: { value: null },
        householdMember: { value: null },
        status: "pending",
        taxTag: { taxTagId: "00000000-0000-7000-8000-000000000207", selected: true },
      },
    })
    expect(changed.items).toHaveLength(1)
    expect(changed.conflicts).toMatchObject([{ id: second.id, code: "version_conflict" }])
    const after = await commandGateway.listTransactions({ id: first.id })
    expect(after.records[0]).toMatchObject({
      amountMinor: 12_345,
      note: "Keep this note",
      status: "pending",
      categoryId: "food-grocery",
      paymentMethodId: null,
      householdMemberId: null,
      version: first.version + 1,
    })
    expect(getBrowserAcceptedTaxTag(first.id, "00000000-0000-7000-8000-000000000207")).not.toBeNull()

    const undone = await commandGateway.undoBatchEditTransactions({ operationId: changed.operationId })
    expect(undone.conflicts).toEqual([])
    const restored = await commandGateway.listTransactions({ id: first.id })
    expect(restored.records[0]).toMatchObject({
      amountMinor: 12_345,
      note: "Keep this note",
      status: "completed",
      categoryId: "medical",
      paymentMethodId: "cash",
      householdMemberId: "browser-default-member",
      version: first.version + 2,
    })
    expect(getBrowserAcceptedTaxTag(first.id, "00000000-0000-7000-8000-000000000207")).toBeNull()
  })

  it("creates, versions, reads, and deletes a daily note without touching transactions", async () => {
    const created = await commandGateway.saveDailyNote({
      id: null,
      version: null,
      noteDate: "2026-07-04",
      householdMemberId: null,
      note: "Family picnic",
    })
    expect(created).toMatchObject({ version: 1, note: "Family picnic", attachmentCount: 0 })
    await expect(commandGateway.getDailyNote({ noteDate: "2026-07-04", householdMemberId: null })).resolves.toEqual(
      created,
    )
    const updated = await commandGateway.saveDailyNote({
      id: created.id,
      version: created.version,
      noteDate: created.noteDate,
      householdMemberId: null,
      note: "Family picnic and fireworks",
    })
    expect(updated).toMatchObject({ version: 2, note: "Family picnic and fireworks" })
    await expect(
      commandGateway.saveDailyNote({
        id: created.id,
        version: 1,
        noteDate: created.noteDate,
        householdMemberId: null,
        note: "Stale overwrite",
      }),
    ).rejects.toThrow("已被修改")
    await commandGateway.deleteDailyNote({ id: updated.id, version: updated.version })
    await expect(commandGateway.getDailyNote({ noteDate: "2026-07-04", householdMemberId: null })).resolves.toBeNull()
  })

  it("stores loopback-only AI profiles and tests provider model endpoints", async () => {
    await expect(
      commandGateway.saveAiProfile({
        id: null,
        displayName: "Remote service",
        providerType: "openai_compatible",
        baseUrl: "https://example.com/v1",
        modelName: "remote-model",
        timeoutMs: 5_000,
        maxContextTokens: 8_192,
        isEnabled: true,
      }),
    ).rejects.toThrow("localhost")

    const profile = await commandGateway.saveAiProfile({
      id: null,
      displayName: "Ollama",
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "qwen3:8b",
      timeoutMs: 5_000,
      maxContextTokens: 8_192,
      isEnabled: true,
    })
    await expect(commandGateway.listAiProfiles()).resolves.toEqual([profile])

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    await expect(commandGateway.testAiConnection(profile)).resolves.toMatchObject({
      connected: true,
      modelAvailable: true,
      availableModels: ["qwen3:8b"],
    })
    expect(fetchMock.mock.calls[0][0]).toMatchObject({ pathname: "/api/tags" })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(
      commandGateway.testAiConnection({
        ...profile,
        providerType: "openai_compatible",
        baseUrl: "http://localhost:1234/v1",
        modelName: "local-model",
      }),
    ).resolves.toMatchObject({ connected: true, modelAvailable: true })
    expect(fetchMock.mock.calls[1][0]).toMatchObject({ pathname: "/v1/models" })
  })

  it("generates, versions, and reviews AI summaries from aggregate data only", async () => {
    await commandGateway.saveAiProfile({
      id: null,
      displayName: "Ollama",
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "local-model",
      timeoutMs: 5_000,
      maxContextTokens: 8_192,
      isEnabled: true,
    })
    const transaction = (transactionDate: string, merchant: string) =>
      commandGateway.createTransaction({
        transactionDate,
        transactionType: "expense",
        status: "completed",
        amountMinor: 25_000,
        currencyCode: "CAD",
        categoryId: "travel",
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant,
        note: "private note must not be sent",
      })
    await transaction("2026-06-15", "Previous private merchant")
    await transaction("2026-07-15", "Current private merchant")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: "Travel was the leading expense category." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const generated = await commandGateway.generateAiSummary({
      summaryType: "monthly",
      periodStartDate: "2026-07-01",
      periodEndDateExclusive: "2026-08-01",
      previousPeriodStartDate: "2026-06-01",
      reportingCurrencyCode: "CAD",
      locale: "en-CA",
      aggregateScopeConfirmed: true,
    })
    expect(generated).toMatchObject({ reviewStatus: "draft", promptVersion: 1 })
    expect(generated.inputHash).toHaveLength(64)
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { prompt: string }
    expect(requestBody.prompt).toContain('"expenseMinor":25000')
    expect(requestBody.prompt).not.toContain("Current private merchant")
    expect(requestBody.prompt).not.toContain("private note")
    await expect(
      commandGateway.listAiSummaries({
        summaryType: "monthly",
        periodStartDate: "2026-07-01",
        periodEndDateExclusive: "2026-08-01",
      }),
    ).resolves.toEqual([generated])

    await expect(
      commandGateway.updateAiSummary({
        id: generated.id,
        currentText: "User-reviewed narrative.",
        reviewStatus: "reviewed",
        expectedUpdatedAt: generated.updatedAt,
      }),
    ).resolves.toMatchObject({ currentText: "User-reviewed narrative.", reviewStatus: "reviewed" })
  })

  it("keeps AI category and tax suggestions pending until explicit review", async () => {
    await commandGateway.saveAiProfile({
      id: null,
      displayName: "Ollama",
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "local-model",
      timeoutMs: 5_000,
      maxContextTokens: 8_192,
      isEnabled: true,
    })
    const transaction = await commandGateway.createTransaction({
      transactionDate: "2026-07-04",
      transactionType: "expense",
      status: "completed",
      amountMinor: 12_345,
      currencyCode: "CAD",
      categoryId: null,
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Selected clinic",
      note: "Selected consultation note",
    })
    await expect(
      commandGateway.generateAiSuggestions({
        transactionId: transaction.id,
        suggestionTypes: ["category"],
        locale: "en-CA",
        recordScopeConfirmed: false as true,
      }),
    ).rejects.toThrow()
    const medicalTaxTag = "00000000-0000-7000-8000-000000000207"
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: JSON.stringify({
            suggestions: [
              {
                suggestionType: "category",
                suggestedId: "medical",
                explanation: "The selected record is consistent with the medical category.",
              },
              {
                suggestionType: "tax_tag",
                suggestedId: medicalTaxTag,
                explanation: "This is only a candidate for professional medical-expense review.",
              },
            ],
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const suggestions = await commandGateway.generateAiSuggestions({
      transactionId: transaction.id,
      suggestionTypes: ["category", "tax_tag"],
      locale: "en-CA",
      recordScopeConfirmed: true,
    })
    expect(suggestions).toHaveLength(2)
    expect(suggestions.every((suggestion) => suggestion.status === "pending")).toBe(true)
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { prompt: string }
    expect(request.prompt).toContain("Selected clinic")
    expect(request.prompt).toContain("Selected consultation note")
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      records: [{ id: transaction.id, categoryId: null, amountMinor: 12_345, version: 1 }],
    })

    const category = suggestions.find((suggestion) => suggestion.suggestionType === "category")!
    await expect(commandGateway.reviewAiSuggestion({ id: category.id, decision: "accepted" })).resolves.toMatchObject({
      status: "accepted",
    })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      records: [{ id: transaction.id, categoryId: "medical", amountMinor: 12_345, version: 2 }],
    })
    await expect(commandGateway.listAiSuggestions({ transactionId: transaction.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ suggestionType: "category", status: "accepted" }),
        expect.objectContaining({ suggestionType: "tax_tag", status: "expired" }),
      ]),
    )

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: JSON.stringify({
            suggestions: [
              {
                suggestionType: "tax_tag",
                suggestedId: medicalTaxTag,
                explanation: "This remains a candidate requiring professional confirmation.",
              },
            ],
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const tax = await commandGateway.generateAiSuggestions({
      transactionId: transaction.id,
      suggestionTypes: ["tax_tag"],
      locale: "en-CA",
      recordScopeConfirmed: true,
    })
    await commandGateway.reviewAiSuggestion({ id: tax[0].id, decision: "accepted" })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      records: [{ id: transaction.id, amountMinor: 12_345, version: 3 }],
    })
    expect(window.localStorage.getItem("home-ledger:accepted-tax-tags:v1")).toContain("accepted_ai")
  })

  it("uses safe local defaults when preview storage is malformed", async () => {
    window.localStorage.setItem("home-ledger.browser-settings", "not-json")

    await expect(commandGateway.getSettings()).resolves.toMatchObject({
      locale: "zh-CN",
      timezoneId: "America/Toronto",
      reportingCurrencyCode: "CAD",
    })
  })

  it("validates and persists browser preview settings", async () => {
    const updated = await commandGateway.updateSettings({
      locale: "en-CA",
      timezoneId: "America/Vancouver",
      reportingCurrencyCode: "CAD",
      countryCode: "CA",
      regionCode: "BC",
      theme: "dark",
      autoBackupPolicy: { enabled: true, intervalDays: 14, retentionCount: 6 },
      calendarColorOverrides: {
        general: "#1976D2",
        important: "#D9364F",
        travel: "#123456",
        medical: "#D9364F",
        education: "#1976D2",
        bill: "#B66A00",
        tax: "#B66A00",
        maintenance: "#087F7A",
        other: "#667085",
      },
    })

    expect(updated.theme).toBe("dark")
    expect(updated.autoBackupPolicy).toEqual({ enabled: true, intervalDays: 14, retentionCount: 6 })
    expect(updated.calendarColorOverrides.travel).toBe("#123456")
    await expect(commandGateway.getSettings()).resolves.toEqual(updated)
  })

  it("exposes browser preview status without claiming a Tauri database", async () => {
    await expect(commandGateway.getAppStatus()).resolves.toMatchObject({
      databaseReady: true,
      schemaVersion: 5,
      storageMode: "browser_preview",
    })
  })

  it("creates and lists integer-minor-unit transactions", async () => {
    const created = await commandGateway.createTransaction({
      transactionDate: "2026-07-02",
      transactionType: "expense",
      status: "completed",
      amountMinor: 12345,
      currencyCode: "CAD",
      categoryId: "education",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Local College",
      note: "Course materials",
    })

    expect(created.amountMinor).toBe(12345)
    expect(created.hasPossibleTaxHint).toBe(true)
    await expect(commandGateway.listTransactions({ search: "college" })).resolves.toMatchObject({
      total: 1,
      records: [{ id: created.id, categoryName: "教育" }],
    })
  })

  it("updates with optimistic versions and supports delete undo", async () => {
    const created = await commandGateway.createTransaction({
      transactionDate: "2026-07-03",
      transactionType: "expense",
      status: "completed",
      amountMinor: 2500,
      currencyCode: "CAD",
      categoryId: "medical",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Clinic",
      note: null,
    })

    const updated = await commandGateway.updateTransaction({
      id: created.id,
      version: created.version,
      transactionDate: created.transactionDate,
      transactionType: created.transactionType,
      status: created.status,
      amountMinor: 3000,
      currencyCode: created.currencyCode,
      categoryId: created.categoryId,
      paymentMethodId: created.paymentMethodId,
      transferToPaymentMethodId: created.transferToPaymentMethodId,
      transferToAmountMinor: created.transferToAmountMinor,
      transferToCurrencyCode: created.transferToCurrencyCode,
      householdMemberId: created.householdMemberId,
      locationId: null,
      merchant: created.merchant,
      note: created.note,
    })

    expect(updated).toMatchObject({ amountMinor: 3000, version: 2, hasPossibleTaxHint: true })
    await expect(
      commandGateway.updateTransaction({
        id: created.id,
        version: created.version,
        transactionDate: created.transactionDate,
        transactionType: created.transactionType,
        status: created.status,
        amountMinor: 9999,
        currencyCode: created.currencyCode,
        categoryId: created.categoryId,
        paymentMethodId: created.paymentMethodId,
        transferToPaymentMethodId: created.transferToPaymentMethodId,
        transferToAmountMinor: created.transferToAmountMinor,
        transferToCurrencyCode: created.transferToCurrencyCode,
        householdMemberId: created.householdMemberId,
        locationId: null,
        merchant: created.merchant,
        note: created.note,
      }),
    ).rejects.toThrow("已被修改或删除")

    const deleted = await commandGateway.deleteTransaction({ id: updated.id, version: updated.version })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({ total: 0 })
    const restored = await commandGateway.restoreTransaction(deleted)
    expect(restored.version).toBe(4)
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      total: 1,
      records: [{ id: restored.id, amountMinor: 3000 }],
    })
  })

  it("persists custom categories and payment methods without full account numbers", async () => {
    const category = await commandGateway.saveCategory({
      id: null,
      name: "职业培训",
      categoryType: "expense",
      parentId: "education",
      icon: null,
      color: null,
      isActive: true,
    })
    const paymentMethod = await commandGateway.savePaymentMethod({
      id: null,
      displayName: "TD Credit 4321",
      methodType: "credit_card",
      institution: "TD",
      lastFour: "4321",
      defaultCurrencyCode: "CAD",
      icon: null,
      color: null,
      isActive: true,
    })

    const references = await commandGateway.listTransactionReferenceData()
    expect(references.categories).toContainEqual(category)
    expect(references.paymentMethods).toContainEqual(paymentMethod)
    expect(JSON.stringify(references)).not.toContain("1234567890124321")

    await commandGateway.createTransaction({
      transactionDate: "2026-07-03",
      transactionType: "expense",
      status: "completed",
      amountMinor: 5000,
      currencyCode: "CAD",
      categoryId: category.id,
      paymentMethodId: paymentMethod.id,
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Training Centre",
      note: null,
    })
    await commandGateway.saveCategory({
      id: category.id,
      name: "专业培训",
      categoryType: category.categoryType,
      parentId: category.parentId,
      icon: category.icon,
      color: category.color,
      isActive: true,
    })
    const renamedMethod = await commandGateway.savePaymentMethod({
      id: paymentMethod.id,
      displayName: "TD Credit •••• 4321",
      methodType: paymentMethod.methodType,
      institution: paymentMethod.institution,
      lastFour: paymentMethod.lastFour,
      defaultCurrencyCode: paymentMethod.defaultCurrencyCode,
      icon: paymentMethod.icon,
      color: paymentMethod.color,
      isActive: true,
    })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      records: [{ categoryName: "专业培训", paymentMethodName: "TD Credit •••• 4321" }],
    })

    const disabled = await commandGateway.savePaymentMethod({
      id: renamedMethod.id,
      displayName: renamedMethod.displayName,
      methodType: renamedMethod.methodType,
      institution: renamedMethod.institution,
      lastFour: renamedMethod.lastFour,
      defaultCurrencyCode: renamedMethod.defaultCurrencyCode,
      icon: renamedMethod.icon,
      color: renamedMethod.color,
      isActive: false,
    })
    expect(disabled.isActive).toBe(false)
  })

  it("stores transaction templates without a transaction date and tracks explicit use", async () => {
    const saved = await commandGateway.saveTransactionTemplate({
      id: null,
      name: "每月房租",
      data: {
        transactionType: "expense",
        status: "planned",
        amountMinor: 210000,
        currencyCode: "CAD",
        categoryId: "housing-rent",
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        merchant: "房东",
        note: "模板不会自动记账",
      },
      isActive: true,
    })

    expect(saved.usageCount).toBe(0)
    expect(saved.data).not.toHaveProperty("transactionDate")
    await expect(commandGateway.listTransactionTemplates()).resolves.toMatchObject([
      { id: saved.id, name: "每月房租", usageCount: 0 },
    ])

    const used = await commandGateway.useTransactionTemplate(saved.id)
    expect(used.usageCount).toBe(1)
    expect(used.lastUsedAt).not.toBeNull()
  })

  it("persists only whitelisted structured transaction filters", async () => {
    const saved = await commandGateway.saveTransactionFilter({
      id: null,
      name: "医疗大额支出",
      data: {
        search: "Clinic",
        transactionType: "expense",
        status: "completed",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        amountMinMinor: 10_000,
        amountMaxMinor: null,
        categoryId: "medical",
        paymentMethodId: null,
        householdMemberId: null,
        locationId: null,
        sortBy: "amount",
        sortDirection: "desc",
      },
      isPinned: true,
    })

    await expect(commandGateway.listTransactionFilters()).resolves.toEqual([saved])
    await expect(commandGateway.saveTransactionFilter({ ...saved, id: null, name: saved.name })).rejects.toThrow(
      "同名筛选",
    )
    await commandGateway.deleteTransactionFilter(saved.id)
    await expect(commandGateway.listTransactionFilters()).resolves.toEqual([])
  })

  it("manages default household members and locations without rewriting history", async () => {
    const initialReferences = await commandGateway.listTransactionReferenceData()
    const originalDefault = initialReferences.householdMembers.find((member) => member.isDefault)
    expect(originalDefault).toBeDefined()

    const member = await commandGateway.saveHouseholdMember({
      id: null,
      displayName: "Alex",
      relationship: "配偶",
      color: null,
      isDefault: true,
      isActive: true,
    })
    const location = await commandGateway.saveLocation({
      id: null,
      name: "Costco Richmond Hill",
      addressLine: "35 John Birchall Road",
      city: "Richmond Hill",
      province: "Ontario",
      countryCode: "CA",
      postalCode: "L4S 0B2",
      isFavorite: true,
      isActive: true,
    })
    const references = await commandGateway.listTransactionReferenceData()
    expect(references.householdMembers.filter((candidate) => candidate.isDefault)).toEqual([member])
    expect(references.locations).toContainEqual(location)

    const transaction = await commandGateway.createTransaction({
      transactionDate: "2026-07-03",
      transactionType: "expense",
      status: "completed",
      amountMinor: 7890,
      currencyCode: "CAD",
      categoryId: "food-grocery",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: member.id,
      locationId: location.id,
      merchant: "Costco",
      note: null,
    })
    expect(transaction).toMatchObject({
      householdMemberName: "Alex",
      locationName: "Costco Richmond Hill",
    })
    await expect(
      commandGateway.listTransactions({ householdMemberId: member.id, locationId: location.id }),
    ).resolves.toMatchObject({ total: 1, records: [{ id: transaction.id }] })
    await expect(commandGateway.listTransactions({ search: "Richmond Hill" })).resolves.toMatchObject({ total: 1 })

    await commandGateway.saveLocation({
      id: location.id,
      name: location.name,
      addressLine: location.addressLine,
      city: location.city,
      province: location.province,
      countryCode: location.countryCode,
      postalCode: location.postalCode,
      isFavorite: location.isFavorite,
      isActive: false,
    })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      records: [{ id: transaction.id, locationName: "Costco Richmond Hill" }],
    })
  })

  it("applies batch category changes and atomic delete undo", async () => {
    const makeInput = (merchant: string, amountMinor: number) => ({
      transactionDate: "2026-07-03",
      transactionType: "expense" as const,
      status: "completed" as const,
      amountMinor,
      currencyCode: "CAD",
      categoryId: "food-grocery",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant,
      note: null,
    })
    const first = await commandGateway.createTransaction(makeInput("First", 1000))
    const second = await commandGateway.createTransaction(makeInput("Second", 2000))
    const selected = [
      { id: first.id, version: first.version },
      { id: second.id, version: second.version },
    ]

    const updated = await commandGateway.batchUpdateTransactionCategory({
      items: selected,
      categoryId: "medical",
    })
    expect(updated.items).toHaveLength(2)
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({
      total: 2,
      records: [
        { categoryName: "医疗", hasPossibleTaxHint: true, version: 2 },
        { categoryName: "医疗", hasPossibleTaxHint: true, version: 2 },
      ],
    })
    await expect(
      commandGateway.batchUpdateTransactionCategory({ items: selected, categoryId: "travel" }),
    ).rejects.toThrow("已被修改或删除")

    const deleted = await commandGateway.batchDeleteTransactions({ items: updated.items })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({ total: 0 })
    const restored = await commandGateway.batchRestoreTransactions({ items: deleted.items })
    expect(restored.items.every((item) => item.version === 4)).toBe(true)
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({ total: 2 })
  })

  it("combines server-style filters, sorting, and pagination", async () => {
    const create = (
      transactionDate: string,
      amountMinor: number,
      categoryId: string,
      status: "planned" | "completed",
      merchant: string,
    ) =>
      commandGateway.createTransaction({
        transactionDate,
        transactionType: "expense",
        status,
        amountMinor,
        currencyCode: "CAD",
        categoryId,
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant,
        note: null,
      })
    await create("2026-06-01", 10000, "food-grocery", "completed", "Grocer")
    await create("2026-07-02", 50000, "medical", "completed", "Clinic")
    await create("2026-07-03", 30000, "medical", "planned", "Pharmacy")

    await expect(
      commandGateway.listTransactions({
        dateFrom: "2026-07-01",
        status: "completed",
        categoryId: "medical",
        amountMinMinor: 40000,
        sortBy: "amount",
        sortDirection: "desc",
      }),
    ).resolves.toMatchObject({ total: 1, records: [{ merchant: "Clinic", amountMinor: 50000 }] })
    await expect(
      commandGateway.listTransactions({
        sortBy: "amount",
        sortDirection: "desc",
        limit: 1,
        offset: 1,
      }),
    ).resolves.toMatchObject({ total: 3, records: [{ merchant: "Pharmacy", amountMinor: 30000 }] })
  })

  it("suggests frequent merchant history without changing a transaction", async () => {
    const create = (categoryId: string, amountMinor: number, note: string) =>
      commandGateway.createTransaction({
        transactionDate: "2026-07-03",
        transactionType: "expense",
        status: "completed",
        amountMinor,
        currencyCode: "CAD",
        categoryId,
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant: "History Clinic",
        note,
      })
    await create("medical", 5000, "First visit")
    await create("food-grocery", 1000, "Unusual purchase")
    await create("medical", 5000, "Most recent visit")

    await expect(
      commandGateway.suggestTransaction({ merchant: "history clinic", transactionType: "expense" }),
    ).resolves.toMatchObject({
      matchedCount: 3,
      categoryId: "medical",
      paymentMethodId: "cash",
      amountMinor: 5000,
      note: "Most recent visit",
    })
    await expect(commandGateway.listTransactions()).resolves.toMatchObject({ total: 3 })
  })

  it("loads and removes only explicitly created example data", async () => {
    const personal = await commandGateway.createTransaction({
      transactionDate: "2026-07-03",
      transactionType: "expense",
      status: "completed",
      amountMinor: 1234,
      currencyCode: "CAD",
      categoryId: "food-grocery",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Personal record",
      note: null,
    })
    await expect(commandGateway.getExampleDataStatus()).resolves.toEqual({ loaded: false, transactionCount: 0 })

    await expect(commandGateway.loadExampleData()).resolves.toEqual({ loaded: true, transactionCount: 10 })
    const loaded = await commandGateway.listTransactions({ limit: 100 })
    expect(loaded.total).toBe(11)
    expect(loaded.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "planned", merchant: "房东" }),
        expect.objectContaining({ currencyCode: "USD", merchant: "Airline USD" }),
        expect.objectContaining({ merchant: "社区诊所", hasPossibleTaxHint: true }),
      ]),
    )
    await expect(commandGateway.loadExampleData()).rejects.toThrow("已经加载")

    await expect(commandGateway.removeExampleData()).resolves.toEqual({ loaded: false, transactionCount: 0 })
    await expect(commandGateway.listTransactions({ limit: 100 })).resolves.toMatchObject({
      total: 1,
      records: [{ id: personal.id }],
    })
  })

  it("creates, filters, updates, deletes, and restores calendar events", async () => {
    const created = await commandGateway.createCalendarEvent({
      title: "Vancouver trip",
      description: "Family travel",
      eventType: "travel",
      isAllDay: true,
      startDate: "2026-07-10",
      endDateExclusive: "2026-07-13",
      startAtUtc: null,
      endAtUtc: null,
      timezoneId: "America/Toronto",
      priority: "important",
      color: "#7455D9",
      icon: "luggage",
      locationId: null,
      householdMemberId: null,
      isCompleted: false,
    })
    expect(created).toMatchObject({ version: 1, householdMemberName: "我", linkedTransactionCount: 0 })
    await expect(
      commandGateway.listCalendarEvents({
        rangeStartDate: "2026-07-11",
        rangeEndDateExclusive: "2026-07-12",
        timezoneId: "America/Toronto",
        eventType: "travel",
      }),
    ).resolves.toMatchObject([{ id: created.id }])

    const updated = await commandGateway.updateCalendarEvent({
      id: created.id,
      version: created.version,
      title: "Updated trip",
      description: created.description,
      eventType: created.eventType,
      isAllDay: created.isAllDay,
      startDate: created.startDate,
      endDateExclusive: created.endDateExclusive,
      startAtUtc: created.startAtUtc,
      endAtUtc: created.endAtUtc,
      timezoneId: created.timezoneId,
      priority: created.priority,
      color: created.color,
      icon: created.icon,
      locationId: created.locationId,
      householdMemberId: created.householdMemberId,
      isCompleted: true,
    })
    expect(updated).toMatchObject({ title: "Updated trip", version: 2, isCompleted: true })
    const travelExpense = await commandGateway.createTransaction({
      transactionDate: "2026-07-11",
      transactionType: "expense",
      status: "completed",
      amountMinor: 18500,
      currencyCode: "CAD",
      categoryId: "travel",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "Vancouver hotel",
      note: null,
    })
    const linked = await commandGateway.linkEventTransaction({
      eventId: updated.id,
      transactionId: travelExpense.id,
    })
    expect(linked).toMatchObject({
      linkedTransactionCount: 1,
      linkedTransactionIds: [travelExpense.id],
      version: updated.version,
    })
    await expect(
      commandGateway.unlinkEventTransaction({ eventId: updated.id, transactionId: travelExpense.id }),
    ).resolves.toMatchObject({ linkedTransactionCount: 0, linkedTransactionIds: [] })
    await expect(
      commandGateway.updateCalendarEvent({
        id: created.id,
        version: 1,
        title: "Stale",
        description: created.description,
        eventType: created.eventType,
        isAllDay: created.isAllDay,
        startDate: created.startDate,
        endDateExclusive: created.endDateExclusive,
        startAtUtc: created.startAtUtc,
        endAtUtc: created.endAtUtc,
        timezoneId: created.timezoneId,
        priority: created.priority,
        color: created.color,
        icon: created.icon,
        locationId: created.locationId,
        householdMemberId: created.householdMemberId,
        isCompleted: false,
      }),
    ).rejects.toThrow("已被修改或删除")

    const deleted = await commandGateway.deleteCalendarEvent({ id: updated.id, version: updated.version })
    await expect(
      commandGateway.listCalendarEvents({
        rangeStartDate: "2026-07-01",
        rangeEndDateExclusive: "2026-08-01",
        timezoneId: "America/Toronto",
      }),
    ).resolves.toEqual([])
    await expect(commandGateway.restoreCalendarEvent(deleted)).resolves.toMatchObject({ id: updated.id, version: 4 })
  })

  it("materializes recurring rent as idempotent planned transactions", async () => {
    const saved = await commandGateway.saveRecurringTransaction({
      id: null,
      name: "Monthly rent",
      frequency: "monthly",
      interval: 1,
      customRrule: null,
      startDate: "2026-07-01",
      endDate: null,
      occurrenceCount: 3,
      timezoneId: "America/Toronto",
      advanceNoticeDays: 3,
      materializeDaysAhead: 40,
      isActive: true,
      template: {
        transactionType: "expense",
        amountMinor: 200000,
        currencyCode: "CAD",
        categoryId: "housing-rent",
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant: "Landlord",
        note: "Confirm after payment",
      },
    })
    expect(saved).toMatchObject({ advanceNoticeDays: 3, isActive: true })
    await expect(commandGateway.materializeRecurringTransactions({ asOfDate: "2026-07-01" })).resolves.toEqual({
      createdCount: 2,
      alreadyMaterializedCount: 0,
    })
    await expect(commandGateway.listTransactions({ limit: 10 })).resolves.toMatchObject({
      total: 2,
      records: expect.arrayContaining([
        expect.objectContaining({ status: "planned", amountMinor: 200000, merchant: "Landlord" }),
      ]),
    })
    await expect(commandGateway.materializeRecurringTransactions({ asOfDate: "2026-07-01" })).resolves.toEqual({
      createdCount: 0,
      alreadyMaterializedCount: 2,
    })
    const reminders = await commandGateway.listReminderDeliveries({
      rangeStartUtc: "2026-06-01T00:00:00Z",
      rangeEndUtc: "2026-09-01T00:00:00Z",
    })
    expect(reminders).toHaveLength(2)
    await commandGateway.dismissReminder({ id: reminders[0].id })
    await commandGateway.markReminderDelivered({ id: reminders[1].id })
    await expect(
      commandGateway.listReminderDeliveries({
        rangeStartUtc: "2026-06-01T00:00:00Z",
        rangeEndUtc: "2026-09-01T00:00:00Z",
      }),
    ).resolves.toEqual([])
  })

  it("groups deterministic daily calendar totals without counting planned transactions", async () => {
    const base = {
      transactionDate: "2026-07-12",
      currencyCode: "CAD",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: null,
      note: null,
    }
    await commandGateway.createTransaction({
      ...base,
      transactionType: "income",
      status: "completed",
      amountMinor: 300000,
      categoryId: "salary",
    })
    await commandGateway.createTransaction({
      ...base,
      transactionType: "expense",
      status: "completed",
      amountMinor: 12500,
      categoryId: "food-grocery",
    })
    await commandGateway.createTransaction({
      ...base,
      transactionType: "expense",
      status: "completed",
      amountMinor: 12500,
      categoryId: "food-grocery",
    })
    await commandGateway.createTransaction({
      ...base,
      transactionDate: "2026-07-13",
      transactionType: "expense",
      status: "completed",
      amountMinor: 150000,
      categoryId: null,
      merchant: "Large purchase",
    })
    await commandGateway.createTransaction({
      ...base,
      transactionType: "expense",
      status: "planned",
      amountMinor: 200000,
      categoryId: "housing-rent",
    })
    await commandGateway.createTransaction({
      ...base,
      transactionType: "expense",
      status: "completed",
      amountMinor: 5000,
      currencyCode: "USD",
      categoryId: "travel",
    })
    await expect(
      commandGateway.listDailyFinancialSummaries({
        rangeStartDate: "2026-07-01",
        rangeEndDateExclusive: "2026-08-01",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summaryDate: "2026-07-12",
          reportingCurrencyCode: "CAD",
          incomeMinor: 300000,
          expenseMinor: 25000,
        }),
        expect.objectContaining({
          summaryDate: "2026-07-12",
          reportingCurrencyCode: null,
          plannedCount: 1,
        }),
      ]),
    )
    await expect(
      commandGateway.getFinancialSummary({
        periodStartDate: "2026-07-01",
        periodEndDateExclusive: "2026-08-01",
        reportingCurrencyCode: "CAD",
      }),
    ).resolves.toMatchObject({
      incomeMinor: 300000,
      expenseMinor: 175000,
      fixedExpenseMinor: 0,
      variableExpenseMinor: 175000,
      netMinor: 125000,
      actualTransactionCount: 4,
      excludedCurrencyCount: 1,
      categoryTotals: expect.arrayContaining([
        { id: "food", name: "饮食", amountMinor: 25000 },
        { id: "unassigned", name: "未分类", amountMinor: 150000 },
      ]),
      largestExpense: { amountMinor: 150000 },
      reviewCandidates: expect.arrayContaining([
        expect.objectContaining({ flagType: "possible_duplicate", amountMinor: 12500 }),
        expect.objectContaining({ flagType: "unusually_high", amountMinor: 150000 }),
        expect.objectContaining({ flagType: "missing_attachment", amountMinor: 150000 }),
        expect.objectContaining({ flagType: "uncategorized", amountMinor: 150000 }),
      ]),
    })
    const beforeReview = await commandGateway.getFinancialSummary({
      periodStartDate: "2026-07-01",
      periodEndDateExclusive: "2026-08-01",
      reportingCurrencyCode: "CAD",
    })
    const highCandidate = beforeReview.reviewCandidates.find((candidate) => candidate.flagType === "unusually_high")!
    await expect(
      commandGateway.setFinancialReviewCandidateStatus({
        transactionId: highCandidate.transactionId,
        flagType: highCandidate.flagType,
        status: "dismissed",
      }),
    ).resolves.toMatchObject({ status: "dismissed" })
    await expect(
      commandGateway.getFinancialSummary({
        periodStartDate: "2026-07-01",
        periodEndDateExclusive: "2026-08-01",
        reportingCurrencyCode: "CAD",
      }),
    ).resolves.not.toMatchObject({
      reviewCandidates: expect.arrayContaining([
        expect.objectContaining({ transactionId: highCandidate.transactionId, flagType: "unusually_high" }),
      ]),
    })
  })

  it("saves report notes separately with optimistic versions", async () => {
    const period = {
      reportType: "monthly" as const,
      periodStartDate: "2026-07-01",
      periodEndDateExclusive: "2026-08-01",
    }
    await expect(commandGateway.getReportNote(period)).resolves.toBeNull()
    const created = await commandGateway.saveReportNote({
      ...period,
      note: "Family travel increased expenses.",
      expectedVersion: null,
    })
    expect(created).toMatchObject({ version: 1, note: "Family travel increased expenses." })
    await expect(
      commandGateway.saveReportNote({ ...period, note: "Stale edit", expectedVersion: null }),
    ).rejects.toThrow("其他窗口")
    const updated = await commandGateway.saveReportNote({
      ...period,
      note: "User revised note.",
      expectedVersion: created.version,
    })
    expect(updated).toMatchObject({ version: 2, note: "User revised note." })
    await expect(commandGateway.getReportNote(period)).resolves.toMatchObject(updated)
  })

  it("exports an exact-minor-unit CSV in browser preview", async () => {
    await commandGateway.createTransaction({
      transactionDate: "2026-07-09",
      transactionType: "expense",
      status: "completed",
      amountMinor: 12345,
      currencyCode: "CAD",
      categoryId: "food-grocery",
      paymentMethodId: "cash",
      transferToPaymentMethodId: null,
      transferToAmountMinor: null,
      transferToCurrencyCode: null,
      householdMemberId: null,
      locationId: null,
      merchant: "=unsafe formula",
      note: 'comma, quote " check',
    })
    const createObjectUrl = vi.fn(() => "blob:home-ledger")
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    await expect(
      commandGateway.exportFinancialReport({
        reportType: "monthly",
        periodStartDate: "2026-07-01",
        periodEndDateExclusive: "2026-08-01",
        reportingCurrencyCode: "CAD",
        exportFormat: "csv",
        destinationPath: "HomeLedger-2026-07.csv",
      }),
    ).resolves.toMatchObject({ recordCount: 1, exportFormat: "csv" })
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:home-ledger")
    click.mockRestore()
  })

  it("validates custom RRULE fields and materializes selected weekdays", async () => {
    const input = {
      id: null,
      name: "Study reminder",
      frequency: "custom" as const,
      interval: 1,
      customRrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
      startDate: "2026-07-01",
      endDate: null,
      occurrenceCount: null,
      timezoneId: "America/Toronto",
      advanceNoticeDays: 0,
      materializeDaysAhead: 30,
      isActive: true,
      template: {
        transactionType: "expense" as const,
        amountMinor: 1000,
        currencyCode: "CAD",
        categoryId: "education",
        paymentMethodId: "cash",
        transferToPaymentMethodId: null,
        transferToAmountMinor: null,
        transferToCurrencyCode: null,
        householdMemberId: null,
        locationId: null,
        merchant: "Study room",
        note: null,
      },
    }
    await commandGateway.saveRecurringTransaction(input)
    await expect(commandGateway.materializeRecurringTransactions({ asOfDate: "2026-07-01" })).resolves.toMatchObject({
      createdCount: 4,
    })
    const records = (await commandGateway.listTransactions({ limit: 10 })).records
    expect(records.map((record) => record.transactionDate).toSorted()).toEqual([
      "2026-07-01",
      "2026-07-06",
      "2026-07-08",
      "2026-07-13",
    ])
    await expect(
      commandGateway.saveRecurringTransaction({ ...input, id: null, customRrule: "FREQ=HOURLY;BYSECOND=1" }),
    ).rejects.toThrow()
  })

  it("materializes recurring all-day events once with reminder records", async () => {
    const saved = await commandGateway.saveRecurringEvent({
      id: null,
      name: "Family birthday",
      frequency: "yearly",
      interval: 1,
      customRrule: null,
      startDate: "2026-07-01",
      endDate: null,
      occurrenceCount: 2,
      timezoneId: "America/Toronto",
      advanceNoticeDays: 7,
      materializeDaysAhead: 400,
      isActive: true,
      template: {
        title: "Birthday",
        description: "Family birthday",
        eventType: "important",
        durationDays: 1,
        priority: "important",
        color: "#D9364F",
        icon: null,
        locationId: null,
        householdMemberId: null,
      },
    })
    expect(saved.template.householdMemberId).toBe("browser-default-member")
    await expect(commandGateway.materializeRecurringTransactions({ asOfDate: "2026-07-01" })).resolves.toEqual({
      createdCount: 2,
      alreadyMaterializedCount: 0,
    })
    await expect(
      commandGateway.listCalendarEvents({
        rangeStartDate: "2026-07-01",
        rangeEndDateExclusive: "2026-07-02",
        timezoneId: "America/Toronto",
      }),
    ).resolves.toMatchObject([{ title: "Birthday", startDate: "2026-07-01" }])
    await expect(commandGateway.materializeRecurringTransactions({ asOfDate: "2026-07-01" })).resolves.toEqual({
      createdCount: 0,
      alreadyMaterializedCount: 2,
    })
    await expect(
      commandGateway.listReminderDeliveries({
        rangeStartUtc: "2026-06-01T00:00:00Z",
        rangeEndUtc: "2026-08-01T00:00:00Z",
      }),
    ).resolves.toHaveLength(1)
  })
})
