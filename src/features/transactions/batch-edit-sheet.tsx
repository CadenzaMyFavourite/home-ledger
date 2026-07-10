import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  commandGateway,
  type BatchEditTransactionsResult,
  type BatchTransactionPatch,
  type TransactionRecord,
  type TransactionReferenceData,
} from "@/lib/commands"

type BatchEditSheetProps = {
  records: TransactionRecord[]
  referenceData: TransactionReferenceData
  onClose: () => void
  onApplied: () => void
}

const clearValue = "__clear"

export function BatchEditSheet({ records, referenceData, onClose, onApplied }: BatchEditSheetProps) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const queryClient = useQueryClient()
  const [useCategory, setUseCategory] = useState(false)
  const [categoryId, setCategoryId] = useState(clearValue)
  const [usePaymentMethod, setUsePaymentMethod] = useState(false)
  const [paymentMethodId, setPaymentMethodId] = useState(clearValue)
  const [useMember, setUseMember] = useState(false)
  const [memberId, setMemberId] = useState(clearValue)
  const [useStatus, setUseStatus] = useState(false)
  const [status, setStatus] = useState<"planned" | "pending" | "completed" | "cancelled">("completed")
  const [useTaxTag, setUseTaxTag] = useState(false)
  const [taxTagId, setTaxTagId] = useState("")
  const [taxTagSelected, setTaxTagSelected] = useState(true)
  const [result, setResult] = useState<BatchEditTransactionsResult | null>(null)
  const settings = useQuery({ queryKey: ["settings"], queryFn: commandGateway.getSettings })
  const taxOrganizer = useQuery({
    queryKey: ["tax-organizer", new Date().getFullYear(), settings.data?.reportingCurrencyCode],
    queryFn: () =>
      commandGateway.getTaxOrganizer({
        year: new Date().getFullYear(),
        reportingCurrencyCode: settings.data!.reportingCurrencyCode,
      }),
    enabled: Boolean(settings.data),
  })
  const selectedTypes = new Set(records.map((record) => record.transactionType))
  const categoryType =
    selectedTypes.size === 1 && !selectedTypes.has("transfer")
      ? (records[0]?.transactionType as "income" | "expense")
      : null
  const categories = referenceData.categories.filter(
    (category) => category.isActive && category.categoryType === categoryType,
  )
  const containsTransfer = selectedTypes.has("transfer")
  const items = records.map((record) => ({ id: record.id, version: record.version }))

  const undo = async (operationId: string) => {
    try {
      const undoResult = await commandGateway.undoBatchEditTransactions({ operationId })
      setResult(undoResult)
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      if (undoResult.conflicts.length > 0) {
        toast.error(
          zh
            ? `撤销未执行：${undoResult.conflicts.length} 笔记录后来又被修改`
            : `Undo not applied: ${undoResult.conflicts.length} records changed later`,
        )
      } else {
        toast.success(zh ? `已撤销 ${undoResult.items.length} 笔修改` : `Undid ${undoResult.items.length} changes`)
        onClose()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : zh ? "无法撤销批量编辑" : "Could not undo batch edit")
    }
  }
  const mutation = useMutation({
    mutationFn: (patch: BatchTransactionPatch) => commandGateway.batchEditTransactions({ items, patch }),
    onSuccess: async (nextResult) => {
      setResult(nextResult)
      onApplied()
      await queryClient.invalidateQueries({ queryKey: ["transactions"] })
      const successMessage = zh
        ? `已修改 ${nextResult.items.length} 笔记录`
        : `Updated ${nextResult.items.length} records`
      if (nextResult.conflicts.length === 0) {
        toast.success(successMessage, {
          action: nextResult.items.length
            ? {
                label: zh ? "撤销" : "Undo",
                onClick: () => void undo(nextResult.operationId),
              }
            : undefined,
        })
        onClose()
      } else {
        toast.warning(
          zh
            ? `${successMessage}，${nextResult.conflicts.length} 笔未修改`
            : `${successMessage}; ${nextResult.conflicts.length} were not changed`,
        )
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : zh ? "批量编辑失败" : "Batch edit failed"),
  })
  const submit = () => {
    const patch: BatchTransactionPatch = {}
    if (useCategory) patch.category = { value: categoryId === clearValue ? null : categoryId }
    if (usePaymentMethod) patch.paymentMethod = { value: paymentMethodId === clearValue ? null : paymentMethodId }
    if (useMember) patch.householdMember = { value: memberId === clearValue ? null : memberId }
    if (useStatus) patch.status = status
    if (useTaxTag && taxTagId) patch.taxTag = { taxTagId, selected: taxTagSelected }
    if (Object.keys(patch).length === 0) {
      toast.error(zh ? "请至少勾选一个需要修改的字段" : "Select at least one field to update")
      return
    }
    mutation.mutate(patch)
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{zh ? `批量编辑 ${records.length} 笔记录` : `Edit ${records.length} records`}</SheetTitle>
          <SheetDescription>
            {zh
              ? "只有左侧已勾选的字段会被更新。发生版本冲突的记录会保持原样并单独列出。"
              : "Only checked fields are updated. Version conflicts remain unchanged and are listed individually."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-4">
          <BatchField
            checked={useCategory}
            onCheckedChange={setUseCategory}
            label={zh ? "分类" : "Category"}
            disabled={!categoryType}
            disabledText={zh ? "收入、支出和转账不能混合修改分类" : "Mixed record types cannot share a category"}
          >
            <Select value={categoryId} onValueChange={setCategoryId} disabled={!useCategory}>
              <SelectTrigger aria-label={zh ? "批量分类" : "Batch category"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={clearValue}>{zh ? "清除分类" : "Clear category"}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.parentName ? `${category.parentName} → ${category.name}` : category.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </BatchField>

          <BatchField
            checked={usePaymentMethod}
            onCheckedChange={setUsePaymentMethod}
            label={zh ? "支付方式" : "Payment method"}
          >
            <Select value={paymentMethodId} onValueChange={setPaymentMethodId} disabled={!usePaymentMethod}>
              <SelectTrigger aria-label={zh ? "批量支付方式" : "Batch payment method"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={clearValue} disabled={containsTransfer}>
                    {zh ? "清除支付方式" : "Clear payment method"}
                  </SelectItem>
                  {referenceData.paymentMethods
                    .filter((method) => method.isActive)
                    .map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {method.displayName}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </BatchField>

          <BatchField checked={useMember} onCheckedChange={setUseMember} label={zh ? "家庭成员" : "Member"}>
            <Select value={memberId} onValueChange={setMemberId} disabled={!useMember}>
              <SelectTrigger aria-label={zh ? "批量家庭成员" : "Batch member"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={clearValue}>{zh ? "清除家庭成员" : "Clear member"}</SelectItem>
                  {referenceData.householdMembers
                    .filter((member) => member.isActive)
                    .map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </BatchField>

          <BatchField checked={useStatus} onCheckedChange={setUseStatus} label={zh ? "状态" : "Status"}>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)} disabled={!useStatus}>
              <SelectTrigger aria-label={zh ? "批量状态" : "Batch status"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">{zh ? "计划中" : "Planned"}</SelectItem>
                <SelectItem value="pending">{zh ? "等待确认" : "Pending"}</SelectItem>
                <SelectItem value="completed">{zh ? "已经完成" : "Completed"}</SelectItem>
                <SelectItem value="cancelled">{zh ? "已取消" : "Cancelled"}</SelectItem>
              </SelectContent>
            </Select>
          </BatchField>

          <BatchField
            checked={useTaxTag}
            onCheckedChange={setUseTaxTag}
            label={zh ? "税务标签" : "Tax tag"}
            disabled={containsTransfer}
            disabledText={zh ? "转账不能设置税务标签" : "Transfers cannot have tax tags"}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={taxTagId} onValueChange={setTaxTagId} disabled={!useTaxTag || taxOrganizer.isLoading}>
                <SelectTrigger aria-label={zh ? "批量税务标签" : "Batch tax tag"}>
                  <SelectValue placeholder={zh ? "选择税务标签" : "Select tax tag"} />
                </SelectTrigger>
                <SelectContent>
                  {taxOrganizer.data?.tags
                    .filter((tag) => tag.isActive)
                    .map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select
                value={taxTagSelected ? "add" : "remove"}
                onValueChange={(value) => setTaxTagSelected(value === "add")}
                disabled={!useTaxTag}
              >
                <SelectTrigger aria-label={zh ? "税务标签操作" : "Tax tag action"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">{zh ? "添加标签" : "Add tag"}</SelectItem>
                  <SelectItem value="remove">{zh ? "移除标签" : "Remove tag"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </BatchField>

          {result?.conflicts.length ? (
            <Alert variant="destructive">
              <AlertTriangleIcon aria-hidden="true" />
              <AlertTitle>
                {zh ? `${result.conflicts.length} 笔记录未修改` : `${result.conflicts.length} records were not changed`}
              </AlertTitle>
              <AlertDescription>
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5">
                  {result.conflicts.map((conflict) => {
                    const record = records.find((item) => item.id === conflict.id)
                    return (
                      <li key={conflict.id}>
                        <span className="font-medium">
                          {record?.merchant ?? record?.transactionDate ?? conflict.id}
                        </span>
                        {`: ${conflict.message}`}
                      </li>
                    )
                  })}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <SheetFooter className="mt-auto">
          {result?.items.length && result.conflicts.length ? (
            <Button type="button" variant="outline" onClick={() => void undo(result.operationId)}>
              <RotateCcwIcon data-icon="inline-start" />
              {zh ? `撤销已修改的 ${result.items.length} 笔` : `Undo ${result.items.length} updated records`}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {zh ? "关闭" : "Close"}
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? (zh ? "正在应用…" : "Applying…") : zh ? "应用批量修改" : "Apply changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function BatchField({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  disabledText,
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  disabledText?: string
  children: React.ReactNode
}) {
  const id = `batch-${label.replaceAll(" ", "-")}`
  return (
    <section className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        />
        <Label htmlFor={id} className="font-medium">
          {label}
        </Label>
      </div>
      {disabled && disabledText ? <p className="text-xs text-muted-foreground">{disabledText}</p> : children}
    </section>
  )
}
