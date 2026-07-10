import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, DatabaseIcon, SaveIcon, Settings2Icon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { calendarEventTypeSchema } from "@/lib/calendar-data"
import { calendarColorOverridesSchema, defaultCalendarColorOverrides } from "@/lib/calendar-colors"
import { commandGateway, type AppSettings } from "@/lib/commands"
import { useTheme } from "@/lib/theme"
import { AiSettingsPanel } from "@/features/settings/ai-settings-panel"

const settingsFormSchema = z.object({
  locale: z.enum(["zh-CN", "en-CA"]),
  timezoneId: z.string().trim().min(1, "请选择时区").max(100),
  reportingCurrencyCode: z.string().regex(/^[A-Z]{3}$/, "请输入三位大写币种代码"),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "请输入两位大写国家代码"),
  regionCode: z.string().regex(/^[A-Z]{1,3}$/, "请输入一至三位大写地区代码"),
  theme: z.enum(["system", "light", "dark"]),
  autoBackupPolicy: z.object({
    enabled: z.boolean(),
    intervalDays: z.number().int().min(1).max(365),
    retentionCount: z.number().int().min(1).max(100),
  }),
  calendarColorOverrides: calendarColorOverridesSchema,
})

type SettingsFormValues = z.infer<typeof settingsFormSchema>

export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useQuery({ queryKey: ["settings"], queryFn: commandGateway.getSettings })

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} actions={<span />} />
      <main className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
        <Alert>
          <Settings2Icon aria-hidden="true" />
          <AlertTitle>{t("settings.localTitle")}</AlertTitle>
          <AlertDescription>{t("settings.localDescription")}</AlertDescription>
        </Alert>
        {settings.isLoading ? <SettingsSkeleton /> : null}
        {settings.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("settings.loadError")}</AlertTitle>
            <AlertDescription>{t("settings.loadErrorDescription")}</AlertDescription>
          </Alert>
        ) : null}
        {settings.data ? <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} /> : null}
        <AiSettingsPanel />
        <ExampleDataCard />
      </main>
    </>
  )
}

function ExampleDataCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmAction, setConfirmAction] = useState<"load" | "remove" | null>(null)
  const status = useQuery({ queryKey: ["example-data-status"], queryFn: commandGateway.getExampleDataStatus })
  const mutation = useMutation({
    mutationFn: (action: "load" | "remove") =>
      action === "load" ? commandGateway.loadExampleData() : commandGateway.removeExampleData(),
    onSuccess: async (updated, action) => {
      queryClient.setQueryData(["example-data-status"], updated)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["transaction-reference-data"] }),
      ])
      toast.success(t(action === "load" ? "settings.exampleLoaded" : "settings.exampleRemoved"))
      setConfirmAction(null)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("settings.exampleError")),
  })
  const loaded = status.data?.loaded ?? false
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.exampleTitle")}</CardTitle>
          <CardDescription>{t("settings.exampleDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {status.isLoading ? <Skeleton className="h-16 w-full" /> : null}
          {status.isError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.exampleStatusError")}</AlertTitle>
              <AlertDescription>{t("settings.loadErrorDescription")}</AlertDescription>
            </Alert>
          ) : null}
          {status.data ? (
            <Alert>
              <DatabaseIcon aria-hidden="true" />
              <AlertTitle>{t(loaded ? "settings.exampleActive" : "settings.exampleInactive")}</AlertTitle>
              <AlertDescription>
                {loaded
                  ? t("settings.exampleCount", { count: status.data.transactionCount })
                  : t("settings.exampleCoverage")}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button
            type="button"
            variant={loaded ? "destructive" : "outline"}
            disabled={status.isLoading || status.isError || mutation.isPending}
            onClick={() => setConfirmAction(loaded ? "remove" : "load")}
          >
            {loaded ? <Trash2Icon data-icon="inline-start" /> : <DatabaseIcon data-icon="inline-start" />}
            {t(loaded ? "settings.removeExample" : "settings.loadExample")}
          </Button>
        </CardFooter>
      </Card>
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirmAction === "remove" ? "settings.removeExampleTitle" : "settings.loadExampleTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                confirmAction === "remove" ? "settings.removeExampleConfirmation" : "settings.loadExampleConfirmation",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("transactions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmAction === "remove" ? "destructive" : "default"}
              disabled={mutation.isPending || confirmAction === null}
              onClick={() => confirmAction && mutation.mutate(confirmAction)}
            >
              {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t(confirmAction === "remove" ? "settings.confirmRemoveExample" : "settings.confirmLoadExample")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SettingsForm({ settings }: { settings: AppSettings }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { setPreference } = useTheme()
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: settings,
  })
  const mutation = useMutation({
    mutationFn: commandGateway.updateSettings,
    onSuccess: async (updated) => {
      queryClient.setQueryData(["settings"], updated)
      setPreference(updated.theme)
      await i18n.changeLanguage(updated.locale)
      toast.success(t("settings.saved"))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("settings.saveError")),
  })

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.generalTitle")}</CardTitle>
          <CardDescription>{t("settings.generalDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Controller
              control={form.control}
              name="locale"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel htmlFor="locale">{t("settings.locale")}</FieldLabel>
                    <FieldDescription>{t("settings.localeDescription")}</FieldDescription>
                  </div>
                  <div className="w-full max-w-sm">
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="locale" aria-invalid={fieldState.invalid}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="zh-CN">简体中文</SelectItem>
                          <SelectItem value="en-CA">English (Canada)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="timezoneId"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel htmlFor="timezoneId">{t("settings.timezone")}</FieldLabel>
                    <FieldDescription>{t("settings.timezoneDescription")}</FieldDescription>
                  </div>
                  <div className="w-full max-w-sm">
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="timezoneId" aria-invalid={fieldState.invalid}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="America/Toronto">America/Toronto</SelectItem>
                          <SelectItem value="America/Vancouver">America/Vancouver</SelectItem>
                          <SelectItem value="America/Edmonton">America/Edmonton</SelectItem>
                          <SelectItem value="America/Halifax">America/Halifax</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
            <TextField
              control={form.control}
              name="reportingCurrencyCode"
              label={t("settings.currency")}
              description={t("settings.currencyDescription")}
              maxLength={3}
            />
            <TextField
              control={form.control}
              name="countryCode"
              label={t("settings.country")}
              description={t("settings.countryDescription")}
              maxLength={2}
            />
            <TextField
              control={form.control}
              name="regionCode"
              label={t("settings.region")}
              description={t("settings.regionDescription")}
              maxLength={3}
            />
            <Controller
              control={form.control}
              name="theme"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel>{t("settings.theme")}</FieldLabel>
                    <FieldDescription>{t("settings.themeDescription")}</FieldDescription>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value)}
                    variant="outline"
                    aria-label={t("settings.theme")}
                  >
                    <ToggleGroupItem value="system">{t("settings.themeSystem")}</ToggleGroupItem>
                    <ToggleGroupItem value="light">{t("settings.themeLight")}</ToggleGroupItem>
                    <ToggleGroupItem value="dark">{t("settings.themeDark")}</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="calendarColorOverrides"
              render={({ field }) => (
                <Field orientation="responsive">
                  <div className="min-w-52">
                    <FieldLabel>{t("settings.calendarColors")}</FieldLabel>
                    <FieldDescription>{t("settings.calendarColorsDescription")}</FieldDescription>
                  </div>
                  <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                    {calendarEventTypeSchema.options.map((eventType) => (
                      <div key={eventType} className="flex items-center justify-between gap-3 rounded-lg border p-2">
                        <label htmlFor={`calendar-color-${eventType}`} className="min-w-0 truncate text-sm">
                          {t(`calendar.types.${eventType}`)}
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`calendar-color-${eventType}`}
                            type="color"
                            className="h-9 w-14 cursor-pointer p-1"
                            value={field.value[eventType]}
                            aria-label={t("settings.calendarColorFor", {
                              eventType: t(`calendar.types.${eventType}`),
                            })}
                            onChange={(event) =>
                              field.onChange({ ...field.value, [eventType]: event.target.value.toUpperCase() })
                            }
                          />
                          <code className="text-xs text-muted-foreground">{field.value[eventType]}</code>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="sm:col-span-2 sm:justify-self-start"
                      onClick={() => field.onChange({ ...defaultCalendarColorOverrides })}
                    >
                      {t("settings.calendarColorsReset")}
                    </Button>
                  </div>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="autoBackupPolicy.enabled"
              render={({ field }) => (
                <Field orientation="responsive">
                  <div className="min-w-52">
                    <FieldLabel htmlFor="autoBackupEnabled">{t("settings.autoBackup")}</FieldLabel>
                    <FieldDescription>{t("settings.autoBackupDescription")}</FieldDescription>
                  </div>
                  <label className="flex w-full max-w-sm items-center gap-2">
                    <input
                      id="autoBackupEnabled"
                      type="checkbox"
                      checked={field.value}
                      onChange={(event) => field.onChange(event.target.checked)}
                    />
                    {field.value ? t("settings.enabled") : t("settings.disabled")}
                  </label>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="autoBackupPolicy.intervalDays"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel htmlFor="autoBackupInterval">{t("settings.autoBackupInterval")}</FieldLabel>
                    <FieldDescription>{t("settings.autoBackupIntervalDescription")}</FieldDescription>
                  </div>
                  <div className="w-full max-w-sm">
                    <Input
                      id="autoBackupInterval"
                      type="number"
                      min={1}
                      max={365}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="autoBackupPolicy.retentionCount"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel htmlFor="autoBackupRetention">{t("settings.autoBackupRetention")}</FieldLabel>
                    <FieldDescription>{t("settings.autoBackupRetentionDescription")}</FieldDescription>
                  </div>
                  <div className="w-full max-w-sm">
                    <Input
                      id="autoBackupRetention"
                      type="number"
                      min={1}
                      max={100}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
            {mutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : form.formState.isSubmitSuccessful ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {mutation.isPending ? t("settings.saving") : t("settings.save")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function TextField({
  control,
  name,
  label,
  description,
  maxLength,
}: {
  control: ReturnType<typeof useForm<SettingsFormValues>>["control"]
  name: "reportingCurrencyCode" | "countryCode" | "regionCode"
  label: string
  description: string
  maxLength: number
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="responsive" data-invalid={fieldState.invalid}>
          <div className="min-w-52">
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <FieldDescription>{description}</FieldDescription>
          </div>
          <div className="w-full max-w-sm">
            <Input
              {...field}
              id={name}
              maxLength={maxLength}
              aria-invalid={fieldState.invalid}
              onChange={(event) => field.onChange(event.target.value.toUpperCase())}
            />
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  )
}

function SettingsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-6">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-9 w-72" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
