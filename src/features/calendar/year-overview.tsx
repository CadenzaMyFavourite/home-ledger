import { BellIcon, ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react"
import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CalendarEventRecord, ReminderDeliveryRecord } from "@/lib/commands"
import { calendarColorFor, type CalendarColorOverrides } from "@/lib/calendar-colors"

export function YearOverview({
  year,
  locale,
  events,
  calendarColors,
  reminders,
  onYearChange,
  onMonthSelect,
}: {
  year: number
  locale: string
  events: CalendarEventRecord[]
  calendarColors: CalendarColorOverrides
  reminders: ReminderDeliveryRecord[]
  onYearChange: (year: number) => void
  onMonthSelect: (month: number) => void
}) {
  const { t } = useTranslation()
  const importantDates = new Set(
    events
      .filter((event) => event.priority === "important" || ["important", "bill", "tax"].includes(event.eventType))
      .map((event) => event.startDate ?? event.startAtUtc?.slice(0, 10))
      .filter((date): date is string => Boolean(date)),
  )
  const reminderDates = new Set(reminders.map((reminder) => reminder.occurrenceKey))
  const eventColorsByDate = new Map<string, string[]>()
  for (const event of events) {
    const date = event.startDate ?? event.startAtUtc?.slice(0, 10)
    if (!date) continue
    const colors = eventColorsByDate.get(date) ?? []
    const color = event.color ?? calendarColorFor(event.eventType, calendarColors)
    if (!colors.includes(color)) colors.push(color)
    eventColorsByDate.set(date, colors)
  }
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("calendar.yearOverview.title", { year })}</h2>
        </CardTitle>
        <CardDescription>{t("calendar.yearOverview.description")}</CardDescription>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("calendar.yearOverview.previousYear")}
            onClick={() => onYearChange(year - 1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <span className="min-w-16 text-center font-medium tabular-nums">{year}</span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("calendar.yearOverview.nextYear")}
            onClick={() => onYearChange(year + 1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, month) => {
            const monthStart = new Date(year, month, 1)
            const days = eachDayOfInterval({
              start: startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 }),
              end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
            })
            const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(monthStart)
            const monthEvents = [...importantDates].filter((date) =>
              date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`),
            ).length
            const monthReminders = [...reminderDates].filter((date) =>
              date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`),
            ).length
            return (
              <Button
                key={month}
                type="button"
                variant="ghost"
                className="h-auto w-full flex-col items-stretch gap-2 rounded-xl border p-3 text-left"
                aria-label={t("calendar.yearOverview.openMonth", {
                  month: monthName,
                  events: monthEvents,
                  reminders: monthReminders,
                })}
                onClick={() => onMonthSelect(month)}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  <span>{monthName}</span>
                  <span className="text-xs text-muted-foreground">
                    {monthEvents ? `! ${monthEvents}` : ""}
                    {monthEvents && monthReminders ? " · " : ""}
                    {monthReminders ? `⌁ ${monthReminders}` : ""}
                  </span>
                </span>
                <span className="grid grid-cols-7 text-center text-[10px] text-muted-foreground" aria-hidden="true">
                  {weekdays.map((weekday, index) => (
                    <span key={`${weekday}-${index}`}>{weekday}</span>
                  ))}
                </span>
                <span className="grid grid-cols-7 gap-y-1 text-center text-xs" aria-hidden="true">
                  {days.map((day) => {
                    const date = format(day, "yyyy-MM-dd")
                    const inMonth = day.getMonth() === month
                    return (
                      <span key={date} className="relative flex min-h-6 items-center justify-center tabular-nums">
                        <span className={inMonth ? undefined : "text-muted-foreground/35"}>{day.getDate()}</span>
                        {(eventColorsByDate.get(date) ?? []).length ? (
                          <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 gap-0.5" aria-hidden="true">
                            {(eventColorsByDate.get(date) ?? []).slice(0, 3).map((color) => (
                              <span
                                key={`${date}-${color}`}
                                className="size-1 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </span>
                        ) : null}
                        {importantDates.has(date) ? (
                          <CircleAlertIcon className="absolute right-0 bottom-0 size-2.5" />
                        ) : reminderDates.has(date) ? (
                          <BellIcon className="absolute right-0 bottom-0 size-2.5" />
                        ) : null}
                      </span>
                    )
                  })}
                </span>
              </Button>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CircleAlertIcon className="size-3" aria-hidden="true" />
            {t("calendar.yearOverview.importantLegend")}
          </span>
          <span className="flex items-center gap-1">
            <BellIcon className="size-3" aria-hidden="true" />
            {t("calendar.yearOverview.reminderLegend")}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
