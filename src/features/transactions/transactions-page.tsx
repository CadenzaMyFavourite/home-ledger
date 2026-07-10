import { zodResolver } from "@hookform/resolvers/zod"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table"
import { format } from "date-fns"
import {
  CircleAlertIcon,
  BotIcon,
  BookmarkPlusIcon,
  CopyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AttachmentManager } from "@/features/attachments/attachment-manager"
import { BatchEditSheet } from "@/features/transactions/batch-edit-sheet"
import { SafeQuerySheet } from "@/features/transactions/safe-query-sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  commandGateway,
  type Category,
  type AiSuggestionRecord,
  type AiSuggestionType,
  type CreateTransactionInput,
  type HouseholdMember,
  type Location,
  type ListTransactionsInput,
  type PaymentMethod,
  type TransactionRecord,
  type TransactionSavedFilterData,
  type TransactionSavedFilterRecord,
  type TransactionSuggestion,
  type TransactionTemplateRecord,
  type TransactionType,
  type ValidatedSafeQuery,
} from "@/lib/commands"
import { formatMinorAmount, minorAmountToInput, parseMoneyToMinor } from "@/lib/money"

const transactionFormSchema = z
  .object({
    transactionDate: z.string().date("请选择有效日期"),
    transactionType: z.enum(["expense", "income", "transfer"]),
    status: z.enum(["planned", "pending", "completed", "cancelled"]),
    amountText: z.string().min(1, "请输入金额"),
    currencyCode: z.string().regex(/^[A-Z]{3}$/, "请输入三位大写币种代码"),
    categoryId: z.string(),
    paymentMethodId: z.string(),
    householdMemberId: z.string(),
    locationId: z.string(),
    transferToPaymentMethodId: z.string(),
    transferAmountText: z.string(),
    transferToCurrencyCode: z.string(),
    merchant: z.string().max(200, "商家名称不能超过 200 个字符"),
    note: z.string().max(4000, "备注不能超过 4000 个字符"),
  })
  .superRefine((values, context) => {
    try {
      parseMoneyToMinor(values.amountText)
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["amountText"],
        message: error instanceof Error ? error.message : "金额无效",
      })
    }
    if (values.transactionType === "transfer") {
      if (!values.paymentMethodId)
        context.addIssue({ code: "custom", path: ["paymentMethodId"], message: "请选择转出账户" })
      if (!values.transferToPaymentMethodId)
        context.addIssue({ code: "custom", path: ["transferToPaymentMethodId"], message: "请选择转入账户" })
      if (values.paymentMethodId && values.paymentMethodId === values.transferToPaymentMethodId) {
        context.addIssue({ code: "custom", path: ["transferToPaymentMethodId"], message: "转入和转出账户不能相同" })
      }
      try {
        parseMoneyToMinor(values.transferAmountText)
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["transferAmountText"],
          message: error instanceof Error ? error.message : "金额无效",
        })
      }
      if (!/^[A-Z]{3}$/.test(values.transferToCurrencyCode)) {
        context.addIssue({ code: "custom", path: ["transferToCurrencyCode"], message: "请输入三位大写币种代码" })
      }
    }
  })

type TransactionFormValues = z.infer<typeof transactionFormSchema>
type EditorState = {
  mode: "create" | "edit" | "copy" | "template"
  record?: TransactionRecord
  template?: TransactionTemplateRecord
}

const PAGE_SIZE = 50
type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc"
type AdvancedFilterDraft = {
  status: "all" | "planned" | "pending" | "completed" | "cancelled"
  dateFrom: string
  dateTo: string
  amountMinText: string
  amountMaxText: string
  categoryId: string
  paymentMethodId: string
  householdMemberId: string
  locationId: string
  sortKey: SortKey
}
type AppliedAdvancedFilters = Omit<AdvancedFilterDraft, "amountMinText" | "amountMaxText"> & {
  amountMinMinor?: number
  amountMaxMinor?: number
}
const emptyAdvancedFilters: AdvancedFilterDraft = {
  status: "all",
  dateFrom: "",
  dateTo: "",
  amountMinText: "",
  amountMaxText: "",
  categoryId: "",
  paymentMethodId: "",
  householdMemberId: "",
  locationId: "",
  sortKey: "date_desc",
}
const emptyAppliedFilters: AppliedAdvancedFilters = {
  status: "all",
  dateFrom: "",
  dateTo: "",
  categoryId: "",
  paymentMethodId: "",
  householdMemberId: "",
  locationId: "",
  sortKey: "date_desc",
}

function handleTransactionRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
  if (event.target !== event.currentTarget) return
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
  const rows = Array.from(
    event.currentTarget.closest("tbody")?.querySelectorAll<HTMLTableRowElement>('tr[tabindex="0"]') ?? [],
  )
  const currentIndex = rows.indexOf(event.currentTarget)
  if (currentIndex < 0 || rows.length === 0) return
  const targetIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, currentIndex + (event.key === "ArrowDown" ? 1 : -1)))
  event.preventDefault()
  rows[targetIndex]?.focus()
}

