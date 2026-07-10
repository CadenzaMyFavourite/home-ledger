import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { save } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  CircleAlertIcon,
  FileSpreadsheetIcon,
  PrinterIcon,
  ReceiptTextIcon,
  TagsIcon,
  TablePropertiesIcon,
} from "lucide-react"
import { useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { commandGateway, type TaxOrganizer } from "@/lib/commands"
import { formatMinorAmount } from "@/lib/money"

const craRecordsUrl =
  "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/long-should-you-keep-your-income-tax-records.html"
const craMedicalUrl =
  "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/lines-33099-33199-eligible-medical-expenses-you-claim-on-your-tax-return.html"

function openExternalReference(event: MouseEvent<HTMLAnchorElement>, url: string) {
  if (!("__TAURI_INTERNALS__" in window)) return
  event.preventDefault()
  void openUrl(url).catch((error: unknown) => console.warn("Could not open external tax reference", error))
}

export function TaxPage() {
  const { i18n } = useTranslation()
  const zh = i18n.language !== "en-CA"
  const [year, setYear] = useState(new Date().getFullYear())
  const query = useQuery({
    queryKey: ["tax-organizer", year],
    queryFn: async () => {
      const settings = await commandGateway.getSettings()
      return commandGateway.getTaxOrganizer({ year, reportingCurrencyCode: settings.reportingCurrencyCode })
    },
    enabled: year >= 1900 && year <= 2200,
  })
  const organizer = query.data
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={zh ? "税务资料整理" : "Tax organizer"}
          description={
            zh
              ? "整理年度收入、税务候选支出、收据与人工复核项目；不代替报税软件或专业意见"
              : "Organize annual income, candidate expenses, receipts, and review items; not tax filing or professional advice"
          }
        />
      </div>
      <main className="flex flex-1 flex-col gap-6 p-4 print:p-0 lg:p-8">
        <div className="hidden print:block">
          <h1 className="text-2xl font-semibold">HomeLedger · {zh ? "税务资料整理" : "Tax organizer"}</h1>
          <p>
            {year} · {organizer?.reportingCurrencyCode}
          </p>
        </div>
        <section className="flex flex-wrap items-end justify-between gap-3 print:hidden">
          <label className="grid gap-1 text-sm font-medium">
            <span>{zh ? "税务年度" : "Tax year"}</span>
            <Input
              className="w-36"
              type="number"
              min={1900}
              max={2200}
              value={year}
              onChange={(event) => setYear(event.target.valueAsNumber)}
            />
          </label>
          <ExportControls organizer={organizer} zh={zh} />
        </section>

        {organizer ? (
          <Alert className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{zh ? "候选提示，不是抵税结论" : "Candidate hints, not eligibility decisions"}</AlertTitle>
            <AlertDescription>{organizer.profile.disclaimer}</AlertDescription>
          </Alert>
        ) : null}
        {query.isError ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{zh ? "无法读取税务资料" : "Could not load tax organizer"}</AlertTitle>
            <AlertDescription>
              {zh ? "没有修改任何数据，请重试。" : "No data was changed. Please try again."}
            </AlertDescription>
          </Alert>
        ) : null}

        <SummaryGrid organizer={organizer} loading={query.isLoading} locale={i18n.language} zh={zh} />

        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <CandidateTable organizer={organizer} loading={query.isLoading} locale={i18n.language} zh={zh} />
          <div className="grid content-start gap-6 print:hidden">
            <TagTotals organizer={organizer} locale={i18n.language} zh={zh} />
            <CustomTagCard zh={zh} />
            <Card>
              <CardHeader>
                <CardTitle>{zh ? "官方参考" : "Official references"}</CardTitle>
                <CardDescription>
                  {zh
                    ? "规则会变化，请以 CRA 最新资料及专业意见为准。"
                    : "Rules change; verify current CRA guidance and professional advice."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <a
                  className="text-primary underline underline-offset-4"
                  href={craRecordsUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => openExternalReference(event, craRecordsUrl)}
                >
                  {zh ? "CRA：保存报税记录的时间" : "CRA: How long to keep tax records"}
                </a>
                <a
                  className="text-primary underline underline-offset-4"
                  href={craMedicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => openExternalReference(event, craMedicalUrl)}
                >
                  {zh ? "CRA：医疗费用候选项目" : "CRA: Eligible medical expenses reference"}
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  )
}

