import { createBrowserRouter } from "react-router-dom"

import { AppShell } from "@/app/app-shell"
import { RouteLoading } from "@/components/route-loading"
import { RouteErrorPage } from "@/components/route-error-page"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import("@/features/dashboard/dashboard-page")).DashboardPage }),
      },
      {
        path: "settings",
        lazy: async () => ({ Component: (await import("@/features/settings/settings-page")).SettingsPage }),
      },
      {
        path: "transactions",
        lazy: async () => ({ Component: (await import("@/features/transactions/transactions-page")).TransactionsPage }),
      },
      {
        path: "import",
        lazy: async () => ({ Component: (await import("@/features/import/csv-import-page")).CsvImportPage }),
      },
      {
        path: "reference-data",
        lazy: async () => ({
          Component: (await import("@/features/reference-data/reference-data-page")).ReferenceDataPage,
        }),
      },
      {
        path: "calendar",
        lazy: async () => ({ Component: (await import("@/features/calendar/calendar-page")).CalendarPage }),
      },
      {
        path: "reports",
        lazy: async () => ({ Component: (await import("@/features/reports/reports-page")).ReportsPage }),
      },
      {
        path: "tax",
        lazy: async () => ({ Component: (await import("@/features/tax/tax-page")).TaxPage }),
      },
      {
        path: "backup",
        lazy: async () => ({ Component: (await import("@/features/backup/backup-page")).BackupPage }),
      },
    ],
  },
])
