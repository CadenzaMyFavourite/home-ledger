import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  commandGateway,
  type Category,
  type HouseholdMember,
  type Location,
  type PaymentMethod,
  type SaveCategoryInput,
  type SaveHouseholdMemberInput,
  type SaveLocationInput,
  type SavePaymentMethodInput,
} from "@/lib/commands"

type CategoryEditor = { record?: Category } | null
type PaymentEditor = { record?: PaymentMethod } | null
type MemberEditor = { record?: HouseholdMember } | null
type LocationEditor = { record?: Location } | null
type StatusAction =
  | { kind: "category"; record: Category }
  | { kind: "payment"; record: PaymentMethod }
  | { kind: "member"; record: HouseholdMember }
  | { kind: "location"; record: Location }

export function ReferenceDataPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [categoryEditor, setCategoryEditor] = useState<CategoryEditor>(null)
  const [paymentEditor, setPaymentEditor] = useState<PaymentEditor>(null)
  const [memberEditor, setMemberEditor] = useState<MemberEditor>(null)
  const [locationEditor, setLocationEditor] = useState<LocationEditor>(null)
  const references = useQuery({
    queryKey: ["transaction-reference-data"],
    queryFn: commandGateway.listTransactionReferenceData,
  })
  const statusMutation = useMutation({
    mutationFn: async (action: StatusAction) => {
      if (action.kind === "category") {
        const record = action.record
        await commandGateway.saveCategory({
          id: record.id,
          name: record.name,
          categoryType: record.categoryType,
          parentId: record.parentId,
          icon: record.icon,
          color: record.color,
          isActive: !record.isActive,
        })
        return
      }
      if (action.kind === "payment") {
        const record = action.record
        await commandGateway.savePaymentMethod({
          id: record.id,
          displayName: record.displayName,
          methodType: record.methodType,
          institution: record.institution,
          lastFour: record.lastFour,
          defaultCurrencyCode: record.defaultCurrencyCode,
          icon: record.icon,
          color: record.color,
          isActive: !record.isActive,
        })
        return
      }
      if (action.kind === "member") {
        const record = action.record
        await commandGateway.saveHouseholdMember({
          id: record.id,
          displayName: record.displayName,
          relationship: record.relationship,
          color: record.color,
          isDefault: record.isDefault,
          isActive: !record.isActive,
        })
        return
      }
      const record = action.record
      await commandGateway.saveLocation({
        id: record.id,
        name: record.name,
        addressLine: record.addressLine,
        city: record.city,
        province: record.province,
        countryCode: record.countryCode,
        postalCode: record.postalCode,
        isFavorite: record.isFavorite,
        isActive: !record.isActive,
      })
    },
    onSuccess: async () => {
      await invalidateReferenceData(queryClient)
      toast.success(t("referenceData.saved"))
    },
    onError: showError,
  })

  return (
    <>
      <PageHeader title={t("referenceData.title")} description={t("referenceData.description")} />
      <main className="grid min-w-0 flex-1 gap-6 p-4 xl:grid-cols-2 lg:p-8">
        {references.isError ? (
          <Empty className="col-span-full min-h-72 rounded-lg border bg-card">
            <EmptyHeader>
              <EmptyTitle>{t("referenceData.loadError")}</EmptyTitle>
              <EmptyDescription>{t("transactions.loadErrorDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {!references.isError ? (
          <>
            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle>{t("referenceData.categories")}</CardTitle>
                <CardDescription>{t("referenceData.categoriesDescription")}</CardDescription>
                <CardAction>
                  <Button size="sm" onClick={() => setCategoryEditor({})}>
                    <PlusIcon data-icon="inline-start" />
                    {t("referenceData.addCategory")}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("referenceData.name")}</TableHead>
                      <TableHead>{t("referenceData.categoryType")}</TableHead>
                      <TableHead>{t("transactions.status")}</TableHead>
                      <TableHead className="text-right">{t("transactions.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {references.data?.categories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">
                          {category.parentName ? `${category.parentName} → ${category.name}` : category.name}
                        </TableCell>
                        <TableCell>{t(`referenceData.types.${category.categoryType}`)}</TableCell>
                        <TableCell>
                          <StatusBadge active={category.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${t("referenceData.edit")}：${category.name}`}
                              onClick={() => setCategoryEditor({ record: category })}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`${t(category.isActive ? "referenceData.disable" : "referenceData.enable")}：${category.name}`}
                              disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ kind: "category", record: category })}
                            >
                              {t(category.isActive ? "referenceData.disable" : "referenceData.enable")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle>{t("referenceData.paymentMethods")}</CardTitle>
                <CardDescription>{t("referenceData.paymentMethodsDescription")}</CardDescription>
                <CardAction>
                  <Button size="sm" onClick={() => setPaymentEditor({})}>
                    <PlusIcon data-icon="inline-start" />
                    {t("referenceData.addPaymentMethod")}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("referenceData.name")}</TableHead>
                      <TableHead>{t("referenceData.methodType")}</TableHead>
                      <TableHead>{t("referenceData.lastFour")}</TableHead>
                      <TableHead>{t("transactions.status")}</TableHead>
                      <TableHead className="text-right">{t("transactions.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {references.data?.paymentMethods.map((method) => (
                      <TableRow key={method.id}>
                        <TableCell>
                          <span className="block font-medium">{method.displayName}</span>
                          {method.institution ? (
                            <span className="block text-xs text-muted-foreground">{method.institution}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{t(`referenceData.methods.${method.methodType}`)}</TableCell>
                        <TableCell className="tabular-nums">
                          {method.lastFour ? `•••• ${method.lastFour}` : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge active={method.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${t("referenceData.edit")}：${method.displayName}`}
                              onClick={() => setPaymentEditor({ record: method })}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`${t(method.isActive ? "referenceData.disable" : "referenceData.enable")}：${method.displayName}`}
                              disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ kind: "payment", record: method })}
                            >
                              {t(method.isActive ? "referenceData.disable" : "referenceData.enable")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle>{t("referenceData.householdMembers")}</CardTitle>
                <CardDescription>{t("referenceData.householdMembersDescription")}</CardDescription>
                <CardAction>
                  <Button size="sm" onClick={() => setMemberEditor({})}>
                    <PlusIcon data-icon="inline-start" />
                    {t("referenceData.addHouseholdMember")}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("referenceData.name")}</TableHead>
                      <TableHead>{t("referenceData.relationship")}</TableHead>
                      <TableHead>{t("transactions.status")}</TableHead>
                      <TableHead className="text-right">{t("transactions.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {references.data?.householdMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <span className="font-medium">{member.displayName}</span>
                          {member.isDefault ? (
                            <Badge variant="secondary" className="ml-2">
                              {t("referenceData.defaultMember")}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{member.relationship ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge active={member.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${t("referenceData.edit")}：${member.displayName}`}
                              onClick={() => setMemberEditor({ record: member })}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`${t(member.isActive ? "referenceData.disable" : "referenceData.enable")}：${member.displayName}`}
                              disabled={statusMutation.isPending || member.isDefault}
                              onClick={() => statusMutation.mutate({ kind: "member", record: member })}
                            >
                              {t(member.isActive ? "referenceData.disable" : "referenceData.enable")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle>{t("referenceData.locations")}</CardTitle>
                <CardDescription>{t("referenceData.locationsDescription")}</CardDescription>
                <CardAction>
                  <Button size="sm" onClick={() => setLocationEditor({})}>
                    <PlusIcon data-icon="inline-start" />
                    {t("referenceData.addLocation")}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("referenceData.name")}</TableHead>
                      <TableHead>{t("referenceData.city")}</TableHead>
                      <TableHead>{t("transactions.status")}</TableHead>
                      <TableHead className="text-right">{t("transactions.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {references.data?.locations.map((location) => (
                      <TableRow key={location.id}>
                        <TableCell>
                          <span className="block font-medium">{location.name}</span>
                          {location.addressLine ? (
                            <span className="block text-xs text-muted-foreground">{location.addressLine}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {location.city ?? "—"}
                          {location.isFavorite ? (
                            <Badge variant="outline" className="ml-2">
                              {t("referenceData.favorite")}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge active={location.isActive} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`${t("referenceData.edit")}：${location.name}`}
                              onClick={() => setLocationEditor({ record: location })}
                            >
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`${t(location.isActive ? "referenceData.disable" : "referenceData.enable")}：${location.name}`}
                              disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ kind: "location", record: location })}
                            >
                              {t(location.isActive ? "referenceData.disable" : "referenceData.enable")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
      <CategorySheet
        editor={categoryEditor}
        categories={references.data?.categories ?? []}
        onOpenChange={(open) => !open && setCategoryEditor(null)}
      />
      <PaymentMethodSheet editor={paymentEditor} onOpenChange={(open) => !open && setPaymentEditor(null)} />
      <HouseholdMemberSheet editor={memberEditor} onOpenChange={(open) => !open && setMemberEditor(null)} />
      <LocationSheet editor={locationEditor} onOpenChange={(open) => !open && setLocationEditor(null)} />
    </>
  )
}

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "请输入分类名称").max(100, "分类名称不能超过 100 个字符"),
  categoryType: z.enum(["income", "expense"]),
  parentId: z.string(),
})
type CategoryFormValues = z.infer<typeof categoryFormSchema>

function CategorySheet({
  editor,
  categories,
  onOpenChange,
}: {
  editor: CategoryEditor
  categories: Category[]
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const record = editor?.record
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: categoryValues(record),
  })
  useEffect(() => {
    if (editor) form.reset(categoryValues(record))
  }, [editor, form, record])
  const categoryType = useWatch({ control: form.control, name: "categoryType" })
  const mutation = useMutation({
    mutationFn: (values: CategoryFormValues) => {
      const input: SaveCategoryInput = {
        id: record?.id ?? null,
        name: values.name,
        categoryType: values.categoryType,
        parentId: values.parentId || null,
        icon: record?.icon ?? null,
        color: record?.color ?? null,
        isActive: record?.isActive ?? true,
      }
      return commandGateway.saveCategory(input)
    },
    onSuccess: async () => {
      await invalidateReferenceData(queryClient)
      toast.success(t("referenceData.saved"))
      onOpenChange(false)
    },
    onError: showError,
  })
  const parentOptions = categories.filter(
    (category) => category.parentId === null && category.categoryType === categoryType && category.id !== record?.id,
  )
  return (
    <Sheet open={Boolean(editor)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t(record ? "referenceData.editCategory" : "referenceData.addCategory")}</SheetTitle>
          <SheetDescription>{t("referenceData.categoriesDescription")}</SheetDescription>
        </SheetHeader>
        <form id="category-form" className="px-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="category-name">{t("referenceData.name")}</FieldLabel>
                  <Input {...field} id="category-name" aria-invalid={fieldState.invalid} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <ReferenceSelect
              control={form.control}
              name="categoryType"
              label={t("referenceData.categoryType")}
              disabled={Boolean(record)}
              items={(["expense", "income"] as const).map((value) => ({
                value,
                label: t(`referenceData.types.${value}`),
              }))}
            />
            <ReferenceSelect
              control={form.control}
              name="parentId"
              label={t("referenceData.parentCategory")}
              items={[
                { value: "", label: t("referenceData.rootCategory") },
                ...parentOptions.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="category-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(mutation.isPending ? "referenceData.saving" : "referenceData.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const paymentFormSchema = z.object({
  displayName: z.string().trim().min(1, "请输入名称").max(100, "名称不能超过 100 个字符"),
  methodType: z.enum(["cash", "debit_card", "credit_card", "chequing", "savings", "other"]),
  institution: z.string().max(100, "机构名称不能超过 100 个字符"),
  lastFour: z.string().refine((value) => !value || /^\d{4}$/.test(value), "尾号必须是四位数字"),
  defaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/, "请输入三位大写币种代码"),
})
type PaymentFormValues = z.infer<typeof paymentFormSchema>

function PaymentMethodSheet({
  editor,
  onOpenChange,
}: {
  editor: PaymentEditor
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const record = editor?.record
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: paymentValues(record),
  })
  useEffect(() => {
    if (editor) form.reset(paymentValues(record))
  }, [editor, form, record])
  const mutation = useMutation({
    mutationFn: (values: PaymentFormValues) => {
      const input: SavePaymentMethodInput = {
        id: record?.id ?? null,
        displayName: values.displayName,
        methodType: values.methodType,
        institution: values.institution || null,
        lastFour: values.lastFour || null,
        defaultCurrencyCode: values.defaultCurrencyCode,
        icon: record?.icon ?? null,
        color: record?.color ?? null,
        isActive: record?.isActive ?? true,
      }
      return commandGateway.savePaymentMethod(input)
    },
    onSuccess: async () => {
      await invalidateReferenceData(queryClient)
      toast.success(t("referenceData.saved"))
      onOpenChange(false)
    },
    onError: showError,
  })
  const methodTypes = ["cash", "debit_card", "credit_card", "chequing", "savings", "other"] as const
  return (
    <Sheet open={Boolean(editor)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t(record ? "referenceData.editPaymentMethod" : "referenceData.addPaymentMethod")}</SheetTitle>
          <SheetDescription>{t("referenceData.paymentMethodsDescription")}</SheetDescription>
        </SheetHeader>
        <form
          id="payment-method-form"
          className="px-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FieldGroup>
            <PaymentTextField control={form.control} name="displayName" label={t("referenceData.name")} />
            <ReferenceSelect
              control={form.control}
              name="methodType"
              label={t("referenceData.methodType")}
              items={methodTypes.map((value) => ({ value, label: t(`referenceData.methods.${value}`) }))}
            />
            <PaymentTextField control={form.control} name="institution" label={t("referenceData.institution")} />
            <PaymentTextField
              control={form.control}
              name="lastFour"
              label={t("referenceData.lastFour")}
              inputMode="numeric"
              maxLength={4}
              description={t("referenceData.lastFourDescription")}
            />
            <PaymentTextField
              control={form.control}
              name="defaultCurrencyCode"
              label={t("referenceData.defaultCurrency")}
              maxLength={3}
              uppercase
            />
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="payment-method-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(mutation.isPending ? "referenceData.saving" : "referenceData.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const householdMemberFormSchema = z.object({
  displayName: z.string().trim().min(1, "请输入姓名").max(100, "姓名不能超过 100 个字符"),
  relationship: z.string().trim().max(100, "关系不能超过 100 个字符"),
  isDefault: z.boolean(),
})
type HouseholdMemberFormValues = z.infer<typeof householdMemberFormSchema>

function HouseholdMemberSheet({
  editor,
  onOpenChange,
}: {
  editor: MemberEditor
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const record = editor?.record
  const form = useForm<HouseholdMemberFormValues>({
    resolver: zodResolver(householdMemberFormSchema),
    defaultValues: householdMemberValues(record),
  })
  useEffect(() => {
    if (editor) form.reset(householdMemberValues(record))
  }, [editor, form, record])
  const mutation = useMutation({
    mutationFn: (values: HouseholdMemberFormValues) => {
      const input: SaveHouseholdMemberInput = {
        id: record?.id ?? null,
        displayName: values.displayName,
        relationship: values.relationship || null,
        color: record?.color ?? null,
        isDefault: values.isDefault,
        isActive: record?.isActive ?? true,
      }
      return commandGateway.saveHouseholdMember(input)
    },
    onSuccess: async () => {
      await invalidateReferenceData(queryClient)
      toast.success(t("referenceData.saved"))
      onOpenChange(false)
    },
    onError: showError,
  })
  return (
    <Sheet open={Boolean(editor)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t(record ? "referenceData.editHouseholdMember" : "referenceData.addHouseholdMember")}
          </SheetTitle>
          <SheetDescription>{t("referenceData.householdMembersDescription")}</SheetDescription>
        </SheetHeader>
        <form
          id="household-member-form"
          className="px-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FieldGroup>
            <MemberTextField control={form.control} name="displayName" label={t("referenceData.name")} />
            <MemberTextField control={form.control} name="relationship" label={t("referenceData.relationship")} />
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor="household-member-default">{t("referenceData.setAsDefault")}</FieldLabel>
                    <FieldDescription>{t("referenceData.defaultMemberDescription")}</FieldDescription>
                  </div>
                  <Switch
                    id="household-member-default"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={record?.isDefault}
                  />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="household-member-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(mutation.isPending ? "referenceData.saving" : "referenceData.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const locationFormSchema = z.object({
  name: z.string().trim().min(1, "请输入地点名称").max(160, "地点名称不能超过 160 个字符"),
  addressLine: z.string().trim().max(240, "地址不能超过 240 个字符"),
  city: z.string().trim().max(100, "城市不能超过 100 个字符"),
  province: z.string().trim().max(100, "省份不能超过 100 个字符"),
  countryCode: z.string().refine((value) => !value || /^[A-Z]{2}$/.test(value), "请输入两位大写国家代码"),
  postalCode: z.string().trim().max(20, "邮政编码不能超过 20 个字符"),
  isFavorite: z.boolean(),
})
type LocationFormValues = z.infer<typeof locationFormSchema>

function LocationSheet({ editor, onOpenChange }: { editor: LocationEditor; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const record = editor?.record
  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: locationValues(record),
  })
  useEffect(() => {
    if (editor) form.reset(locationValues(record))
  }, [editor, form, record])
  const mutation = useMutation({
    mutationFn: (values: LocationFormValues) => {
      const input: SaveLocationInput = {
        id: record?.id ?? null,
        name: values.name,
        addressLine: values.addressLine || null,
        city: values.city || null,
        province: values.province || null,
        countryCode: values.countryCode || null,
        postalCode: values.postalCode || null,
        isFavorite: values.isFavorite,
        isActive: record?.isActive ?? true,
      }
      return commandGateway.saveLocation(input)
    },
    onSuccess: async () => {
      await invalidateReferenceData(queryClient)
      toast.success(t("referenceData.saved"))
      onOpenChange(false)
    },
    onError: showError,
  })
  return (
    <Sheet open={Boolean(editor)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t(record ? "referenceData.editLocation" : "referenceData.addLocation")}</SheetTitle>
          <SheetDescription>{t("referenceData.locationsDescription")}</SheetDescription>
        </SheetHeader>
        <form id="location-form" className="px-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <FieldGroup>
            <LocationTextField control={form.control} name="name" label={t("referenceData.name")} />
            <LocationTextField control={form.control} name="addressLine" label={t("referenceData.addressLine")} />
            <LocationTextField control={form.control} name="city" label={t("referenceData.city")} />
            <LocationTextField control={form.control} name="province" label={t("referenceData.province")} />
            <LocationTextField
              control={form.control}
              name="countryCode"
              label={t("referenceData.countryCode")}
              maxLength={2}
              uppercase
            />
            <LocationTextField control={form.control} name="postalCode" label={t("referenceData.postalCode")} />
            <Controller
              control={form.control}
              name="isFavorite"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldLabel className="flex-1" htmlFor="location-favorite">
                    {t("referenceData.markFavorite")}
                  </FieldLabel>
                  <Switch id="location-favorite" checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" form="location-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t(mutation.isPending ? "referenceData.saving" : "referenceData.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ReferenceSelect<T extends CategoryFormValues | PaymentFormValues>({
  control,
  name,
  label,
  items,
  disabled = false,
}: {
  control: import("react-hook-form").Control<T>
  name: import("react-hook-form").Path<T>
  label: string
  items: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  const fieldId = `reference-${String(name)}`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
          <Select
            value={String(field.value || "__root")}
            onValueChange={(value) => field.onChange(value === "__root" ? "" : value)}
            disabled={disabled}
          >
            <SelectTrigger id={fieldId} aria-invalid={fieldState.invalid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value || "__root"} value={item.value || "__root"}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function PaymentTextField({
  control,
  name,
  label,
  description,
  uppercase = false,
  ...inputProps
}: {
  control: import("react-hook-form").Control<PaymentFormValues>
  name: import("react-hook-form").Path<PaymentFormValues>
  label: string
  description?: string
  uppercase?: boolean
} & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`payment-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            {...inputProps}
            id={`payment-${name}`}
            value={String(field.value)}
            aria-invalid={fieldState.invalid}
            onChange={(event) => field.onChange(uppercase ? event.target.value.toUpperCase() : event.target.value)}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function MemberTextField({
  control,
  name,
  label,
}: {
  control: import("react-hook-form").Control<HouseholdMemberFormValues>
  name: "displayName" | "relationship"
  label: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`household-member-${name}`}>{label}</FieldLabel>
          <Input {...field} id={`household-member-${name}`} aria-invalid={fieldState.invalid} />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function LocationTextField({
  control,
  name,
  label,
  uppercase = false,
  ...inputProps
}: {
  control: import("react-hook-form").Control<LocationFormValues>
  name: "name" | "addressLine" | "city" | "province" | "countryCode" | "postalCode"
  label: string
  uppercase?: boolean
} & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`location-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            {...inputProps}
            id={`location-${name}`}
            aria-invalid={fieldState.invalid}
            onChange={(event) => field.onChange(uppercase ? event.target.value.toUpperCase() : event.target.value)}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function StatusBadge({ active }: { active: boolean }) {
  const { t } = useTranslation()
  return (
    <Badge variant={active ? "secondary" : "outline"}>
      {t(active ? "referenceData.active" : "referenceData.inactive")}
    </Badge>
  )
}

function categoryValues(record?: Category): CategoryFormValues {
  return {
    name: record?.name ?? "",
    categoryType: record?.categoryType ?? "expense",
    parentId: record?.parentId ?? "",
  }
}

function paymentValues(record?: PaymentMethod): PaymentFormValues {
  return {
    displayName: record?.displayName ?? "",
    methodType: record?.methodType ?? "cash",
    institution: record?.institution ?? "",
    lastFour: record?.lastFour ?? "",
    defaultCurrencyCode: record?.defaultCurrencyCode ?? "CAD",
  }
}

function householdMemberValues(record?: HouseholdMember): HouseholdMemberFormValues {
  return {
    displayName: record?.displayName ?? "",
    relationship: record?.relationship ?? "",
    isDefault: record?.isDefault ?? false,
  }
}

function locationValues(record?: Location): LocationFormValues {
  return {
    name: record?.name ?? "",
    addressLine: record?.addressLine ?? "",
    city: record?.city ?? "",
    province: record?.province ?? "",
    countryCode: record?.countryCode ?? "CA",
    postalCode: record?.postalCode ?? "",
    isFavorite: record?.isFavorite ?? false,
  }
}

async function invalidateReferenceData(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["transaction-reference-data"] }),
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  ])
}

function showError(error: Error) {
  toast.error(error.message)
}
