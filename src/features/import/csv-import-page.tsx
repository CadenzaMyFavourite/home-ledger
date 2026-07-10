import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { open } from "@tauri-apps/plugin-dialog"
import { ArrowLeftIcon, CircleAlertIcon, FileUpIcon, RotateCcwIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  commandGateway,
  type CsvImportAnalysis,
  type CsvImportCommitResult,
  type CsvImportMapping,
  type CsvImportPreview,
} from "@/lib/commands"

export function CsvImportPage() {
  const { i18n } = useTranslation()
  const zh = i18n.language !== "en-CA"
  const desktop = window.__TAURI_INTERNALS__ !== undefined
  const queryClient = useQueryClient()
  const [hasHeader, setHasHeader] = useState(true)
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const [analysis, setAnalysis] = useState<CsvImportAnalysis | null>(null)
  const [mapping, setMapping] = useState<CsvImportMapping | null>(null)
  const [forcedDuplicates, setForcedDuplicates] = useState<Set<number>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<CsvImportCommitResult | null>(null)
  const references = useQuery({
    queryKey: ["transaction-reference-data"],
    queryFn: commandGateway.listTransactionReferenceData,
  })
  const previewMutation = useMutation({
    mutationFn: commandGateway.previewCsvImport,
    onSuccess: (value) => {
      setPreview(value)
      setAnalysis(null)
      setResult(null)
      setForcedDuplicates(new Set())
      setConfirmed(false)
      setMapping(
        defaultMapping(value.headers, references.data?.paymentMethods.find((item) => item.isActive)?.id ?? null),
      )
    },
  })
  const analyzeMutation = useMutation({
    mutationFn: commandGateway.analyzeCsvImport,
    onSuccess: (value) => {
      setAnalysis(value)
      setConfirmed(false)
      setForcedDuplicates(new Set())
    },
  })
  const commitMutation = useMutation({
    mutationFn: commandGateway.commitCsvImport,
    onSuccess: async (value) => {
      setResult(value)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-report"] }),
        queryClient.invalidateQueries({ queryKey: ["tax-organizer"] }),
      ])
    },
  })
  const undoMutation = useMutation({
    mutationFn: commandGateway.undoCsvImport,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-report"] }),
      ])
    },
  })

  const chooseFile = async () => {
    const selected =
      import.meta.env.VITE_DESKTOP_E2E === "true" && window.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE__
        ? await window.__HOME_LEDGER_DESKTOP_E2E_OPEN_FILE__()
        : await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] })
    if (typeof selected === "string") previewMutation.mutate({ sourcePath: selected, hasHeader })
  }

  return (
    <>
      <PageHeader
        title={zh ? "导入 CSV 交易" : "Import CSV transactions"}
        description={
          zh
            ? "先预览和映射字段，再检查无效行与潜在重复；只有最后确认才写入数据库"
            : "Preview and map fields, review invalid and duplicate rows, then explicitly commit"
        }
        actions={
          <Button variant="outline" asChild>
            <Link to="/transactions">
              <ArrowLeftIcon aria-hidden="true" />
              {zh ? "返回收支记录" : "Back to transactions"}
            </Link>
          </Button>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-8">
        {!desktop ? (
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{zh ? "请在桌面应用中导入" : "Use the desktop app to import"}</AlertTitle>
            <AlertDescription>
              {zh
                ? "浏览器开发预览不能读取任意本地文件路径；Tauri 桌面应用会在本机完成解析，不上传文件。"
                : "Browser preview cannot read arbitrary local paths. The Tauri desktop app parses files locally and uploads nothing."}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{zh ? "1. 选择文件" : "1. Choose a file"}</CardTitle>
            <CardDescription>
              {zh
                ? "支持 UTF-8 / UTF-8 BOM，自动识别逗号、分号或制表符。文件不会离开电脑。"
                : "Supports UTF-8 / UTF-8 BOM and detects comma, semicolon, or tab delimiters. The file stays local."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={hasHeader} onCheckedChange={(value) => setHasHeader(value === true)} />
              {zh ? "第一行是列名" : "First row contains headers"}
            </label>
            <Button disabled={!desktop || previewMutation.isPending} onClick={chooseFile}>
              <FileUpIcon aria-hidden="true" />
              {previewMutation.isPending ? (zh ? "正在读取" : "Reading") : zh ? "选择 CSV" : "Choose CSV"}
            </Button>
            {preview ? (
              <span className="text-sm text-muted-foreground">
                {preview.sourceFilename} · {preview.totalRows} {zh ? "行" : "rows"}
              </span>
            ) : null}
          </CardContent>
        </Card>

        {preview && mapping ? (
          <MappingCard
            preview={preview}
            mapping={mapping}
            setMapping={setMapping}
            paymentMethods={references.data?.paymentMethods.filter((item) => item.isActive) ?? []}
            pending={analyzeMutation.isPending}
            zh={zh}
            onAnalyze={() => analyzeMutation.mutate({ batchId: preview.batchId, mapping })}
          />
        ) : null}

        {analysis && preview && mapping ? (
          <AnalysisCard
            analysis={analysis}
            forcedDuplicates={forcedDuplicates}
            setForcedDuplicates={setForcedDuplicates}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            pending={commitMutation.isPending}
            zh={zh}
            onCommit={() =>
              commitMutation.mutate({
                batchId: preview.batchId,
                mapping,
                importDuplicateRowNumbers: [...forcedDuplicates],
              })
            }
          />
        ) : null}

        {result ? (
          <Card className="border-emerald-300 dark:border-emerald-900">
            <CardHeader>
              <CardTitle>{zh ? "导入完成" : "Import complete"}</CardTitle>
              <CardDescription>
                {zh
                  ? `已导入 ${result.importedCount} 行，跳过 ${result.skippedDuplicateCount} 个潜在重复，${result.failedCount} 行失败。`
                  : `Imported ${result.importedCount}; skipped ${result.skippedDuplicateCount} potential duplicates; ${result.failedCount} failed.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/transactions">{zh ? "查看收支记录" : "View transactions"}</Link>
              </Button>
              <Button
                variant="outline"
                disabled={undoMutation.isPending || undoMutation.isSuccess}
                onClick={() => undoMutation.mutate({ batchId: result.batchId })}
              >
                <RotateCcwIcon aria-hidden="true" />
                {undoMutation.isSuccess ? (zh ? "已撤销" : "Undone") : zh ? "撤销整个批次" : "Undo entire batch"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {[previewMutation, analyzeMutation, commitMutation, undoMutation].map((mutation, index) =>
          mutation.isError ? (
            <p key={index} className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null,
        )}
      </main>
    </>
  )
}

function MappingCard({
  preview,
  mapping,
  setMapping,
  paymentMethods,
  pending,
  zh,
  onAnalyze,
}: {
  preview: CsvImportPreview
  mapping: CsvImportMapping
  setMapping: (value: CsvImportMapping) => void
  paymentMethods: Array<{ id: string; displayName: string }>
  pending: boolean
  zh: boolean
  onAnalyze: () => void
}) {
  const update = <K extends keyof CsvImportMapping>(key: K, value: CsvImportMapping[K]) =>
    setMapping({ ...mapping, [key]: value })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{zh ? "2. 映射字段" : "2. Map columns"}</CardTitle>
        <CardDescription>
          {zh
            ? "日期和金额必填。首版不会自动换汇；外币行会显示为无效，等待人工处理。"
            : "Date and amount are required. The first version never converts currencies automatically; foreign rows are flagged for review."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ColumnSelect
            label={zh ? "日期列" : "Date column"}
            headers={preview.headers}
            value={mapping.dateColumn}
            onChange={(value) => update("dateColumn", value ?? "")}
          />
          <ColumnSelect
            label={zh ? "金额列" : "Amount column"}
            headers={preview.headers}
            value={mapping.amountColumn}
            onChange={(value) => update("amountColumn", value ?? "")}
          />
          <ColumnSelect
            optional
            label={zh ? "商家列" : "Merchant column"}
            headers={preview.headers}
            value={mapping.merchantColumn}
            onChange={(value) => update("merchantColumn", value)}
          />
          <ColumnSelect
            optional
            label={zh ? "备注列" : "Note column"}
            headers={preview.headers}
            value={mapping.descriptionColumn}
            onChange={(value) => update("descriptionColumn", value)}
          />
          <ColumnSelect
            optional
            label={zh ? "收入/支出类型列" : "Type column"}
            headers={preview.headers}
            value={mapping.transactionTypeColumn}
            onChange={(value) => update("transactionTypeColumn", value)}
          />
          <ColumnSelect
            optional
            label={zh ? "币种列" : "Currency column"}
            headers={preview.headers}
            value={mapping.currencyColumn}
            onChange={(value) => update("currencyColumn", value)}
          />
          <label className="grid gap-1 text-sm font-medium">
            <span>{zh ? "日期格式" : "Date format"}</span>
            <select
              className="h-9 rounded-md border bg-background px-2"
              value={mapping.dateFormat}
              onChange={(event) => update("dateFormat", event.target.value as CsvImportMapping["dateFormat"])}
            >
              {["yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy", "yyyy/MM/dd"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>{zh ? "金额规则" : "Amount sign"}</span>
            <select
              className="h-9 rounded-md border bg-background px-2"
              value={mapping.amountSign}
              onChange={(event) => update("amountSign", event.target.value as CsvImportMapping["amountSign"])}
            >
              <option value="negative_expense">{zh ? "负数为支出" : "Negative is expense"}</option>
              <option value="positive_expense">{zh ? "正数为支出" : "Positive is expense"}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>{zh ? "默认币种" : "Default currency"}</span>
            <Input
              maxLength={3}
              value={mapping.defaultCurrencyCode}
              onChange={(event) => update("defaultCurrencyCode", event.target.value.toUpperCase())}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            <span>{zh ? "统一支付方式" : "Payment method"}</span>
            <select
              className="h-9 rounded-md border bg-background px-2"
              value={mapping.paymentMethodId ?? "none"}
              onChange={(event) => update("paymentMethodId", event.target.value === "none" ? null : event.target.value)}
            >
              <option value="none">{zh ? "不设置" : "Unassigned"}</option>
              {paymentMethods.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {preview.headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.previewRows.slice(0, 5).map((row, index) => (
                <TableRow key={index}>
                  {preview.headers.map((header) => (
                    <TableCell key={header}>{row[header]}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button
          className="w-fit"
          disabled={pending || !mapping.dateColumn || !mapping.amountColumn}
          onClick={onAnalyze}
        >
          {pending ? (zh ? "正在检查" : "Analyzing") : zh ? "检查映射与重复记录" : "Analyze mapping and duplicates"}
        </Button>
      </CardContent>
    </Card>
  )
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  optional = false,
}: {
  label: string
  headers: string[]
  value: string | null
  onChange: (value: string | null) => void
  optional?: boolean
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      <span>{label}</span>
      <select
        className="h-9 rounded-md border bg-background px-2"
        value={value ?? "none"}
        onChange={(event) => onChange(event.target.value === "none" ? null : event.target.value)}
      >
        {optional ? <option value="none">—</option> : null}
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </label>
  )
}

function AnalysisCard({
  analysis,
  forcedDuplicates,
  setForcedDuplicates,
  confirmed,
  setConfirmed,
  pending,
  zh,
  onCommit,
}: {
  analysis: CsvImportAnalysis
  forcedDuplicates: Set<number>
  setForcedDuplicates: (value: Set<number>) => void
  confirmed: boolean
  setConfirmed: (value: boolean) => void
  pending: boolean
  zh: boolean
  onCommit: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{zh ? "3. 检查并确认" : "3. Review and confirm"}</CardTitle>
        <CardDescription>
          {zh
            ? `${analysis.validCount} 行可导入，${analysis.duplicateCount} 行可能重复，${analysis.invalidCount} 行无效。默认跳过重复和无效行。`
            : `${analysis.validCount} valid, ${analysis.duplicateCount} potential duplicates, ${analysis.invalidCount} invalid. Duplicates and invalid rows are skipped by default.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{zh ? "日期" : "Date"}</TableHead>
                <TableHead>{zh ? "类型" : "Type"}</TableHead>
                <TableHead>{zh ? "金额（最小单位）" : "Minor amount"}</TableHead>
                <TableHead>{zh ? "商家" : "Merchant"}</TableHead>
                <TableHead>{zh ? "检查结果" : "Result"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.rows.map((row) => (
                <TableRow key={row.rowNumber}>
                  <TableCell>{row.rowNumber}</TableCell>
                  <TableCell>{row.transactionDate ?? "—"}</TableCell>
                  <TableCell>{row.transactionType ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{row.amountMinor ?? "—"}</TableCell>
                  <TableCell>{row.merchant ?? "—"}</TableCell>
                  <TableCell>
                    {row.error ? (
                      <span className="text-destructive">{row.error}</span>
                    ) : row.duplicate ? (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={forcedDuplicates.has(row.rowNumber)}
                          onCheckedChange={(checked) => {
                            const next = new Set(forcedDuplicates)
                            if (checked === true) next.add(row.rowNumber)
                            else next.delete(row.rowNumber)
                            setForcedDuplicates(next)
                          }}
                        />
                        <Badge variant="outline">{zh ? "可能重复；仍导入" : "Duplicate; import anyway"}</Badge>
                      </label>
                    ) : (
                      <Badge variant="secondary">{zh ? "可导入" : "Valid"}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {analysis.truncated ? (
          <p className="text-sm text-muted-foreground">
            {zh
              ? "页面只显示前 200 行；提交时仍会重新验证全部行。"
              : "Only the first 200 rows are shown; all rows are revalidated on commit."}
          </p>
        ) : null}
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          <span>
            {zh
              ? "我已检查字段映射、金额正负规则和重复记录；现在才允许写入数据库。"
              : "I reviewed the mapping, amount signs, and duplicates; the database may now be changed."}
          </span>
        </label>
        <Button
          className="w-fit"
          disabled={!confirmed || pending || analysis.validCount + forcedDuplicates.size === 0}
          onClick={onCommit}
        >
          {pending ? (zh ? "正在导入" : "Importing") : zh ? "确认并导入" : "Confirm and import"}
        </Button>
      </CardContent>
    </Card>
  )
}

function defaultMapping(headers: string[], paymentMethodId: string | null): CsvImportMapping {
  const find = (...needles: string[]) =>
    headers.find((header) => needles.some((needle) => header.toLowerCase().includes(needle)))
  return {
    dateColumn: find("date", "日期") ?? headers[0] ?? "",
    amountColumn: find("amount", "金额") ?? headers[1] ?? headers[0] ?? "",
    descriptionColumn: find("description", "memo", "note", "备注") ?? null,
    merchantColumn: find("merchant", "payee", "商家", "描述") ?? null,
    transactionTypeColumn: find("type", "类型") ?? null,
    currencyColumn: find("currency", "币种") ?? null,
    dateFormat: "yyyy-MM-dd",
    amountSign: "negative_expense",
    defaultCurrencyCode: "CAD",
    paymentMethodId,
  }
}