function SummaryGrid({
  organizer,
  loading,
  locale,
  zh,
}: {
  organizer?: TaxOrganizer
  loading: boolean
  locale: string
  zh: boolean
}) {
  const values = [
    [zh ? "年度实际收入" : "Annual actual income", organizer?.incomeMinor, true],
    [zh ? "候选支出金额" : "Candidate expenses", organizer?.candidateExpenseMinor, true],
    [zh ? "候选记录" : "Candidate records", organizer?.candidateCount, false],
    [zh ? "缺少收据" : "Missing receipts", organizer?.missingReceiptCount, false],
    [zh ? "需要人工复核" : "Needs review", organizer?.needsReviewCount, false],
    [zh ? "已确认标签" : "Confirmed tags", organizer?.confirmedTaggedCount, false],
  ] as const
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={zh ? "税务资料摘要" : "Tax organizer summary"}
    >
      {values.map(([label, value, money]) => (
        <Card key={label}>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-28" />
            ) : (
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {value === undefined
                  ? "—"
                  : money && organizer
                    ? formatMinorAmount(value, organizer.reportingCurrencyCode, locale)
                    : value.toLocaleString(locale)}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function CandidateTable({
  organizer,
  loading,
  locale,
  zh,
}: {
  organizer?: TaxOrganizer
  loading: boolean
  locale: string
  zh: boolean
}) {
  const queryClient = useQueryClient()
  const [selectedTags, setSelectedTags] = useState<Record<string, string>>({})
  const mutate = useMutation({
    mutationFn: commandGateway.setTransactionTaxTag,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["tax-organizer"] }),
  })
  const activeTags = organizer?.tags.filter((tag) => tag.isActive) ?? []
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptTextIcon className="size-5" aria-hidden="true" />
          {zh ? "税务候选支出" : "Tax candidate expenses"}
        </CardTitle>
        <CardDescription>
          {zh
            ? "仅显示已完成支出。标签总额可能重叠；添加或移除标签都不会改变原始金额。"
            : "Completed expenses only. Tag totals may overlap; changing tags never changes the original amount."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : organizer?.candidates.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{zh ? "日期 / 商家" : "Date / merchant"}</TableHead>
                  <TableHead>{zh ? "分类" : "Category"}</TableHead>
                  <TableHead>{zh ? "状态" : "Status"}</TableHead>
                  <TableHead>{zh ? "税务标签" : "Tax tags"}</TableHead>
                  <TableHead className="text-right">{organizer.reportingCurrencyCode}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizer.candidates.map((candidate) => (
                  <TableRow key={candidate.transactionId}>
                    <TableCell className="min-w-48 align-top">
                      <p className="font-medium">{candidate.merchant ?? (zh ? "未命名记录" : "Untitled")}</p>
                      <p className="text-xs text-muted-foreground">{candidate.transactionDate}</p>
                      {candidate.note ? (
                        <p className="mt-1 max-w-80 text-xs text-muted-foreground">{candidate.note}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {candidate.categoryName ?? (zh ? "未分类" : "Uncategorized")}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex min-w-32 flex-wrap gap-1">
                        {!candidate.hasAttachment ? (
                          <Badge variant="destructive">{zh ? "缺收据" : "No receipt"}</Badge>
                        ) : null}
                        {candidate.needsReview ? <Badge variant="outline">{zh ? "待复核" : "Review"}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-72 align-top">
                      <div className="flex flex-wrap gap-1">
                        {candidate.taxTags.map((tag) => (
                          <Button
                            key={tag.id}
                            size="sm"
                            variant="secondary"
                            className="h-7"
                            disabled={mutate.isPending}
                            title={zh ? "移除此标签" : "Remove this tag"}
                            onClick={() =>
                              mutate.mutate({
                                transactionId: candidate.transactionId,
                                transactionVersion: candidate.version,
                                taxTagId: tag.id,
                                selected: false,
                              })
                            }
                          >
                            {tag.name} ×
                          </Button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2 print:hidden">
                        <select
                          className="h-8 min-w-36 rounded-md border bg-background px-2 text-xs"
                          aria-label={zh ? "选择税务标签" : "Select tax tag"}
                          value={selectedTags[candidate.transactionId] ?? activeTags[0]?.id ?? ""}
                          onChange={(event) =>
                            setSelectedTags((current) => ({
                              ...current,
                              [candidate.transactionId]: event.target.value,
                            }))
                          }
                        >
                          {activeTags.map((tag) => (
                            <option key={tag.id} value={tag.id}>
                              {tag.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={mutate.isPending || !activeTags.length}
                          onClick={() =>
                            mutate.mutate({
                              transactionId: candidate.transactionId,
                              transactionVersion: candidate.version,
                              taxTagId: selectedTags[candidate.transactionId] ?? activeTags[0]?.id ?? "",
                              selected: true,
                            })
                          }
                        >
                          {zh ? "添加" : "Add"}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top font-medium tabular-nums">
                      {formatMinorAmount(candidate.reportingAmountMinor, organizer.reportingCurrencyCode, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {zh
              ? "所选年度没有已标记或待检查的税务候选支出。"
              : "No tagged or flagged candidate expenses for this year."}
          </p>
        )}
        {mutate.isError ? <p className="mt-3 text-sm text-destructive">{mutate.error.message}</p> : null}
      </CardContent>
    </Card>
  )
}

function TagTotals({ organizer, locale, zh }: { organizer?: TaxOrganizer; locale: string; zh: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{zh ? "按标签汇总" : "Totals by tag"}</CardTitle>
        <CardDescription>
          {zh
            ? "同一交易可有多个标签，因此各行不能相加。"
            : "One transaction can have multiple tags, so rows are not additive."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {organizer?.tagTotals.length ? (
          organizer.tagTotals.map((total) => (
            <div key={total.taxTagId} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {total.name} <span className="text-muted-foreground">({total.transactionCount})</span>
              </span>
              <span className="font-medium tabular-nums">
                {formatMinorAmount(total.amountMinor, organizer.reportingCurrencyCode, locale)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{zh ? "暂无已确认标签。" : "No confirmed tags yet."}</p>
        )}
      </CardContent>
    </Card>
  )
}

function CustomTagCard({ zh }: { zh: boolean }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const saveTag = useMutation({
    mutationFn: commandGateway.saveTaxTag,
    onSuccess: async () => {
      setName("")
      setDescription("")
      await queryClient.invalidateQueries({ queryKey: ["tax-organizer"] })
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TagsIcon className="size-5" aria-hidden="true" />
          {zh ? "自定义标签" : "Custom tag"}
        </CardTitle>
        <CardDescription>
          {zh
            ? "地区规则不写死，可添加适合自己的整理标签。"
            : "Add organizer labels without hard-coding regional rules."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Input
          aria-label={zh ? "自定义税务标签名称" : "Custom tax tag name"}
          value={name}
          maxLength={100}
          placeholder={zh ? "标签名称" : "Tag name"}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label={zh ? "自定义税务标签说明（可选）" : "Custom tax tag description (optional)"}
          value={description}
          maxLength={1000}
          placeholder={zh ? "说明（可选）" : "Description (optional)"}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          disabled={!name.trim() || saveTag.isPending}
          onClick={() => saveTag.mutate({ id: null, name, description: description || null, isActive: true })}
        >
          {zh ? "添加自定义标签" : "Add custom tag"}
        </Button>
        {saveTag.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveTag.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ExportControls({ organizer, zh }: { organizer?: TaxOrganizer; zh: boolean }) {
  const [message, setMessage] = useState<string | null>(null)
  const exportPackage = useMutation({
    mutationFn: commandGateway.exportTaxPackage,
    onSuccess: (result) =>
      setMessage(zh ? `已导出 ${result.candidateCount} 笔候选支出` : `Exported ${result.candidateCount} candidates`),
  })
  const runExport = async (exportFormat: "csv" | "xlsx") => {
    if (!organizer) return
    const filename = `HomeLedger-tax-${organizer.year}.${exportFormat}`
    const isTauri = window.__TAURI_INTERNALS__ !== undefined
    const destinationPath = isTauri
      ? await save({
          defaultPath: filename,
          filters: [{ name: exportFormat.toUpperCase(), extensions: [exportFormat] }],
        })
      : filename
    if (!destinationPath) return
    exportPackage.mutate({
      year: organizer.year,
      reportingCurrencyCode: organizer.reportingCurrencyCode,
      exportFormat,
      destinationPath,
    })
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" disabled={!organizer || exportPackage.isPending} onClick={() => runExport("csv")}>
        <TablePropertiesIcon aria-hidden="true" />
        CSV
      </Button>
      <Button variant="outline" disabled={!organizer || exportPackage.isPending} onClick={() => runExport("xlsx")}>
        <FileSpreadsheetIcon aria-hidden="true" />
        Excel
      </Button>
      <Button variant="outline" disabled={!organizer} onClick={() => window.print()}>
        <PrinterIcon aria-hidden="true" />
        {zh ? "打印 / PDF" : "Print / PDF"}
      </Button>
      {message ? <span className="text-sm text-emerald-700 dark:text-emerald-400">{message}</span> : null}
      {exportPackage.isError ? <span className="text-sm text-destructive">{exportPackage.error.message}</span> : null}
    </div>
  )
}
