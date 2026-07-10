import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { YearOverview } from "@/features/calendar/year-overview"
import type { CalendarEventRecord, ReminderDeliveryRecord } from "@/lib/commands"
import { defaultCalendarColorOverrides } from "@/lib/calendar-colors"
import "@/lib/i18n"

describe("YearOverview", () => {
  it("labels all months with non-colour event and reminder counts and supports keyboard selection", async () => {
    const event: CalendarEventRecord = {
      id: "event-1",
      title: "Tax deadline",
      description: null,
      eventType: "tax",
      isAllDay: true,
      startDate: "2026-01-15",
      endDateExclusive: "2026-01-16",
      startAtUtc: null,
      endAtUtc: null,
      timezoneId: "America/Toronto",
      priority: "important",
      color: null,
      icon: null,
      locationId: null,
      locationName: null,
      householdMemberId: null,
      householdMemberName: null,
      isCompleted: false,
      linkedTransactionCount: 0,
      linkedTransactionIds: [],
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }
    const reminder: ReminderDeliveryRecord = {
      id: "reminder-1",
      recurringItemId: "item-1",
      recurringItemName: "Rent",
      occurrenceKey: "2026-01-01",
      scheduledForUtc: "2025-12-29T14:00:00Z",
      transactionId: null,
      transactionStatus: null,
      amountMinor: null,
      currencyCode: null,
    }
    const onMonthSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <YearOverview
        year={2026}
        locale="zh-CN"
        events={[event]}
        calendarColors={defaultCalendarColorOverrides}
        reminders={[reminder]}
        onYearChange={vi.fn()}
        onMonthSelect={onMonthSelect}
      />,
    )

    const january = screen.getByRole("button", { name: "打开一月；1 个重要事件，1 个提醒" })
    january.focus()
    await user.keyboard("{Enter}")
    expect(onMonthSelect).toHaveBeenCalledWith(0)
    expect(screen.getAllByRole("button")).toHaveLength(14)
  })
})
