import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CalendarDaysIcon, FileIcon, ReceiptTextIcon, SearchIcon } from "lucide-react"
import { useDeferredValue, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { commandGateway, type GlobalSearchResult } from "@/lib/commands"

const PAGE_SIZE = 30
const resultKinds = ["transaction", "event", "attachment"] as const

export function GlobalSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const deferredQuery = useDeferredValue(query.trim())
  const results = useQuery({
    queryKey: ["global-search", deferredQuery, page],
    queryFn: () => commandGateway.globalSearch({ query: deferredQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: open && deferredQuery.length >= 2,
    placeholderData: keepPreviousData,
  })
  const pageCount = Math.max(1, Math.ceil((results.data?.total ?? 0) / PAGE_SIZE))
  const selectResult = (result: GlobalSearchResult) => {
    const params = new URLSearchParams({ focus: result.ownerId })
    if (result.kind === "attachment") params.set("attachment", result.id)
    navigate(`/${result.ownerType === "transaction" ? "transactions" : "calendar"}?${params}`)
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="outline"
        className="hidden w-64 justify-start text-muted-foreground lg:flex"
        onClick={() => setOpen(true)}
      >
        <SearchIcon data-icon="inline-start" />
        {t("app.searchPlaceholder")}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        aria-label={t("app.searchPlaceholder")}
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden="true" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t("globalSearch.title")}</SheetTitle>
            <SheetDescription>{t("globalSearch.description")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                value={query}
                maxLength={100}
                placeholder={t("globalSearch.placeholder")}
                aria-label={t("globalSearch.placeholder")}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
              />
            </InputGroup>
            {deferredQuery.length < 2 ? (
              <SearchEmpty title={t("globalSearch.startTitle")} description={t("globalSearch.startDescription")} />
            ) : null}
            {results.isLoading ? <SearchSkeleton /> : null}
            {results.isError ? (
              <SearchEmpty title={t("globalSearch.errorTitle")} description={t("globalSearch.errorDescription")} />
            ) : null}
            {results.data?.total === 0 ? (
              <SearchEmpty title={t("globalSearch.noResults")} description={t("globalSearch.noResultsDescription")} />
            ) : null}
            {results.data?.records.length ? (
              <div className="grid gap-5">
                {resultKinds.map((kind) => {
                  const records = results.data.records.filter((record) => record.kind === kind)
                  return records.length ? (
                    <section key={kind} className="grid gap-2" aria-labelledby={`search-${kind}`}>
                      <h3 id={`search-${kind}`} className="text-sm font-medium">
                        {t(`globalSearch.kinds.${kind}`)}
                      </h3>
                      <div className="grid gap-1">
                        {records.map((record) => (
                          <SearchResultButton
                            key={`${record.kind}-${record.id}-${record.ownerId}`}
                            record={record}
                            onClick={selectResult}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null
                })}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    {t("globalSearch.previous")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("globalSearch.page", { page: page + 1, total: pageCount, count: results.data.total })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {t("globalSearch.next")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function SearchResultButton({
  record,
  onClick,
}: {
  record: GlobalSearchResult
  onClick: (record: GlobalSearchResult) => void
}) {
  const { t } = useTranslation()
  const Icon = record.kind === "transaction" ? ReceiptTextIcon : record.kind === "event" ? CalendarDaysIcon : FileIcon
  return (
    <Button variant="ghost" className="h-auto justify-start px-3 py-2 text-left" onClick={() => onClick(record)}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{record.title}</span>
        {record.subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{record.subtitle}</span>
        ) : null}
      </span>
      {record.occurredOn ? <Badge variant="secondary">{record.occurredOn}</Badge> : null}
      <span className="sr-only">{t("globalSearch.openResult")}</span>
    </Button>
  )
}

function SearchEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-56 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SearchSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg p-3">
          <Skeleton className="size-5 rounded" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
