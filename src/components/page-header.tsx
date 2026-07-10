import { PlusIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { GlobalSearch } from "@/features/search/global-search"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "react-i18next"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <header className="flex min-h-16 items-center gap-3 border-b px-4 lg:px-8">
      <SidebarTrigger aria-label={t("app.toggleSidebar")} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <GlobalSearch />
      {actions ?? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button disabled>
                <PlusIcon data-icon="inline-start" />
                {t("app.quickAdd")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("app.availableLater")}</TooltipContent>
        </Tooltip>
      )}
    </header>
  )
}
