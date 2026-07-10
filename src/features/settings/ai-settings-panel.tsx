import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BotIcon, CheckCircle2Icon, CircleAlertIcon, PlugZapIcon, SaveIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { commandGateway, type AiProfileRecord, type SaveAiProfileInput } from "@/lib/commands"
import { saveAiProfileInputSchema } from "@/lib/local-ai-data"

export function AiSettingsPanel() {
  const { t } = useTranslation()
  const profiles = useQuery({ queryKey: ["ai-profiles"], queryFn: commandGateway.listAiProfiles })
  const profile = profiles.data?.find((item) => item.isDefault) ?? profiles.data?.[0]
  if (profiles.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (profiles.isError) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>{t("settings.aiLoadError")}</AlertTitle>
        <AlertDescription>{t("settings.aiLoadErrorDescription")}</AlertDescription>
      </Alert>
    )
  }
  return <AiProfileForm key={profile?.updatedAt ?? "new-ai-profile"} profile={profile} />
}

function AiProfileForm({ profile }: { profile?: AiProfileRecord }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<SaveAiProfileInput>({
    resolver: zodResolver(saveAiProfileInputSchema),
    defaultValues: profile ?? {
      id: null,
      displayName: "Local AI",
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "",
      timeoutMs: 30_000,
      maxContextTokens: 8_192,
      isEnabled: false,
    },
  })
  const save = useMutation({
    mutationFn: commandGateway.saveAiProfile,
    onSuccess: async (saved) => {
      form.reset(saved)
      await queryClient.invalidateQueries({ queryKey: ["ai-profiles"] })
      toast.success(t("settings.aiSaved"))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("settings.aiSaveError")),
  })
  const test = useMutation({ mutationFn: commandGateway.testAiConnection })
  const models = test.data?.availableModels ?? []

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BotIcon className="size-5" aria-hidden="true" />
            {t("settings.aiTitle")}
          </CardTitle>
          <CardDescription>{t("settings.aiDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{t("settings.aiPrivacyTitle")}</AlertTitle>
            <AlertDescription>{t("settings.aiPrivacyDescription")}</AlertDescription>
          </Alert>
          <FieldGroup>
            <Controller
              control={form.control}
              name="isEnabled"
              render={({ field }) => (
                <Field orientation="responsive">
                  <div className="min-w-52">
                    <FieldLabel htmlFor="aiEnabled">{t("settings.aiEnabled")}</FieldLabel>
                    <FieldDescription>{t("settings.aiEnabledDescription")}</FieldDescription>
                  </div>
                  <Switch id="aiEnabled" checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
            <AiTextField form={form} name="displayName" label={t("settings.aiDisplayName")} />
            <Controller
              control={form.control}
              name="providerType"
              render={({ field, fieldState }) => (
                <Field orientation="responsive" data-invalid={fieldState.invalid}>
                  <div className="min-w-52">
                    <FieldLabel htmlFor="aiProvider">{t("settings.aiProvider")}</FieldLabel>
                    <FieldDescription>{t("settings.aiProviderDescription")}</FieldDescription>
                  </div>
                  <div className="w-full max-w-md">
                    <Select
                      value={field.value}
                      onValueChange={(value: "ollama" | "openai_compatible") => {
                        field.onChange(value)
                        form.setValue(
                          "baseUrl",
                          value === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1",
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }}
                    >
                      <SelectTrigger id="aiProvider" aria-invalid={fieldState.invalid}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="ollama">Ollama</SelectItem>
                          <SelectItem value="openai_compatible">LM Studio / OpenAI-compatible</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
            <AiTextField
              form={form}
              name="baseUrl"
              label={t("settings.aiBaseUrl")}
              description={t("settings.aiBaseUrlDescription")}
            />
            <AiTextField
              form={form}
              name="modelName"
              label={t("settings.aiModel")}
              description={t("settings.aiModelDescription")}
              list="aiAvailableModels"
            />
            <datalist id="aiAvailableModels">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <AiNumberField
              form={form}
              name="timeoutMs"
              label={t("settings.aiTimeout")}
              description={t("settings.aiTimeoutDescription")}
              min={1_000}
              max={300_000}
            />
            <AiNumberField
              form={form}
              name="maxContextTokens"
              label={t("settings.aiContext")}
              description={t("settings.aiContextDescription")}
              min={512}
              max={1_048_576}
            />
          </FieldGroup>
          {test.data ? (
            <Alert variant={test.data.connected && test.data.modelAvailable ? "default" : "destructive"}>
              {test.data.connected && test.data.modelAvailable ? (
                <CheckCircle2Icon aria-hidden="true" />
              ) : (
                <CircleAlertIcon aria-hidden="true" />
              )}
              <AlertTitle>
                {t(test.data.connected ? "settings.aiConnectionReached" : "settings.aiConnectionFailed")}
              </AlertTitle>
              <AlertDescription>
                {test.data.message} · {t("settings.aiLatency", { latency: test.data.latencyMs })}
                {test.data.availableModels.length
                  ? ` · ${t("settings.aiModelsFound", { count: test.data.availableModels.length })}`
                  : ""}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 border-t">
          <Button
            type="button"
            variant="outline"
            disabled={test.isPending}
            onClick={form.handleSubmit((values) => test.mutate(values))}
          >
            {test.isPending ? <Spinner data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
            {test.isPending ? t("settings.aiTesting") : t("settings.aiTest")}
          </Button>
          <Button type="submit" disabled={save.isPending || (!form.formState.isDirty && Boolean(profile))}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {save.isPending ? t("settings.saving") : t("settings.aiSave")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function AiTextField({
  form,
  name,
  label,
  description,
  list,
}: {
  form: ReturnType<typeof useForm<SaveAiProfileInput>>
  name: "displayName" | "baseUrl" | "modelName"
  label: string
  description?: string
  list?: string
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="responsive" data-invalid={fieldState.invalid}>
          <div className="min-w-52">
            <FieldLabel htmlFor={`ai-${name}`}>{label}</FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
          </div>
          <div className="w-full max-w-md">
            <Input {...field} id={`ai-${name}`} list={list} aria-invalid={fieldState.invalid} />
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  )
}

function AiNumberField({
  form,
  name,
  label,
  description,
  min,
  max,
}: {
  form: ReturnType<typeof useForm<SaveAiProfileInput>>
  name: "timeoutMs" | "maxContextTokens"
  label: string
  description: string
  min: number
  max: number
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="responsive" data-invalid={fieldState.invalid}>
          <div className="min-w-52">
            <FieldLabel htmlFor={`ai-${name}`}>{label}</FieldLabel>
            <FieldDescription>{description}</FieldDescription>
          </div>
          <div className="w-full max-w-md">
            <Input
              id={`ai-${name}`}
              type="number"
              min={min}
              max={max}
              value={field.value}
              aria-invalid={fieldState.invalid}
              onChange={(event) => field.onChange(event.target.valueAsNumber)}
            />
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  )
}
