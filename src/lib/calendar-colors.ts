import { z } from "zod"

import { calendarEventTypeSchema, type CalendarEventType } from "@/lib/calendar-data"

export const defaultCalendarColorOverrides: Record<CalendarEventType, string> = {
  general: "#1976D2",
  important: "#D9364F",
  travel: "#7455D9",
  medical: "#D9364F",
  education: "#1976D2",
  bill: "#B66A00",
  tax: "#B66A00",
  maintenance: "#087F7A",
  other: "#667085",
}

export const calendarColorOverridesSchema = z.object(
  Object.fromEntries(
    calendarEventTypeSchema.options.map((eventType) => [eventType, z.string().regex(/^#[0-9A-Fa-f]{6}$/)]),
  ) as Record<CalendarEventType, z.ZodString>,
)

export type CalendarColorOverrides = z.infer<typeof calendarColorOverridesSchema>

export function calendarColorFor(eventType: CalendarEventType, overrides: CalendarColorOverrides | undefined): string {
  return overrides?.[eventType] ?? defaultCalendarColorOverrides[eventType]
}
