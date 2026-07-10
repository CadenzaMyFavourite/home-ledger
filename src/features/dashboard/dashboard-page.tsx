import { useQuery } from "@tanstack/react-query"
import { addDays, addMonths, format, parseISO, startOfMonth, startOfYear, subMonths } from "date-fns"
import { formatInTimeZone } from "date-fns-tz"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  DatabaseIcon,
  ScaleIcon,
  WalletCardsIcon,
} from "lucide-react"
import { useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { commandGateway, type FinancialSummary } from "@/lib/commands"
import { formatMinorAmount } from "@/lib/money"

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const snapshot = useQuery({ queryKey: ["dashboard-snapshot"], queryFn: loadDashboardSnapshot })
  const currency = snapshot.data?.settings.reportingCurrencyCode ?? "CAD"
  const monthlyTrend = useMemo(() => (snapshot.data ? toMonthlyTrend(snapshot.data.year) : []), [snapshot.data])
  if (snapshot.isError) {
    return (
      <>
        <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
        <main className="p-4 lg:p-8">
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{t("dashboard.loadError")}</AlertTitle>
            <AlertDescription>{t("dashboard.loadErrorDescription")}</AlertDescription>
          </Alert>
        </main>
      </>
    )
  }

  return (
    <>
      <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
      <main className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("dashboard.kpis")}>
          <MetricCard
            icon={ArrowUpRightIcon}
            label={t("dashboard.monthIncome")}
            value={money(snapshot.data?.month.incomeMinor, currency, i18n.language)}
            loading={snapshot.isLoading}
            tone="positive"
          />
          <MetricCard
            icon={ArrowDownRightIcon}
            label={t("dashboard.monthExpense")}
            value={money(snapshot.data?.month.expenseMinor, currency, i18n.language)}
            loading={snapshot.isLoading}
            detail={expenseComparison(snapshot.data?.month, snapshot.data?.previousMonth, t)}
            tone="negative"
          />
          <MetricCard
            icon={ScaleIcon}
            label={t("dashboard.monthNet")}
            value={money(snapshot.data?.month.netMinor, currency, i18n.language)}
            loading={snapshot.isLoading}
          />
          <MetricCard
            icon={WalletCardsIcon}
            label={t("dashboard.yearNet")}
            value={money(snapshot.data?.year.netMinor, currency, i18n.language)}
            loading={snapshot.isLoading}
          />
        </section>

        {snapshot.data?.month.excludedCurrencyCount ? (
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{t("dashboard.excludedCurrencyTitle")}</AlertTitle>
            <AlertDescription>
              {t("dashboard.excludedCurrencyDescription", {
                count: snapshot.data.month.excludedCurrencyCount,
                currency,
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.yearTrend")}</CardTitle>
              <CardDescription>{t("dashboard.yearTrendDescription", { currency })}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" role="img" aria-label={t("dashboard.yearTrendAlt")}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={monthlyTrend} accessibilityLayer margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis
                      width={58}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => compactMoney(value, currency, i18n.language)}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatMinorAmount(Number(value ?? 0), currency, i18n.language),
                        String(name),
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="incomeMinor"
                      name={t("dashboard.income")}
                      stroke="#12843B"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="expenseMinor"
                      name={t("dashboard.expense")}
                      stroke="#F05A14"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex gap-4 text-sm" aria-hidden="true">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#12843B]" />
                  {t("dashboard.income")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#F05A14]" />
                  {t("dashboard.expense")}
                </span>
              </div>
            </CardContent>
          </Card>

          <CategoryCard
            summary={snapshot.data?.month}
            currency={currency}
            locale={i18n.language}
            loading={snapshot.isLoading}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <ListCard
            title={t("dashboard.upcomingBills")}
            description={t("dashboard.upcomingBillsDescription")}
            loading={snapshot.isLoading}
            empty={t("dashboard.noUpcomingBills")}
          >
            {snapshot.data?.reminders.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <span>
                  <span className="block text-sm font-medium">{item.recurringItemName}</span>
                  <span className="text-xs text-muted-foreground">{item.occurrenceKey}</span>
                </span>
                {item.amountMinor !== null && item.currencyCode ? (
                  <span className="text-sm font-medium tabular-nums">
                    {formatMinorAmount(item.amountMinor, item.currencyCode, i18n.language)}
                  </span>
                ) : (
                  <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
            ))}
          </ListCard>
          <ListCard
            title={t("dashboard.recentRecords")}
            description={t("dashboard.recentRecordsDescription")}
            loading={snapshot.isLoading}
            empty={t("dashboard.noRecentRecords")}
          >
            {snapshot.data?.recent.records.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.merchant ?? item.note ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{item.transactionDate}</span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {formatMinorAmount(item.amountMinor, item.currencyCode, i18n.language)}
                </span>
              </div>
            ))}
          </ListCard>
          <ListCard
            title={t("dashboard.importantEvents")}
            description={t("dashboard.importantEventsDescription")}
            loading={snapshot.isLoading}
            empty={t("dashboard.noImportantEvents")}
          >
            {snapshot.data?.events.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <span>
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.startDate ?? item.startAtUtc?.slice(0, 10)}
                  </span>
                </span>
                <Badge variant="outline">{t(`calendar.types.${item.eventType}`)}</Badge>
              </div>
            ))}
          </ListCard>
          <ListCard
            title={t("dashboard.needsReview")}
            description={t("dashboard.needsReviewDescription")}
            loading={snapshot.isLoading}
            empty={t("dashboard.noReviewCandidates")}
          >
            {snapshot.data?.month.reviewCandidates.slice(0, 5).map((candidate) => (
              <div
                key={`${candidate.transactionId}-${candidate.flagType}`}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {candidate.merchant ?? t("reports.untitled")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`reports.reviewFlags.${candidate.flagType}`)}
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {formatMinorAmount(candidate.amountMinor, currency, i18n.language)}
                </span>
              </div>
            ))}
          </ListCard>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.localStatus")}</CardTitle>
            <CardDescription>{t("dashboard.localStatusDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <DatabaseIcon className="size-4" aria-hidden="true" />
              {snapshot.data?.status.storageMode === "local_only"
                ? t("dashboard.localOnly")
                : t("dashboard.browserPreview")}
            </span>
            <span>{snapshot.data?.settings.timezoneId}</span>
            <span>
              {t("dashboard.schemaVersion")}: v{snapshot.data?.status.schemaVersion ?? "—"}
            </span>
          </CardContent>
        </Card>
      </main>
    </>
  )
}

