import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/lib/theme"
import { commandGateway } from "@/lib/commands"
import { useTheme } from "@/lib/theme"
import "@/lib/i18n"

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsSynchronizer />
        <RecurringStartupSynchronizer />
        <TooltipProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function RecurringStartupSynchronizer() {
  const started = useRef(false)
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      await commandGateway.materializeRecurringTransactions({ asOfDate: format(new Date(), "yyyy-MM-dd") })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["reminder-deliveries"] }),
      ])
      if (!("__TAURI_INTERNALS__" in window)) return
      const notifications = await import("@tauri-apps/plugin-notification")
      if (!(await notifications.isPermissionGranted())) return
      const now = new Date()
      const start = new Date(now)
      start.setUTCDate(start.getUTCDate() - 30)
      const due = await commandGateway.listReminderDeliveries({
        rangeStartUtc: start.toISOString(),
        rangeEndUtc: now.toISOString(),
      })
      for (const reminder of due) {
        notifications.sendNotification({
          title: reminder.recurringItemName,
          body: t("calendar.recurring.notificationBody", { date: reminder.occurrenceKey }),
        })
        await commandGateway.markReminderDelivered({ id: reminder.id })
      }
    })().catch((error: unknown) => {
      console.warn("Recurring startup check failed", error)
    })
  }, [queryClient, t])
  return null
}

function SettingsSynchronizer() {
  const { setPreference } = useTheme()
  const { i18n } = useTranslation()
  const settings = useQuery({ queryKey: ["settings"], queryFn: commandGateway.getSettings })

  useEffect(() => {
    if (!settings.data) return
    setPreference(settings.data.theme)
    document.documentElement.lang = settings.data.locale
    void i18n.changeLanguage(settings.data.locale)
  }, [i18n, setPreference, settings.data])

  return null
}
