import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { save } from "@tauri-apps/plugin-dialog"
import { addMonths, addYears, format, parseISO, subMonths, subYears } from "date-fns"
import { BotIcon, CircleAlertIcon, FileSpreadsheetIcon, PrinterIcon, TablePropertiesIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { commandGateway, type AiSummaryRecord, type FinancialSummary, type ReportNoteRecord } from "@/lib/commands"
import { formatMinorAmount } from "@/lib/money"

type ReportPeriod = "month" | "year"

export function ReportsPage() {
  const { t, i18n } = useTranslation()
  const [period, setPeriod] = useState<ReportPeriod>("month")
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [year, setYear] = useState(() => format(new Date(), "yyyy"))
  const hasValidPeriod = period === "month" ? /^\d{4}-\d{2}$/.test(month) : /^\d{4}$/.test(year)
  const report = useQuery({
    queryKey: ["financial-report", period, month, year],
    queryFn: () => loadReport(period, month, year),
    enabled: hasValidPeriod,
  })
  const currency = report.data?.settings.reportingCurrencyCode ?? "CAD"
  const summary = report.data?.summary

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t("reports.title")} description={t("reports.description")} />
      </div>
      <main className="flex flex-1 flex-col gap-6 p-4 print:p-0 lg:p-8">
        <div className="hidden print:block">
          <h1 className="text-2xl font-semibold">HomeLedger · {t("reports.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {summary?.periodStartDate} – {summary?.periodEndDateExclusive} · {currency}
          </p>
        </div>
        <section
          className="flex flex-wrap items-end justify-between gap-3 print:hidden"
          aria-label={t("reports.periodSelection")}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex rounded-md border p-1">
              <Button size="sm" variant={period === "month" ? "default" : "ghost"} onClick={() => setPeriod("month")}>
                {t("reports.monthly")}
              </Button>
              <Button size="sm" variant={period === "year" ? "default" : "ghost"} onClick={() => setPeriod("year")}>
                {t("reports.annual")}
              </Button>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              <span>{period === "month" ? t("reports.selectMonth") : t("reports.selectYear")}</span>
              <Input
                className="w-44"
                type={period === "month" ? "month" : "number"}
                min={period === "month" ? "2000-01" : "2000"}
                max={period === "month" ? "2100-12" : "2100"}
                value={period === "month" ? month : year}
                onChange={(event) => (period === "month" ? setMonth(event.target.value) : setYear(event.target.value))}
              />
            </label>
          </div>
          <ExportControls
            summary={summary}
            reportType={period === "month" ? "monthly" : "annual"}
            loading={report.isLoading}
          />
        </section>

        {report.isError ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{t("reports.loadError")}</AlertTitle>
            <AlertDescription>{t("reports.loadErrorDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {summary?.excludedCurrencyCount ? (
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{t("reports.excludedCurrencyTitle")}</AlertTitle>
            <AlertDescription>
              {t("reports.excludedCurrencyDescription", {
                count: summary.excludedCurrencyCount,
                currency,
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("reports.summary")}>
          <SummaryCard
            label={t("reports.totalIncome")}
            value={summary?.incomeMinor}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
          />
          <SummaryCard
            label={t("reports.totalExpense")}
            value={summary?.expenseMinor}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
            detail={expenseChange(summary, report.data?.previous, t)}
          />
          <SummaryCard
            label={t("reports.net")}
            value={summary?.netMinor}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
          />
          <SummaryCard
            label={t("reports.actualCount")}
            value={summary?.actualTransactionCount}
            loading={report.isLoading}
          />
          <SummaryCard
            label={t("reports.fixedExpenses")}
            value={summary?.fixedExpenseMinor}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
          />
          <SummaryCard
            label={t("reports.variableExpenses")}
            value={summary?.variableExpenseMinor}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
          />
        </section>

        {report.isLoading ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("reports.noteTitle")}</CardTitle>
              <CardDescription>{t("reports.noteDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-28 w-full" />
            </CardContent>
          </Card>
        ) : summary ? (
          <div className="grid gap-6">
            <ReportNoteCard
              key={`${summary.periodStartDate}:${report.data?.note?.version ?? 0}`}
              summary={summary}
              note={report.data?.note}
              reportType={period === "month" ? "monthly" : "annual"}
            />
            <AiSummaryCard
              summary={summary}
              previous={report.data?.previous}
              reportType={period === "month" ? "monthly" : "annual"}
              locale={i18n.language === "en-CA" ? "en-CA" : "zh-CN"}
            />
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-2">
          <BreakdownCard
            title={t("reports.categories")}
            description={t("reports.categoriesDescription")}
            rows={summary?.categoryTotals}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
            empty={t("reports.noExpenseData")}
          />
          <BreakdownCard
            title={t("reports.paymentMethods")}
            description={t("reports.paymentMethodsDescription")}
            rows={summary?.paymentMethodTotals}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
            empty={t("reports.noExpenseData")}
          />
          <BreakdownCard
            title={t("reports.householdMembers")}
            description={t("reports.householdMembersDescription")}
            rows={summary?.householdMemberTotals}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
            empty={t("reports.noExpenseData")}
          />
          <TrendCard
            summary={summary}
            period={period}
            currency={currency}
            locale={i18n.language}
            loading={report.isLoading}
          />
        </section>

        <ReviewCandidatesCard summary={summary} currency={currency} locale={i18n.language} loading={report.isLoading} />

        <Card>
          <CardHeader>
            <CardTitle>{t("reports.largestExpense")}</CardTitle>
            <CardDescription>{t("reports.largestExpenseDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {report.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : summary?.largestExpense ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
                <div>
                  <p className="font-medium">{summary.largestExpense.merchant ?? t("reports.untitled")}</p>
                  <p className="text-sm text-muted-foreground">
                    {summary.largestExpense.transactionDate} ·{" "}
                    {summary.largestExpense.categoryName ?? t("reports.uncategorized")}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">
                  {formatMinorAmount(summary.largestExpense.amountMinor, currency, i18n.language)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("reports.noExpenseData")}</p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}

function ReviewCandidatesCard({
  summary,
  currency,
  locale,
  loading,
}: {
  summary?: FinancialSummary
  currency: string
  locale: string
  loading: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const review = useMutation({
    mutationFn: commandGateway.setFinancialReviewCandidateStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-report"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-snapshot"] }),
      ])
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reports.reviewCandidates")}</CardTitle>
        <CardDescription>{t("reports.reviewCandidatesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : summary?.reviewCandidates.length ? (
          summary.reviewCandidates.slice(0, 20).map((candidate) => (
            <div
              key={`${candidate.transactionId}-${candidate.flagType}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{candidate.merchant ?? t("reports.untitled")}</span>
                  <Badge variant="outline">{t(`reports.reviewFlags.${candidate.flagType}`)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.transactionDate} · {t(`reports.reviewReasons.${candidate.flagType}`)}
                </p>
                {candidate.flagType === "possible_tax_candidate" ? (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t("reports.taxCandidateDisclaimer")}
                  </p>
                ) : null}
              </div>
              <span className="font-medium tabular-nums">
                {formatMinorAmount(candidate.amountMinor, currency, locale)}
              </span>
              <div className="flex gap-2 print:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      transactionId: candidate.transactionId,
                      flagType: candidate.flagType,
                      status: "confirmed",
                    })
                  }
                >
                  {t("reports.confirmCandidate")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      transactionId: candidate.transactionId,
                      flagType: candidate.flagType,
                      status: "dismissed",
                    })
                  }
                >
                  {t("reports.dismissCandidate")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{t("reports.noReviewCandidates")}</p>
        )}
        {review.isError ? <p className="text-sm text-destructive">{t("reports.reviewActionError")}</p> : null}
      </CardContent>
    </Card>
  )
}

function ExportControls({
  summary,
  reportType,
  loading,
}: {
  summary?: FinancialSummary
  reportType: "monthly" | "annual"
  loading: boolean
}) {
  const { t } = useTranslation()
  const [message, setMessage] = useState<string | null>(null)
  const exporting = useMutation({
    mutationFn: commandGateway.exportFinancialReport,
    onSuccess: (result) =>
      setMessage(
        t("reports.exported", {
          count: result.recordCount,
          format: result.exportFormat.toUpperCase(),
        }),
      ),
  })
  const runExport = async (exportFormat: "csv" | "xlsx") => {
    if (!summary) return
    setMessage(null)
    const filename = `HomeLedger-${summary.periodStartDate}-${summary.periodEndDateExclusive}.${exportFormat}`
    const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined
    const destinationPath = isTauri
      ? await save({
          defaultPath: filename,
          filters: [{ name: exportFormat.toUpperCase(), extensions: [exportFormat] }],
        })
      : filename
    if (!destinationPath) return
    exporting.mutate({
      reportType,
      periodStartDate: summary.periodStartDate,
      periodEndDateExclusive: summary.periodEndDateExclusive,
      reportingCurrencyCode: summary.reportingCurrencyCode,
      exportFormat,
      destinationPath,
    })
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="outline" disabled={!summary || loading || exporting.isPending} onClick={() => runExport("csv")}>
        <TablePropertiesIcon aria-hidden="true" />
        {t("reports.exportCsv")}
      </Button>
      <Button variant="outline" disabled={!summary || loading || exporting.isPending} onClick={() => runExport("xlsx")}>
        <FileSpreadsheetIcon aria-hidden="true" />
        {t("reports.exportExcel")}
      </Button>
      <Button variant="outline" disabled={!summary || loading} onClick={() => window.print()}>
        <PrinterIcon aria-hidden="true" />
        {t("reports.printOrPdf")}
      </Button>
      {message ? <span className="text-sm text-emerald-700 dark:text-emerald-400">{message}</span> : null}
      {exporting.isError ? <span className="text-sm text-destructive">{t("reports.exportError")}</span> : null}
    </div>
  )
}

async function loadReport(period: ReportPeriod, month: string, year: string) {
  const settings = await commandGateway.getSettings()
  const start = period === "month" ? parseISO(`${month}-01`) : parseISO(`${year}-01-01`)
  const end = period === "month" ? addMonths(start, 1) : addYears(start, 1)
  const previousStart = period === "month" ? subMonths(start, 1) : subYears(start, 1)
  const input = (rangeStart: Date, rangeEnd: Date) => ({
    periodStartDate: format(rangeStart, "yyyy-MM-dd"),
    periodEndDateExclusive: format(rangeEnd, "yyyy-MM-dd"),
    reportingCurrencyCode: settings.reportingCurrencyCode,
  })
  const reportType = period === "month" ? "monthly" : "annual"
  const noteInput = {
    reportType,
    periodStartDate: format(start, "yyyy-MM-dd"),
    periodEndDateExclusive: format(end, "yyyy-MM-dd"),
  } as const
  const [summary, previous, note] = await Promise.all([
    commandGateway.getFinancialSummary(input(start, end)),
    commandGateway.getFinancialSummary(input(previousStart, start)),
    commandGateway.getReportNote(noteInput),
  ])
  return { settings, summary, previous, note }
}

function ReportNoteCard({
  summary,
  note,
  reportType,
}: {
  summary: FinancialSummary
  note?: ReportNoteRecord | null
  reportType: "monthly" | "annual"
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [text, setText] = useState(note?.note ?? "")
  const save = useMutation({
    mutationFn: commandGateway.saveReportNote,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["financial-report"] }),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reports.noteTitle")}</CardTitle>
        <CardDescription>{t("reports.noteDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          value={text}
          maxLength={10_000}
          rows={5}
          aria-label={t("reports.noteTitle")}
          placeholder={t("reports.notePlaceholder")}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {note ? t("reports.noteVersion", { version: note.version }) : t("reports.noteNotSaved")}
          </p>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                reportType,
                periodStartDate: summary.periodStartDate,
                periodEndDateExclusive: summary.periodEndDateExclusive,
                note: text,
                expectedVersion: note?.version ?? null,
              })
            }
          >
            {save.isPending ? t("reports.savingNote") : t("reports.saveNote")}
          </Button>
        </div>
        {save.isSuccess ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("reports.noteSaved")}</p>
        ) : null}
        {save.isError ? <p className="text-sm text-destructive">{t("reports.noteSaveError")}</p> : null}
      </CardContent>
    </Card>
  )
}

function AiSummaryCard({
  summary,
  previous,
  reportType,
  locale,
}: {
  summary: FinancialSummary
  previous?: FinancialSummary
  reportType: "monthly" | "annual"
  locale: "zh-CN" | "en-CA"
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [scopeConfirmed, setScopeConfirmed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const queryInput = {
    summaryType: reportType,
    periodStartDate: summary.periodStartDate,
    periodEndDateExclusive: summary.periodEndDateExclusive,
  } as const
  const summaries = useQuery({
    queryKey: ["ai-summaries", queryInput],
    queryFn: () => commandGateway.listAiSummaries(queryInput),
  })
  const generate = useMutation({
    mutationFn: commandGateway.generateAiSummary,
    onSuccess: async (record) => {
      setSelectedId(record.id)
      setScopeConfirmed(false)
      await queryClient.invalidateQueries({ queryKey: ["ai-summaries", queryInput] })
    },
  })
  const selected = summaries.data?.find((record) => record.id === selectedId) ?? summaries.data?.[0]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BotIcon className="size-5" aria-hidden="true" />
          {t("reports.aiSummaryTitle")}
        </CardTitle>
        <CardDescription>{t("reports.aiSummaryDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Alert>
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("reports.aiScopeTitle")}</AlertTitle>
          <AlertDescription>{t("reports.aiScopeDescription")}</AlertDescription>
        </Alert>
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm print:hidden">
          <Checkbox
            checked={scopeConfirmed}
            onCheckedChange={(checked) => setScopeConfirmed(checked === true)}
            aria-label={t("reports.aiScopeConfirm")}
          />
          <span>{t("reports.aiScopeConfirm")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            variant="outline"
            disabled={!scopeConfirmed || !previous || generate.isPending}
            onClick={() => {
              if (!previous) return
              generate.mutate({
                ...queryInput,
                previousPeriodStartDate: previous.periodStartDate,
                reportingCurrencyCode: summary.reportingCurrencyCode,
                locale,
                aggregateScopeConfirmed: true,
              })
            }}
          >
            <BotIcon aria-hidden="true" />
            {generate.isPending
              ? t("reports.aiGenerating")
              : selected
                ? t("reports.aiRegenerate")
                : t("reports.aiGenerate")}
          </Button>
          {summaries.data && summaries.data.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span>{t("reports.aiVersion")}</span>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={selected?.id ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {summaries.data.map((record, index) => (
                  <option key={record.id} value={record.id}>
                    {t("reports.aiVersionLabel", { version: summaries.data.length - index })} ·{" "}
                    {new Date(record.createdAt).toLocaleString(locale)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {summaries.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {selected ? <AiSummaryEditor key={selected.updatedAt} record={selected} queryInput={queryInput} /> : null}
        {!summaries.isLoading && !selected ? (
          <p className="text-sm text-muted-foreground">{t("reports.aiNoSummary")}</p>
        ) : null}
        {summaries.isError ? <p className="text-sm text-destructive">{t("reports.aiLoadError")}</p> : null}
        {generate.isError ? (
          <p className="text-sm text-destructive">
            {generate.error instanceof Error ? generate.error.message : t("reports.aiGenerateError")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AiSummaryEditor({
  record,
  queryInput,
}: {
  record: AiSummaryRecord
  queryInput: { summaryType: "monthly" | "annual"; periodStartDate: string; periodEndDateExclusive: string }
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [text, setText] = useState(record.currentText)
  const update = useMutation({
    mutationFn: commandGateway.updateAiSummary,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["ai-summaries", queryInput] }),
  })
  const saveAs = (reviewStatus: "draft" | "reviewed" | "rejected") =>
    update.mutate({
      id: record.id,
      currentText: text,
      reviewStatus,
      expectedUpdatedAt: record.updatedAt,
    })
  return (
    <div className="grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t("reports.aiGenerated")}</Badge>
        <Badge variant="secondary">{t(`reports.aiStatuses.${record.reviewStatus}`)}</Badge>
        <span>{record.modelNameSnapshot}</span>
        <span title={record.inputHash}>{record.inputHash.slice(0, 12)}</span>
      </div>
      <Textarea value={text} maxLength={20_000} rows={8} onChange={(event) => setText(event.target.value)} />
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="ghost" disabled={update.isPending || !text.trim()} onClick={() => saveAs("rejected")}>
          {t("reports.aiReject")}
        </Button>
        <Button variant="outline" disabled={update.isPending || !text.trim()} onClick={() => saveAs("draft")}>
          {t("reports.aiSaveDraft")}
        </Button>
        <Button disabled={update.isPending || !text.trim()} onClick={() => saveAs("reviewed")}>
          {t("reports.aiMarkReviewed")}
        </Button>
      </div>
      {update.isError ? <p className="text-sm text-destructive">{t("reports.aiSaveError")}</p> : null}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  currency,
  locale,
  loading,
  detail,
}: {
  label: string
  value?: number
  currency?: string
  locale?: string
  loading: boolean
  detail?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-3 h-7 w-28" />
        ) : (
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {value === undefined
              ? "—"
              : currency && locale
                ? formatMinorAmount(value, currency, locale)
                : value.toLocaleString(locale)}
          </p>
        )}
        {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  description,
  rows,
  currency,
  locale,
  loading,
  empty,
}: {
  title: string
  description: string
  rows?: FinancialSummary["categoryTotals"]
  currency: string
  locale: string
  loading: boolean
  empty: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{title}</TableHead>
                <TableHead className="text-right">{currency}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 10).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMinorAmount(row.amountMinor, currency, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function TrendCard({
  summary,
  period,
  currency,
  locale,
  loading,
}: {
  summary?: FinancialSummary
  period: ReportPeriod
  currency: string
  locale: string
  loading: boolean
}) {
  const { t } = useTranslation()
  const rows = summary ? trendRows(summary, period) : []
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reports.trend")}</CardTitle>
        <CardDescription>{t(period === "month" ? "reports.dailyTrend" : "reports.monthlyTrend")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length ? (
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.period")}</TableHead>
                  <TableHead className="text-right">{t("reports.totalIncome")}</TableHead>
                  <TableHead className="text-right">{t("reports.totalExpense")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinorAmount(row.incomeMinor, currency, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinorAmount(row.expenseMinor, currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("reports.noTrendData")}</p>
        )}
      </CardContent>
    </Card>
  )
}

function trendRows(summary: FinancialSummary, period: ReportPeriod) {
  if (period === "month")
    return summary.dailyTrend.map((item) => ({
      label: item.summaryDate,
      incomeMinor: item.incomeMinor,
      expenseMinor: item.expenseMinor,
    }))
  const months = new Map<string, { label: string; incomeMinor: number; expenseMinor: number }>()
  for (let index = 0; index < 12; index += 1) {
    const date = addMonths(parseISO(summary.periodStartDate), index)
    months.set(format(date, "yyyy-MM"), { label: format(date, "yyyy-MM"), incomeMinor: 0, expenseMinor: 0 })
  }
  for (const item of summary.dailyTrend) {
    const row = months.get(item.summaryDate.slice(0, 7))
    if (row) {
      row.incomeMinor += item.incomeMinor
      row.expenseMinor += item.expenseMinor
    }
  }
  return [...months.values()]
}

function expenseChange(
  current: FinancialSummary | undefined,
  previous: FinancialSummary | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!current || !previous || previous.expenseMinor === 0) return undefined
  const percent = Math.round(((current.expenseMinor - previous.expenseMinor) * 100) / previous.expenseMinor)
  return t("reports.comparedWithPrevious", {
    percent: Math.abs(percent),
    direction: t(percent >= 0 ? "reports.increased" : "reports.decreased"),
  })
}
