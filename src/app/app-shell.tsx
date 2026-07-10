import {
  ArchiveIcon,
  BellIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
  FileTextIcon,
  HouseIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  SettingsIcon,
  WalletCardsIcon,
} from "lucide-react"
import { NavLink, Outlet } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useTranslation } from "react-i18next"

const navigation = [
  { key: "dashboard", to: "/", icon: HouseIcon, enabled: true },
  { key: "transactions", to: "/transactions", icon: FileTextIcon, enabled: true },
  { key: "referenceData", to: "/reference-data", icon: WalletCardsIcon, enabled: true },
  { key: "calendar", to: "/calendar", icon: CalendarDaysIcon, enabled: true },
  { key: "reminders", icon: BellIcon, enabled: false },
  { key: "reports", to: "/reports", icon: ChartNoAxesCombinedIcon, enabled: true },
  { key: "tax", to: "/tax", icon: ReceiptTextIcon, enabled: true },
  { key: "backup", to: "/backup", icon: ArchiveIcon, enabled: true },
] as const

export function AppShell() {
  const { t } = useTranslation()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="print:hidden">
        <SidebarHeader className="border-b border-sidebar-border p-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <LockKeyholeIcon aria-hidden="true" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold">HomeLedger</p>
              <p className="truncate text-xs text-muted-foreground">{t("app.localFirst")}</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigation.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    {item.enabled ? (
                      <SidebarMenuButton asChild tooltip={t(`navigation.${item.key}`)}>
                        <NavLink
                          to={item.to}
                          end
                          className={({ isActive }) => (isActive ? "bg-sidebar-accent font-medium" : undefined)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{t(`navigation.${item.key}`)}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton disabled tooltip={t("app.availableLater")}>
                        <item.icon aria-hidden="true" />
                        <span>{t(`navigation.${item.key}`)}</span>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={t("navigation.settings")}>
                <NavLink
                  to="/settings"
                  className={({ isActive }) => (isActive ? "bg-sidebar-accent font-medium" : undefined)}
                >
                  <SettingsIcon aria-hidden="true" />
                  <span>{t("navigation.settings")}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 print:m-0 print:w-full">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