export function TransactionsPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get("focus")
  const focusAttachmentId = searchParams.get("attachment")
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [aiTarget, setAiTarget] = useState<TransactionRecord | null>(null)
  const [attachmentTarget, setAttachmentTarget] = useState<TransactionRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TransactionRecord | null>(null)
  const [templateSource, setTemplateSource] = useState<TransactionRecord | null>(null)
  const [saveFilterOpen, setSaveFilterOpen] = useState(false)
  const [safeQueryOpen, setSafeQueryOpen] = useState(false)
  const [safeQuery, setSafeQuery] = useState<ValidatedSafeQuery | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [batchEditRecords, setBatchEditRecords] = useState<TransactionRecord[] | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterDraft>(emptyAdvancedFilters)
  const [advancedFilters, setAdvancedFilters] = useState<AppliedAdvancedFilters>(emptyAppliedFilters)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState("")
  const [transactionType, setTransactionType] = useState<"all" | TransactionType>("all")
  const deferredSearch = useDeferredValue(search)
  const filters = useMemo(() => {
    if (safeQuery) {
      const offset = page * PAGE_SIZE
      const maximum = safeQuery.filters.limit ?? PAGE_SIZE
      return {
        ...safeQuery.filters,
        limit: Math.max(1, Math.min(PAGE_SIZE, maximum - offset)),
        offset,
      } satisfies ListTransactionsInput
    }
    const [sortBy, sortDirection] =
      advancedFilters.sortKey === "date_asc"
        ? (["transaction_date", "asc"] as const)
        : advancedFilters.sortKey === "amount_desc"
          ? (["amount", "desc"] as const)
          : advancedFilters.sortKey === "amount_asc"
            ? (["amount", "asc"] as const)
            : (["transaction_date", "desc"] as const)
    return {
      search: deferredSearch || undefined,
      transactionType: transactionType === "all" ? undefined : transactionType,
      status: advancedFilters.status === "all" ? undefined : advancedFilters.status,
      dateFrom: advancedFilters.dateFrom || undefined,
      dateTo: advancedFilters.dateTo || undefined,
      amountMinMinor: advancedFilters.amountMinMinor,
      amountMaxMinor: advancedFilters.amountMaxMinor,
      categoryId: advancedFilters.categoryId || undefined,
      paymentMethodId: advancedFilters.paymentMethodId || undefined,
      householdMemberId: advancedFilters.householdMemberId || undefined,
      locationId: advancedFilters.locationId || undefined,
      sortBy,
      sortDirection,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }
  }, [advancedFilters, deferredSearch, page, safeQuery, transactionType])
  const transactions = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => commandGateway.listTransactions(filters),
    placeholderData: keepPreviousData,
  })
  const focusedTransaction = useQuery({
    queryKey: ["transactions", "focus", focusId],
    queryFn: () => commandGateway.listTransactions({ id: focusId!, limit: 1, offset: 0 }),
    enabled: Boolean(focusId),
  })
  const focusedRecord = focusedTransaction.data?.records[0]
  const activeEditor: EditorState | null =
    editor ?? (focusId && focusedRecord && !focusAttachmentId ? { mode: "edit", record: focusedRecord } : null)
  const activeAttachmentTarget =
    attachmentTarget ?? (focusId && focusedRecord && focusAttachmentId ? focusedRecord : null)
  const clearFocusedResult = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("focus")
    next.delete("attachment")
    setSearchParams(next, { replace: true })
  }
  const templates = useQuery({
    queryKey: ["transaction-templates"],
    queryFn: () => commandGateway.listTransactionTemplates(),
  })
  const savedFilters = useQuery({
    queryKey: ["transaction-filters"],
    queryFn: commandGateway.listTransactionFilters,
  })
  const referenceData = useQuery({
    queryKey: ["transaction-reference-data"],
    queryFn: commandGateway.listTransactionReferenceData,
  })
  const useTemplateMutation = useMutation({
    mutationFn: commandGateway.useTransactionTemplate,
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-templates"] })
      setEditor({ mode: "template", template })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.templateError")),
  })
  const restoreMutation = useMutation({
    mutationFn: commandGateway.restoreTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t("transactions.restored"))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.restoreError")),
  })
  const deleteMutation = useMutation({
    mutationFn: commandGateway.deleteTransaction,
    onSuccess: async (result) => {
      setDeleteTarget(null)
      setPage(0)
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t("transactions.deleted"), {
        action: {
          label: t("transactions.undo"),
          onClick: () => restoreMutation.mutate(result),
        },
      })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.deleteError")),
  })
  const columns = useMemo<ColumnDef<TransactionRecord, unknown>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
            aria-label={t("transactions.selectAll")}
          />
        ),
        cell: ({ row }) => {
          const description = row.original.merchant ?? row.original.note ?? row.original.transactionDate
          return (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
              aria-label={t("transactions.selectRow", { description })}
            />
          )
        },
        enableSorting: false,
      },
      { accessorKey: "transactionDate", header: t("transactions.date") },
      {
        accessorKey: "transactionType",
        header: t("transactions.type"),
        cell: ({ row }) => <Badge variant="outline">{t(`transactions.types.${row.original.transactionType}`)}</Badge>,
      },
      {
        id: "description",
        header: t("transactions.descriptionColumn"),
        cell: ({ row }) => (
          <div className="flex min-w-44 flex-col gap-1">
            <span className="truncate font-medium">{row.original.merchant ?? row.original.note ?? "—"}</span>
            {row.original.hasPossibleTaxHint ? (
              <Badge variant="secondary" className="w-fit">
                <CircleAlertIcon aria-hidden="true" />
                {t("transactions.taxHint")}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "categoryName",
        header: t("transactions.category"),
        cell: ({ row }) => row.original.categoryName ?? "—",
      },
      {
        accessorKey: "paymentMethodName",
        header: t("transactions.paymentMethod"),
        cell: ({ row }) => row.original.paymentMethodName ?? "—",
      },
      {
        accessorKey: "householdMemberName",
        header: t("transactions.householdMember"),
        cell: ({ row }) => row.original.householdMemberName ?? "—",
      },
      {
        accessorKey: "locationName",
        header: t("transactions.location"),
        cell: ({ row }) => row.original.locationName ?? "—",
      },
      {
        accessorKey: "status",
        header: t("transactions.status"),
        cell: ({ row }) => <Badge variant="secondary">{t(`transactions.statuses.${row.original.status}`)}</Badge>,
      },
      {
        accessorKey: "amountMinor",
        header: () => <span className="block text-right">{t("transactions.amount")}</span>,
        cell: ({ row }) => (
          <span className="block text-right font-medium tabular-nums">
            {formatMinorAmount(row.original.amountMinor, row.original.currencyCode, i18n.language)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("transactions.actions")}</span>,
        cell: ({ row }) => (
          <TransactionRowActions
            record={row.original}
            onEdit={() => setEditor({ mode: "edit", record: row.original })}
            onCopy={() => setEditor({ mode: "copy", record: row.original })}
            onSaveTemplate={() => setTemplateSource(row.original)}
            onAiSuggestions={() => setAiTarget(row.original)}
            onAttachments={() => setAttachmentTarget(row.original)}
            onDelete={() => setDeleteTarget(row.original)}
          />
        ),
      },
    ],
    [i18n.language, t],
  )
  const table = useReactTable({
    data: transactions.data?.records ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  })
  const selectedRecords = table.getSelectedRowModel().rows.map((row) => row.original)
  const selectedItems = selectedRecords.map((record) => ({ id: record.id, version: record.version }))
  const batchRestoreMutation = useMutation({
    mutationFn: commandGateway.batchRestoreTransactions,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t("transactions.batchRestored", { count: result.items.length }))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.restoreError")),
  })
  const batchDeleteMutation = useMutation({
    mutationFn: commandGateway.batchDeleteTransactions,
    onSuccess: async (result) => {
      setBulkDeleteOpen(false)
      setRowSelection({})
      setPage(0)
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t("transactions.batchDeleted", { count: result.items.length }), {
        action: {
          label: t("transactions.undo"),
          onClick: () => batchRestoreMutation.mutate({ items: result.items }),
        },
      })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.batchError")),
  })
  const applyAdvancedFilters = () => {
    try {
      if (advancedDraft.dateFrom && advancedDraft.dateTo && advancedDraft.dateFrom > advancedDraft.dateTo) {
        throw new Error(t("transactions.dateRangeError"))
      }
      const amountMinMinor = advancedDraft.amountMinText ? parseMoneyToMinor(advancedDraft.amountMinText) : undefined
      const amountMaxMinor = advancedDraft.amountMaxText ? parseMoneyToMinor(advancedDraft.amountMaxText) : undefined
      if (amountMinMinor !== undefined && amountMaxMinor !== undefined && amountMinMinor > amountMaxMinor) {
        throw new Error(t("transactions.amountRangeError"))
      }
      setAdvancedFilters({
        status: advancedDraft.status,
        dateFrom: advancedDraft.dateFrom,
        dateTo: advancedDraft.dateTo,
        amountMinMinor,
        amountMaxMinor,
        categoryId: advancedDraft.categoryId,
        paymentMethodId: advancedDraft.paymentMethodId,
        householdMemberId: advancedDraft.householdMemberId,
        locationId: advancedDraft.locationId,
        sortKey: advancedDraft.sortKey,
      })
      setPage(0)
      setRowSelection({})
      setAdvancedOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("transactions.batchError"))
    }
  }
  const clearAdvancedFilters = () => {
    setAdvancedDraft(emptyAdvancedFilters)
    setAdvancedFilters(emptyAppliedFilters)
    setPage(0)
    setRowSelection({})
  }
  const visibleTotal = safeQuery
    ? Math.min(transactions.data?.total ?? 0, safeQuery.filters.limit ?? PAGE_SIZE)
    : (transactions.data?.total ?? 0)
  const pageCount = Math.max(1, Math.ceil(visibleTotal / PAGE_SIZE))
  const hasAdvancedFilters =
    advancedFilters.status !== "all" ||
    Boolean(advancedFilters.dateFrom) ||
    Boolean(advancedFilters.dateTo) ||
    advancedFilters.amountMinMinor !== undefined ||
    advancedFilters.amountMaxMinor !== undefined ||
    Boolean(advancedFilters.categoryId) ||
    Boolean(advancedFilters.paymentMethodId) ||
    Boolean(advancedFilters.householdMemberId) ||
    Boolean(advancedFilters.locationId) ||
    advancedFilters.sortKey !== "date_desc"
  const currentSavedFilterData: TransactionSavedFilterData = {
    search,
    transactionType: transactionType === "all" ? null : transactionType,
    status: advancedFilters.status === "all" ? null : advancedFilters.status,
    dateFrom: advancedFilters.dateFrom || null,
    dateTo: advancedFilters.dateTo || null,
    amountMinMinor: advancedFilters.amountMinMinor ?? null,
    amountMaxMinor: advancedFilters.amountMaxMinor ?? null,
    categoryId: advancedFilters.categoryId || null,
    paymentMethodId: advancedFilters.paymentMethodId || null,
    householdMemberId: advancedFilters.householdMemberId || null,
    locationId: advancedFilters.locationId || null,
    sortBy:
      advancedFilters.sortKey === "amount_asc" || advancedFilters.sortKey === "amount_desc"
        ? "amount"
        : "transaction_date",
    sortDirection: advancedFilters.sortKey === "date_asc" || advancedFilters.sortKey === "amount_asc" ? "asc" : "desc",
  }
  const applySavedFilter = (record: TransactionSavedFilterRecord) => {
    const data = record.data
    const sortKey: SortKey =
      data.sortBy === "amount"
        ? data.sortDirection === "asc"
          ? "amount_asc"
          : "amount_desc"
        : data.sortDirection === "asc"
          ? "date_asc"
          : "date_desc"
    const draft: AdvancedFilterDraft = {
      status: data.status ?? "all",
      dateFrom: data.dateFrom ?? "",
      dateTo: data.dateTo ?? "",
      amountMinText: data.amountMinMinor === null ? "" : minorAmountToInput(data.amountMinMinor),
      amountMaxText: data.amountMaxMinor === null ? "" : minorAmountToInput(data.amountMaxMinor),
      categoryId: data.categoryId ?? "",
      paymentMethodId: data.paymentMethodId ?? "",
      householdMemberId: data.householdMemberId ?? "",
      locationId: data.locationId ?? "",
      sortKey,
    }
    setSearch(data.search)
    setTransactionType(data.transactionType ?? "all")
    setAdvancedDraft(draft)
    setAdvancedFilters({
      status: draft.status,
      dateFrom: draft.dateFrom,
      dateTo: draft.dateTo,
      amountMinMinor: data.amountMinMinor ?? undefined,
      amountMaxMinor: data.amountMaxMinor ?? undefined,
      categoryId: draft.categoryId,
      paymentMethodId: draft.paymentMethodId,
      householdMemberId: draft.householdMemberId,
      locationId: draft.locationId,
      sortKey,
    })
    setPage(0)
    setRowSelection({})
    toast.success(t("transactions.filterApplied", { name: record.name }))
  }

  return (
    <>
      <PageHeader
        title={t("transactions.title")}
        description={t("transactions.count", { count: visibleTotal })}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setSafeQueryOpen(true)}>
              <SparklesIcon data-icon="inline-start" />
              {t("safeQuery.action")}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/import">
                <UploadIcon aria-hidden="true" />
                {t("transactions.importCsv")}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={savedFilters.isLoading}>
                  <SlidersHorizontalIcon data-icon="inline-start" />
                  {t("transactions.savedFilters")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setSaveFilterOpen(true)}>
                    <BookmarkPlusIcon aria-hidden="true" />
                    {t("transactions.saveCurrentFilter")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuLabel>{t("transactions.savedFilters")}</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {savedFilters.data?.length ? (
                    savedFilters.data.map((filter) => (
                      <DropdownMenuItem key={filter.id} onSelect={() => applySavedFilter(filter)}>
                        <SlidersHorizontalIcon aria-hidden="true" />
                        <span className="truncate">{filter.name}</span>
                        {filter.isPinned ? <Badge variant="secondary">{t("transactions.pinned")}</Badge> : null}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>{t("transactions.noSavedFilters")}</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={templates.isLoading || useTemplateMutation.isPending}>
                  <LayoutTemplateIcon data-icon="inline-start" />
                  {t("transactions.templates")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{t("transactions.templates")}</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {templates.data?.length ? (
                    templates.data.map((template) => (
                      <DropdownMenuItem key={template.id} onSelect={() => useTemplateMutation.mutate(template.id)}>
                        <LayoutTemplateIcon aria-hidden="true" />
                        <span className="truncate">{template.name}</span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>{t("transactions.noTemplates")}</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setEditor({ mode: "create" })}>
              <PlusIcon data-icon="inline-start" />
              {t("transactions.add")}
            </Button>
          </div>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-8">
        {safeQuery ? (
          <Alert>
            <SparklesIcon aria-hidden="true" />
            <AlertTitle>{t("safeQuery.activeTitle")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{safeQuery.plan.explanation}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSafeQuery(null)
                  setPage(0)
                  setRowSelection({})
                }}
              >
                {t("safeQuery.clear")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <InputGroup className="md:max-w-sm">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
                setRowSelection({})
              }}
              aria-label={t("transactions.searchPlaceholder")}
              placeholder={t("transactions.searchPlaceholder")}
            />
          </InputGroup>
          <ToggleGroup
            type="single"
            value={transactionType}
            onValueChange={(value) => {
              if (!value) return
              setTransactionType(value as "all" | TransactionType)
              setPage(0)
              setRowSelection({})
            }}
            variant="outline"
            aria-label={t("transactions.typeFilter")}
          >
            <ToggleGroupItem value="all">{t("transactions.all")}</ToggleGroupItem>
            <ToggleGroupItem value="expense">{t("transactions.types.expense")}</ToggleGroupItem>
            <ToggleGroupItem value="income">{t("transactions.types.income")}</ToggleGroupItem>
            <ToggleGroupItem value="transfer">{t("transactions.types.transfer")}</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" className="md:ml-auto" onClick={() => setAdvancedOpen((open) => !open)}>
            <SlidersHorizontalIcon data-icon="inline-start" />
            {t("transactions.advancedFilters")}
          </Button>
        </div>

        {advancedOpen ? (
          <AdvancedFiltersPanel
            draft={advancedDraft}
            onChange={setAdvancedDraft}
            categories={referenceData.data?.categories.filter((category) => category.isActive) ?? []}
            paymentMethods={referenceData.data?.paymentMethods.filter((method) => method.isActive) ?? []}
            householdMembers={referenceData.data?.householdMembers.filter((member) => member.isActive) ?? []}
            locations={referenceData.data?.locations.filter((location) => location.isActive) ?? []}
            onApply={applyAdvancedFilters}
            onClear={clearAdvancedFilters}
          />
        ) : null}

        {selectedRecords.length ? (
          <div
            className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center"
            role="toolbar"
            aria-label={t("transactions.selectedCount", { count: selectedRecords.length })}
          >
            <span className="text-sm font-medium">
              {t("transactions.selectedCount", { count: selectedRecords.length })}
            </span>
            <Button type="button" variant="outline" onClick={() => setBatchEditRecords(selectedRecords)}>
              <ListChecksIcon data-icon="inline-start" />
              {i18n.language.startsWith("zh") ? "批量编辑" : "Batch edit"}
            </Button>
            <Button
              variant="destructive"
              className="sm:ml-auto"
              disabled={batchDeleteMutation.isPending}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2Icon data-icon="inline-start" />
              {t("transactions.batchDelete")}
            </Button>
          </div>
        ) : null}

        <section className="min-h-96 overflow-hidden rounded-lg border bg-card" aria-label={t("transactions.title")}>
          {transactions.isLoading ? <TransactionsSkeleton /> : null}
          {transactions.isError ? (
            <Empty className="min-h-96">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleAlertIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("transactions.loadError")}</EmptyTitle>
                <EmptyDescription>{t("transactions.loadErrorDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {transactions.data?.records.length === 0 ? (
            <Empty className="min-h-96">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  {search || transactionType !== "all" || hasAdvancedFilters
                    ? t("transactions.noMatches")
                    : t("transactions.empty")}
                </EmptyTitle>
                <EmptyDescription>{t("transactions.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {transactions.data?.records.length ? (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    aria-rowindex={row.index + 2}
                    className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onKeyDown={handleTransactionRowKeyDown}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
        {transactions.data?.total ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {t("transactions.pageStatus", { page: page + 1, pages: pageCount })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || transactions.isFetching}
                onClick={() => {
                  setPage((current) => Math.max(0, current - 1))
                  setRowSelection({})
                }}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                {t("transactions.previousPage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount || transactions.isFetching}
                onClick={() => {
                  setPage((current) => current + 1)
                  setRowSelection({})
                }}
              >
                {t("transactions.nextPage")}
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </div>
        ) : null}
      </main>
      <TransactionFormSheet
        editor={activeEditor}
        onOpenChange={(open) => {
          if (open) return
          setEditor(null)
          clearFocusedResult()
        }}
      />
      <SafeQuerySheet
        open={safeQueryOpen}
        onOpenChange={setSafeQueryOpen}
        onApply={(validated) => {
          setSearch("")
          setTransactionType("all")
          setAdvancedDraft(emptyAdvancedFilters)
          setAdvancedFilters(emptyAppliedFilters)
          setSafeQuery(validated)
          setPage(0)
          setRowSelection({})
          toast.success(t("safeQuery.applied"))
        }}
      />
      <AiSuggestionsSheet
        key={aiTarget?.id ?? "closed-ai-suggestions"}
        target={aiTarget}
        onOpenChange={(open) => !open && setAiTarget(null)}
      />
      <AttachmentSheet
        target={activeAttachmentTarget}
        onOpenChange={(open) => {
          if (open) return
          setAttachmentTarget(null)
          clearFocusedResult()
        }}
      />
      <TemplateSaveSheet source={templateSource} onOpenChange={(open) => !open && setTemplateSource(null)} />
      <SavedFilterSheet open={saveFilterOpen} data={currentSavedFilterData} onOpenChange={setSaveFilterOpen} />
      {batchEditRecords && referenceData.data ? (
        <BatchEditSheet
          records={batchEditRecords}
          referenceData={referenceData.data}
          onClose={() => setBatchEditRecords(null)}
          onApplied={() => setRowSelection({})}
        />
      ) : null}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("transactions.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("transactions.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("transactions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, version: deleteTarget.version })
              }
            >
              {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("transactions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("transactions.batchDeleteTitle", { count: selectedRecords.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t("transactions.batchDeleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("transactions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={batchDeleteMutation.isPending}
              onClick={() => batchDeleteMutation.mutate({ items: selectedItems })}
            >
              {batchDeleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("transactions.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AttachmentSheet({
  target,
  onOpenChange,
}: {
  target: TransactionRecord | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const description = target?.merchant ?? target?.note ?? target?.transactionDate ?? ""
  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("attachments.title")}</SheetTitle>
          <SheetDescription>
            {target ? `${target.transactionDate} · ${description}` : t("attachments.description")}
          </SheetDescription>
        </SheetHeader>
        {target ? (
          <div className="px-4">
            <AttachmentManager ownerType="transaction" ownerId={target.id} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function TransactionFormSheet({
  editor,
  onOpenChange,
}: {
  editor: EditorState | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const open = Boolean(editor)
  const referenceData = useQuery({
    queryKey: ["transaction-reference-data"],
    queryFn: commandGateway.listTransactionReferenceData,
    enabled: open,
  })
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: formValuesFor(editor?.record, editor?.template),
  })
  useEffect(() => {
    if (open) form.reset(formValuesFor(editor?.record, editor?.template))
  }, [editor, form, open])
  useEffect(() => {
    if (!editor?.template || !referenceData.data) return
    const activeCategories = new Set(
      referenceData.data.categories.filter((category) => category.isActive).map((category) => category.id),
    )
    const activeMethods = new Set(
      referenceData.data.paymentMethods.filter((method) => method.isActive).map((method) => method.id),
    )
    if (form.getValues("categoryId") && !activeCategories.has(form.getValues("categoryId"))) {
      form.setValue("categoryId", "")
    }
    if (form.getValues("paymentMethodId") && !activeMethods.has(form.getValues("paymentMethodId"))) {
      form.setValue("paymentMethodId", "")
    }
    if (
      form.getValues("transferToPaymentMethodId") &&
      !activeMethods.has(form.getValues("transferToPaymentMethodId"))
    ) {
      form.setValue("transferToPaymentMethodId", "")
    }
  }, [editor?.template, form, referenceData.data])
  useEffect(() => {
    if (!open || !referenceData.data || editor?.mode === "edit" || form.getValues("householdMemberId")) return
    const defaultMember = referenceData.data.householdMembers.find((member) => member.isDefault && member.isActive)
    if (defaultMember) form.setValue("householdMemberId", defaultMember.id)
  }, [editor?.mode, form, open, referenceData.data])
  const watchedType = useWatch({ control: form.control, name: "transactionType" })
  const watchedMerchant = useWatch({ control: form.control, name: "merchant" })
  const deferredMerchant = useDeferredValue(watchedMerchant.trim())
  const suggestion = useQuery({
    queryKey: ["transaction-suggestion", watchedType, deferredMerchant.toLocaleLowerCase()],
    queryFn: () => commandGateway.suggestTransaction({ merchant: deferredMerchant, transactionType: watchedType }),
    enabled: open && watchedType !== "transfer" && deferredMerchant.length >= 2,
    staleTime: 30_000,
  })
  const mutation = useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      editor?.mode === "edit" && editor.record
        ? commandGateway.updateTransaction({ id: editor.record.id, version: editor.record.version, ...input })
        : commandGateway.createTransaction(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t(editor?.mode === "edit" ? "transactions.updated" : "transactions.created"))
      form.reset()
      onOpenChange(false)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.createError")),
  })
  const categories =
    referenceData.data?.categories.filter((category) => category.isActive && category.categoryType === watchedType) ??
    []
  const paymentMethods = referenceData.data?.paymentMethods.filter((method) => method.isActive) ?? []
  const householdMembers = referenceData.data?.householdMembers.filter((member) => member.isActive) ?? []
  const locations = referenceData.data?.locations.filter((location) => location.isActive) ?? []

  const submit = (values: TransactionFormValues) => {
    const transfer = values.transactionType === "transfer"
    mutation.mutate({
      transactionDate: values.transactionDate,
      transactionType: values.transactionType,
      status: values.status,
      amountMinor: parseMoneyToMinor(values.amountText),
      currencyCode: values.currencyCode,
      categoryId: transfer ? null : values.categoryId || null,
      paymentMethodId: values.paymentMethodId || null,
      transferToPaymentMethodId: transfer ? values.transferToPaymentMethodId || null : null,
      transferToAmountMinor: transfer ? parseMoneyToMinor(values.transferAmountText) : null,
      transferToCurrencyCode: transfer ? values.transferToCurrencyCode : null,
      householdMemberId: values.householdMemberId || null,
      locationId: values.locationId || null,
      merchant: values.merchant || null,
      note: values.note || null,
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t(
              editor?.mode === "edit"
                ? "transactions.editTitle"
                : editor?.mode === "copy"
                  ? "transactions.copyTitle"
                  : editor?.mode === "template" && editor.template
                    ? "transactions.applyTemplate"
                    : "transactions.add",
              editor?.template ? { name: editor.template.name } : undefined,
            )}
          </SheetTitle>
          <SheetDescription>{t("transactions.formDescription")}</SheetDescription>
        </SheetHeader>
        <form id="transaction-form" onSubmit={form.handleSubmit(submit)} className="px-4" noValidate>
          <FieldGroup>
            <Controller
              control={form.control}
              name="transactionType"
              render={({ field }) => (
                <Field>
                  <FieldLabel>{t("transactions.type")}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                    variant="outline"
                    className="w-full"
                  >
                    <ToggleGroupItem value="expense" className="flex-1">
                      {t("transactions.types.expense")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="income" className="flex-1">
                      {t("transactions.types.income")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="transfer" className="flex-1">
                      {t("transactions.types.transfer")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}
            />
            <TextInputField control={form.control} name="transactionDate" label={t("transactions.date")} type="date" />
            <TextInputField
              control={form.control}
              name="amountText"
              label={transferLabel(watchedType, t)}
              inputMode="decimal"
              placeholder="0.00"
            />
            <TextInputField
              control={form.control}
              name="currencyCode"
              label={t("transactions.currency")}
              maxLength={3}
              transform="uppercase"
            />
            {watchedType !== "transfer" ? <CategoryField control={form.control} categories={categories} /> : null}
            <SelectField
              control={form.control}
              name="paymentMethodId"
              label={watchedType === "transfer" ? t("transactions.fromAccount") : t("transactions.paymentMethod")}
              items={paymentMethods.map((method) => ({ value: method.id, label: method.displayName }))}
              allowEmpty={watchedType !== "transfer"}
            />
            {watchedType === "transfer" ? (
              <>
                <SelectField
                  control={form.control}
                  name="transferToPaymentMethodId"
                  label={t("transactions.toAccount")}
                  items={paymentMethods.map((method) => ({ value: method.id, label: method.displayName }))}
                />
                <TextInputField
                  control={form.control}
                  name="transferAmountText"
                  label={t("transactions.toAmount")}
                  inputMode="decimal"
                  placeholder="0.00"
                />
                <TextInputField
                  control={form.control}
                  name="transferToCurrencyCode"
                  label={t("transactions.toCurrency")}
                  maxLength={3}
                  transform="uppercase"
                />
              </>
            ) : null}
            <SelectField
              control={form.control}
              name="status"
              label={t("transactions.status")}
              items={(["planned", "pending", "completed", "cancelled"] as const).map((value) => ({
                value,
                label: t(`transactions.statuses.${value}`),
              }))}
            />
            <SelectField
              control={form.control}
              name="householdMemberId"
              label={t("transactions.householdMember")}
              items={householdMembers.map((member) => ({ value: member.id, label: member.displayName }))}
              allowEmpty
            />
            <SelectField
              control={form.control}
              name="locationId"
              label={t("transactions.location")}
              items={locations.map((location) => ({
                value: location.id,
                label: location.city ? `${location.name} · ${location.city}` : location.name,
              }))}
              allowEmpty
            />
            <TextInputField
              control={form.control}
              name="merchant"
              label={t("transactions.merchant")}
              placeholder={t("transactions.merchantPlaceholder")}
            />
            {suggestion.data?.matchedCount ? (
              <TransactionSuggestionPanel
                suggestion={suggestion.data}
                categories={referenceData.data?.categories ?? []}
                paymentMethods={paymentMethods}
                householdMembers={householdMembers}
                locations={locations}
                onApplyCategory={(value) => form.setValue("categoryId", value)}
                onApplyPaymentMethod={(value) => form.setValue("paymentMethodId", value)}
                onApplyHouseholdMember={(value) => form.setValue("householdMemberId", value)}
                onApplyLocation={(value) => form.setValue("locationId", value)}
                onApplyAmount={(value) => form.setValue("amountText", minorAmountToInput(value))}
                onApplyNote={(value) => form.setValue("note", value)}
              />
            ) : null}
            <Controller
              control={form.control}
              name="note"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="transaction-note">{t("transactions.note")}</FieldLabel>
                  <Textarea {...field} id="transaction-note" aria-invalid={fieldState.invalid} rows={3} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            {referenceData.isError ? <FieldDescription>{t("transactions.referenceError")}</FieldDescription> : null}
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="transaction-form" disabled={mutation.isPending || referenceData.isLoading}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {mutation.isPending ? t("transactions.saving") : t("transactions.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

type TextFieldName =
  "transactionDate" | "amountText" | "currencyCode" | "transferAmountText" | "transferToCurrencyCode" | "merchant"

function TextInputField({
  control,
  name,
  label,
  transform,
  ...inputProps
}: { control: Control<TransactionFormValues>; name: TextFieldName; label: string; transform?: "uppercase" } & Omit<
  React.ComponentProps<typeof Input>,
  "name"
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`transaction-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            {...inputProps}
            id={`transaction-${name}`}
            aria-invalid={fieldState.invalid}
            onChange={(event) =>
              field.onChange(transform === "uppercase" ? event.target.value.toUpperCase() : event.target.value)
            }
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function CategoryField({ control, categories }: { control: Control<TransactionFormValues>; categories: Category[] }) {
  const { t } = useTranslation()
  return (
    <SelectField
      control={control}
      name="categoryId"
      label={t("transactions.category")}
      items={categories.map((category) => ({
        value: category.id,
        label: category.parentName ? `${category.parentName} → ${category.name}` : category.name,
      }))}
      allowEmpty
    />
  )
}

function SelectField({
  control,
  name,
  label,
  items,
  allowEmpty = false,
}: {
  control: Control<TransactionFormValues>
  name: "categoryId" | "paymentMethodId" | "transferToPaymentMethodId" | "status" | "householdMemberId" | "locationId"
  label: string
  items: Array<{ value: string; label: string }>
  allowEmpty?: boolean
}) {
  const { t } = useTranslation()
  const fieldId = `transaction-${name}`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
          <Select
            value={field.value || "__empty"}
            onValueChange={(value) => field.onChange(value === "__empty" ? "" : value)}
          >
            <SelectTrigger id={fieldId} aria-invalid={fieldState.invalid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {allowEmpty ? <SelectItem value="__empty">{t("transactions.notSet")}</SelectItem> : null}
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function TransactionSuggestionPanel({
  suggestion,
  categories,
  paymentMethods,
  householdMembers,
  locations,
  onApplyCategory,
  onApplyPaymentMethod,
  onApplyHouseholdMember,
  onApplyLocation,
  onApplyAmount,
  onApplyNote,
}: {
  suggestion: TransactionSuggestion
  categories: Category[]
  paymentMethods: PaymentMethod[]
  householdMembers: HouseholdMember[]
  locations: Location[]
  onApplyCategory: (value: string) => void
  onApplyPaymentMethod: (value: string) => void
  onApplyHouseholdMember: (value: string) => void
  onApplyLocation: (value: string) => void
  onApplyAmount: (value: number) => void
  onApplyNote: (value: string) => void
}) {
  const { t } = useTranslation()
  const category = categories.find((item) => item.id === suggestion.categoryId)
  const paymentMethod = paymentMethods.find((item) => item.id === suggestion.paymentMethodId)
  const householdMember = householdMembers.find((item) => item.id === suggestion.householdMemberId)
  const location = locations.find((item) => item.id === suggestion.locationId)
  const suggestedAmount = suggestion.amountMinor
  const suggestedNote = suggestion.note
  return (
    <section className="grid gap-2 rounded-lg border bg-muted/40 p-3" aria-label={t("transactions.historySuggestions")}>
      <div>
        <p className="text-sm font-medium">
          {t("transactions.historySuggestionCount", { count: suggestion.matchedCount })}
        </p>
        <p className="text-xs text-muted-foreground">{t("transactions.suggestionConfirmation")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {category ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyCategory(category.id)}>
            {t("transactions.suggestedCategory", { name: category.name })}
          </Button>
        ) : null}
        {paymentMethod ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyPaymentMethod(paymentMethod.id)}>
            {t("transactions.suggestedPayment", { name: paymentMethod.displayName })}
          </Button>
        ) : null}
        {householdMember ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyHouseholdMember(householdMember.id)}>
            {t("transactions.suggestedMember", { name: householdMember.displayName })}
          </Button>
        ) : null}
        {location ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyLocation(location.id)}>
            {t("transactions.suggestedLocation", { name: location.name })}
          </Button>
        ) : null}
        {suggestedAmount !== null ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyAmount(suggestedAmount)}>
            {t("transactions.suggestedAmount", { amount: minorAmountToInput(suggestedAmount) })}
          </Button>
        ) : null}
        {suggestedNote ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApplyNote(suggestedNote)}>
            {t("transactions.suggestedNote")}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function AdvancedFiltersPanel({
  draft,
  onChange,
  categories,
  paymentMethods,
  householdMembers,
  locations,
  onApply,
  onClear,
}: {
  draft: AdvancedFilterDraft
  onChange: (value: AdvancedFilterDraft) => void
  categories: Category[]
  paymentMethods: PaymentMethod[]
  householdMembers: HouseholdMember[]
  locations: Location[]
  onApply: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <section
      className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label={t("transactions.advancedFilters")}
    >
      <div className="grid gap-2">
        <Label htmlFor="filter-date-from">{t("transactions.dateFrom")}</Label>
        <Input
          id="filter-date-from"
          type="date"
          value={draft.dateFrom}
          onChange={(event) => onChange({ ...draft, dateFrom: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="filter-date-to">{t("transactions.dateTo")}</Label>
        <Input
          id="filter-date-to"
          type="date"
          value={draft.dateTo}
          onChange={(event) => onChange({ ...draft, dateTo: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="filter-amount-min">{t("transactions.amountMin")}</Label>
        <Input
          id="filter-amount-min"
          inputMode="decimal"
          placeholder="0.00"
          value={draft.amountMinText}
          onChange={(event) => onChange({ ...draft, amountMinText: event.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="filter-amount-max">{t("transactions.amountMax")}</Label>
        <Input
          id="filter-amount-max"
          inputMode="decimal"
          placeholder="0.00"
          value={draft.amountMaxText}
          onChange={(event) => onChange({ ...draft, amountMaxText: event.target.value })}
        />
      </div>
      <FilterSelect
        id="filter-status"
        label={t("transactions.status")}
        value={draft.status}
        onValueChange={(value) => onChange({ ...draft, status: value as AdvancedFilterDraft["status"] })}
        items={[
          { value: "all", label: t("transactions.all") },
          ...(["planned", "pending", "completed", "cancelled"] as const).map((value) => ({
            value,
            label: t(`transactions.statuses.${value}`),
          })),
        ]}
      />
      <FilterSelect
        id="filter-category"
        label={t("transactions.category")}
        value={draft.categoryId || "all"}
        onValueChange={(value) => onChange({ ...draft, categoryId: value === "all" ? "" : value })}
        items={[
          { value: "all", label: t("transactions.all") },
          ...categories.map((category) => ({
            value: category.id,
            label: category.parentName ? `${category.parentName} → ${category.name}` : category.name,
          })),
        ]}
      />
      <FilterSelect
        id="filter-payment-method"
        label={t("transactions.paymentMethod")}
        value={draft.paymentMethodId || "all"}
        onValueChange={(value) => onChange({ ...draft, paymentMethodId: value === "all" ? "" : value })}
        items={[
          { value: "all", label: t("transactions.all") },
          ...paymentMethods.map((method) => ({ value: method.id, label: method.displayName })),
        ]}
      />
      <FilterSelect
        id="filter-household-member"
        label={t("transactions.householdMember")}
        value={draft.householdMemberId || "all"}
        onValueChange={(value) => onChange({ ...draft, householdMemberId: value === "all" ? "" : value })}
        items={[
          { value: "all", label: t("transactions.all") },
          ...householdMembers.map((member) => ({ value: member.id, label: member.displayName })),
        ]}
      />
      <FilterSelect
        id="filter-location"
        label={t("transactions.location")}
        value={draft.locationId || "all"}
        onValueChange={(value) => onChange({ ...draft, locationId: value === "all" ? "" : value })}
        items={[
          { value: "all", label: t("transactions.all") },
          ...locations.map((location) => ({ value: location.id, label: location.name })),
        ]}
      />
      <FilterSelect
        id="filter-sort"
        label={t("transactions.sort")}
        value={draft.sortKey}
        onValueChange={(value) => onChange({ ...draft, sortKey: value as SortKey })}
        items={(
          [
            ["date_desc", "sortDateDesc"],
            ["date_asc", "sortDateAsc"],
            ["amount_desc", "sortAmountDesc"],
            ["amount_asc", "sortAmountAsc"],
          ] as const
        ).map(([value, label]) => ({ value, label: t(`transactions.${label}`) }))}
      />
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4 lg:justify-end">
        <Button variant="outline" onClick={onClear}>
          {t("transactions.clearFilters")}
        </Button>
        <Button onClick={onApply}>{t("transactions.applyFilters")}</Button>
      </div>
    </section>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onValueChange,
  items,
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  items: Array<{ value: string; label: string }>
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

const templateNameSchema = z.object({
  name: z.string().trim().min(1, "请输入模板名称").max(120, "模板名称不能超过 120 个字符"),
})
type TemplateNameValues = z.infer<typeof templateNameSchema>

function TemplateSaveSheet({
  source,
  onOpenChange,
}: {
  source: TransactionRecord | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<TemplateNameValues>({
    resolver: zodResolver(templateNameSchema),
    defaultValues: { name: "" },
  })
  useEffect(() => {
    if (source) form.reset({ name: source.merchant ?? source.categoryName ?? source.transactionDate })
  }, [form, source])
  const mutation = useMutation({
    mutationFn: ({ name }: TemplateNameValues) => {
      if (!source) throw new Error(t("transactions.templateError"))
      return commandGateway.saveTransactionTemplate({
        id: null,
        name,
        data: {
          transactionType: source.transactionType,
          status: source.status,
          amountMinor: source.amountMinor,
          currencyCode: source.currencyCode,
          categoryId: source.categoryId,
          paymentMethodId: source.paymentMethodId,
          transferToPaymentMethodId: source.transferToPaymentMethodId,
          transferToAmountMinor: source.transferToAmountMinor,
          transferToCurrencyCode: source.transferToCurrencyCode,
          merchant: source.merchant,
          note: source.note,
        },
        isActive: true,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-templates"] })
      toast.success(t("transactions.templateSaved"))
      onOpenChange(false)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.templateError")),
  })
  return (
    <Sheet open={Boolean(source)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("transactions.saveTemplateTitle")}</SheetTitle>
          <SheetDescription>{t("transactions.templateDescription")}</SheetDescription>
        </SheetHeader>
        <form
          id="transaction-template-form"
          className="px-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="transaction-template-name">{t("transactions.templateName")}</FieldLabel>
                <Input {...field} id="transaction-template-name" aria-invalid={fieldState.invalid} autoFocus />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </form>
        <SheetFooter>
          <Button type="submit" form="transaction-template-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {mutation.isPending ? t("transactions.saving") : t("transactions.saveAsTemplate")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const savedFilterNameSchema = z.object({
  name: z.string().trim().min(1, "请输入筛选名称").max(120, "筛选名称不能超过 120 个字符"),
  isPinned: z.boolean(),
})
type SavedFilterNameValues = z.infer<typeof savedFilterNameSchema>

function SavedFilterSheet({
  open,
  data,
  onOpenChange,
}: {
  open: boolean
  data: TransactionSavedFilterData
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<SavedFilterNameValues>({
    resolver: zodResolver(savedFilterNameSchema),
    defaultValues: { name: "", isPinned: false },
  })
  useEffect(() => {
    if (open) form.reset({ name: "", isPinned: false })
  }, [form, open])
  const mutation = useMutation({
    mutationFn: (values: SavedFilterNameValues) =>
      commandGateway.saveTransactionFilter({
        id: null,
        name: values.name,
        data,
        isPinned: values.isPinned,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transaction-filters"] })
      toast.success(t("transactions.filterSaved"))
      onOpenChange(false)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("transactions.filterError")),
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("transactions.saveFilterTitle")}</SheetTitle>
          <SheetDescription>{t("transactions.saveFilterDescription")}</SheetDescription>
        </SheetHeader>
        <form id="saved-filter-form" className="px-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="saved-filter-name">{t("transactions.filterName")}</FieldLabel>
                  <Input {...field} id="saved-filter-name" aria-invalid={fieldState.invalid} autoFocus />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="isPinned"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldLabel className="flex-1" htmlFor="saved-filter-pinned">
                    {t("transactions.pinFilter")}
                  </FieldLabel>
                  <Switch id="saved-filter-pinned" checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="saved-filter-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(mutation.isPending ? "transactions.saving" : "transactions.saveCurrentFilter")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function AiSuggestionsSheet({
  target,
  onOpenChange,
}: {
  target: TransactionRecord | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const open = Boolean(target)
  const [selectedTypes, setSelectedTypes] = useState<AiSuggestionType[]>(() =>
    target?.transactionType === "transfer" ? ["anomaly_explanation"] : ["category", "tax_tag", "anomaly_explanation"],
  )
  const [scopeConfirmed, setScopeConfirmed] = useState(false)
  const suggestions = useQuery({
    queryKey: ["ai-suggestions", target?.id],
    queryFn: () => commandGateway.listAiSuggestions({ transactionId: target!.id }),
    enabled: open,
  })
  const generate = useMutation({
    mutationFn: commandGateway.generateAiSuggestions,
    onSuccess: async () => {
      setScopeConfirmed(false)
      await queryClient.invalidateQueries({ queryKey: ["ai-suggestions", target?.id] })
    },
  })
  const review = useMutation({
    mutationFn: commandGateway.reviewAiSuggestion,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-suggestions", target?.id] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-report"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] }),
      ])
    },
  })
  const toggleType = (type: AiSuggestionType, checked: boolean) =>
    setSelectedTypes((current) =>
      checked ? [...current.filter((item) => item !== type), type] : current.filter((item) => item !== type),
    )
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BotIcon className="size-5" aria-hidden="true" />
            {t("transactions.aiSuggestionsTitle")}
          </SheetTitle>
          <SheetDescription>
            {t("transactions.aiSuggestionsDescription", {
              description: target?.merchant ?? target?.note ?? target?.transactionDate,
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-6">
          <div className="grid gap-2">
            <Label>{t("transactions.aiSuggestionTypes")}</Label>
            {(["category", "tax_tag", "anomaly_explanation"] as const).map((type) => {
              const unavailable = target?.transactionType === "transfer" && type !== "anomaly_explanation"
              return (
                <label key={type} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <Checkbox
                    checked={selectedTypes.includes(type)}
                    disabled={unavailable}
                    onCheckedChange={(checked) => toggleType(type, checked === true)}
                  />
                  <span>{t(`transactions.aiSuggestionTypeLabels.${type}`)}</span>
                </label>
              )
            })}
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{t("transactions.aiRecordScopeTitle")}</p>
            <p className="mt-1 text-muted-foreground">{t("transactions.aiRecordScopeDescription")}</p>
          </div>
          <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <Checkbox checked={scopeConfirmed} onCheckedChange={(checked) => setScopeConfirmed(checked === true)} />
            <span>{t("transactions.aiRecordScopeConfirm")}</span>
          </label>
          <Button
            variant="outline"
            disabled={!target || !scopeConfirmed || selectedTypes.length === 0 || generate.isPending}
            onClick={() =>
              target &&
              generate.mutate({
                transactionId: target.id,
                suggestionTypes: selectedTypes,
                locale: i18n.language === "en-CA" ? "en-CA" : "zh-CN",
                recordScopeConfirmed: true,
              })
            }
          >
            {generate.isPending ? <Spinner data-icon="inline-start" /> : <BotIcon data-icon="inline-start" />}
            {t(generate.isPending ? "transactions.aiGenerating" : "transactions.aiGenerateSuggestions")}
          </Button>
          {generate.isError ? (
            <p className="text-sm text-destructive">
              {generate.error instanceof Error ? generate.error.message : t("transactions.aiGenerateError")}
            </p>
          ) : null}
          <div className="grid gap-3">
            <Label>{t("transactions.aiSuggestionHistory")}</Label>
            {suggestions.isLoading ? <Skeleton className="h-32 w-full" /> : null}
            {suggestions.data?.length ? (
              suggestions.data
                .slice(0, 20)
                .map((suggestion) => (
                  <AiSuggestionItem
                    key={suggestion.id}
                    suggestion={suggestion}
                    busy={review.isPending}
                    onReview={(decision) => review.mutate({ id: suggestion.id, decision })}
                  />
                ))
            ) : !suggestions.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("transactions.aiNoSuggestions")}</p>
            ) : null}
            {suggestions.isError || review.isError ? (
              <p className="text-sm text-destructive">{t("transactions.aiSuggestionActionError")}</p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function AiSuggestionItem({
  suggestion,
  busy,
  onReview,
}: {
  suggestion: AiSuggestionRecord
  busy: boolean
  onReview: (decision: "accepted" | "rejected") => void
}) {
  const { t } = useTranslation()
  const value =
    suggestion.suggestionType === "category"
      ? suggestion.suggestedValue.categoryName
      : suggestion.suggestionType === "tax_tag"
        ? suggestion.suggestedValue.taxTagName
        : t("transactions.aiExplanationOnly")
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(`transactions.aiSuggestionTypeLabels.${suggestion.suggestionType}`)}</Badge>
        <Badge variant="secondary">{t(`transactions.aiSuggestionStatuses.${suggestion.status}`)}</Badge>
        {typeof value === "string" ? <span className="font-medium">{value}</span> : null}
      </div>
      {suggestion.explanation ? <p className="text-sm text-muted-foreground">{suggestion.explanation}</p> : null}
      {suggestion.suggestionType === "tax_tag" ? (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t("reports.taxCandidateDisclaimer")}</p>
      ) : null}
      {suggestion.status === "pending" ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview("rejected")}>
            {t("transactions.aiRejectSuggestion")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onReview("accepted")}>
            {t("transactions.aiAcceptSuggestion")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TransactionRowActions({
  record,
  onEdit,
  onCopy,
  onSaveTemplate,
  onAiSuggestions,
  onAttachments,
  onDelete,
}: {
  record: TransactionRecord
  onEdit: () => void
  onCopy: () => void
  onSaveTemplate: () => void
  onAiSuggestions: () => void
  onAttachments: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const description = record.merchant ?? record.note ?? record.transactionDate
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("transactions.moreActions", { description })}>
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon aria-hidden="true" />
            {t("transactions.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopy}>
            <CopyIcon aria-hidden="true" />
            {t("transactions.copy")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSaveTemplate}>
            <BookmarkPlusIcon aria-hidden="true" />
            {t("transactions.saveAsTemplate")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAiSuggestions}>
            <BotIcon aria-hidden="true" />
            {t("transactions.aiSuggestions")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAttachments}>
            <PaperclipIcon aria-hidden="true" />
            {t("attachments.title")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon aria-hidden="true" />
            {t("transactions.delete")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formValuesFor(record?: TransactionRecord, template?: TransactionTemplateRecord): TransactionFormValues {
  if (template) {
    const data = template.data
    return {
      transactionDate: format(new Date(), "yyyy-MM-dd"),
      transactionType: data.transactionType,
      status: data.status,
      amountText: minorAmountToInput(data.amountMinor),
      currencyCode: data.currencyCode,
      categoryId: data.categoryId ?? "",
      paymentMethodId: data.paymentMethodId ?? "",
      householdMemberId: "",
      locationId: "",
      transferToPaymentMethodId: data.transferToPaymentMethodId ?? "",
      transferAmountText: data.transferToAmountMinor === null ? "" : minorAmountToInput(data.transferToAmountMinor),
      transferToCurrencyCode: data.transferToCurrencyCode ?? "CAD",
      merchant: data.merchant ?? "",
      note: data.note ?? "",
    }
  }
  return {
    transactionDate: record?.transactionDate ?? format(new Date(), "yyyy-MM-dd"),
    transactionType: record?.transactionType ?? "expense",
    status: record?.status ?? "completed",
    amountText: record ? minorAmountToInput(record.amountMinor) : "",
    currencyCode: record?.currencyCode ?? "CAD",
    categoryId: record?.categoryId ?? "",
    paymentMethodId: record?.paymentMethodId ?? "",
    householdMemberId: record?.householdMemberId ?? "",
    locationId: record?.locationId ?? "",
    transferToPaymentMethodId: record?.transferToPaymentMethodId ?? "",
    transferAmountText:
      record?.transferToAmountMinor === null || record?.transferToAmountMinor === undefined
        ? ""
        : minorAmountToInput(record.transferToAmountMinor),
    transferToCurrencyCode: record?.transferToCurrencyCode ?? "CAD",
    merchant: record?.merchant ?? "",
    note: record?.note ?? "",
  }
}

function TransactionsSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-14 items-center gap-4 border-b px-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  )
}

function transferLabel(type: TransactionType, t: ReturnType<typeof useTranslation>["t"]) {
  return type === "transfer" ? t("transactions.fromAmount") : t("transactions.amount")
}