async function loadDashboardSnapshot() {
  const [settings, status] = await Promise.all([commandGateway.getSettings(), commandGateway.getAppStatus()])
  const today = parseISO(formatInTimeZone(new Date(), settings.timezoneId, "yyyy-MM-dd"))
  const monthStart = startOfMonth(today)
  const previousMonthStart = subMonths(monthStart, 1)
  const yearStart = startOfYear(today)
  const now = new Date()
  const reminderStart = addDays(now, -30).toISOString()
  const reminderEnd = addDays(now, 45).toISOString()
  const eventStart = format(addDays(today, -7), "yyyy-MM-dd")
  const eventEnd = format(addDays(today, 46), "yyyy-MM-dd")
  const summary = (start: Date, end: Date) =>
    commandGateway.getFinancialSummary({
      periodStartDate: format(start, "yyyy-MM-dd"),
      periodEndDateExclusive: format(end, "yyyy-MM-dd"),
      reportingCurrencyCode: settings.reportingCurrencyCode,
    })
  const [month, previousMonth, year, recent, reminders, events] = await Promise.all([
    summary(monthStart, addMonths(monthStart, 1)),
    summary(previousMonthStart, monthStart),
    summary(yearStart, addMonths(yearStart, 12)),
    commandGateway.listTransactions({ limit: 5, sortBy: "created_at", sortDirection: "desc" }),
    commandGateway.listReminderDeliveries({ rangeStartUtc: reminderStart, rangeEndUtc: reminderEnd }),
    commandGateway.listCalendarEvents({
      rangeStartDate: eventStart,
      rangeEndDateExclusive: eventEnd,
      timezoneId: settings.timezoneId,
    }),
  ])
  return {
    settings,
    status,
    month,
    previousMonth,
    year,
    recent,
    reminders,
    events: events.filter((event) => event.priority === "important" || event.eventType === "important"),
  }
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  loading,
  tone = "neutral",
}: {
  icon: typeof ArrowUpRightIcon
  label: string
  value?: string
  detail?: string
  loading: boolean
  tone?: "neutral" | "positive" | "negative"
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-orange-700 dark:text-orange-400"
        : "text-primary"
  return (
    <Card>
      <CardContent className="flex min-h-32 items-start gap-3 p-5">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-md bg-muted ${toneClass}`}>
          <Icon aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-7 w-32" />
          ) : (
            <p className="mt-1 text-xl font-semibold tabular-nums">{value ?? "—"}</p>
          )}
          {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function CategoryCard({
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
  const maximum = summary?.categoryTotals[0]?.amountMinor ?? 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.topCategories")}</CardTitle>
        <CardDescription>{t("dashboard.topCategoriesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <Skeleton className="h-52 w-full" />
        ) : summary?.categoryTotals.length ? (
          summary.categoryTotals.slice(0, 6).map((item) => (
            <div key={item.id} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{item.name}</span>
                <span className="font-medium tabular-nums">
                  {formatMinorAmount(item.amountMinor, currency, locale)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[#F05A14]"
                  style={{ width: `${maximum ? Math.max(3, (item.amountMinor * 100) / maximum) : 0}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{t("dashboard.noCategoryData")}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ListCard({
  title,
  description,
  loading,
  empty,
  children,
}: {
  title: string
  description: string
  loading: boolean
  empty: string
  children: ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {loading ? (
          <Skeleton className="h-36 w-full" />
        ) : hasChildren ? (
          children
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function toMonthlyTrend(summary: FinancialSummary) {
  const months = new Map<string, { label: string; incomeMinor: number; expenseMinor: number }>()
  const start = parseISO(summary.periodStartDate)
  for (let index = 0; index < 12; index += 1) {
    const date = addMonths(start, index)
    months.set(format(date, "yyyy-MM"), { label: format(date, "MM"), incomeMinor: 0, expenseMinor: 0 })
  }
  for (const point of summary.dailyTrend) {
    const item = months.get(point.summaryDate.slice(0, 7))
    if (item) {
      item.incomeMinor += point.incomeMinor
      item.expenseMinor += point.expenseMinor
    }
  }
  return [...months.values()]
}

function money(value: number | undefined, currency: string, locale: string) {
  return value === undefined ? undefined : formatMinorAmount(value, currency, locale)
}

function compactMoney(value: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100)
}

function expenseComparison(
  current: FinancialSummary | undefined,
  previous: FinancialSummary | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!current || !previous || previous.expenseMinor === 0) return undefined
  const percent = Math.round(((current.expenseMinor - previous.expenseMinor) * 100) / previous.expenseMinor)
  return t("dashboard.comparedWithPrevious", {
    percent: Math.abs(percent),
    direction: t(percent >= 0 ? "dashboard.increased" : "dashboard.decreased"),
  })
}
