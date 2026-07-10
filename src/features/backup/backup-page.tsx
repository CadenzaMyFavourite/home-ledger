import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArchiveIcon, CheckCircleIcon, CircleAlertIcon, RefreshCcwIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { commandGateway, type BackupRecord } from "@/lib/commands"

export function BackupPage() {
  const { i18n } = useTranslation()
  const zh = i18n.language !== "en-CA"
  const desktop = window.__TAURI_INTERNALS__ !== undefined
  const queryClient = useQueryClient()
  const [restore, setRestore] = useState<BackupRecord | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const backups = useQuery({ queryKey: ["backups"], queryFn: commandGateway.listBackups })
  const create = useMutation({
    mutationFn: commandGateway.createBackup,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  })
  const verify = useMutation({
    mutationFn: commandGateway.verifyBackup,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  })
  const stage = useMutation({ mutationFn: commandGateway.stageBackupRestore })
  return (
    <>
      <PageHeader
        title={zh ? "备份与恢复" : "Backup and restore"}
        description={
          zh
            ? "备份数据库、完整 JSON、附件和设置；恢复前自动创建当前数据恢复点"
            : "Back up the database, complete JSON, attachments, and settings; create a recovery point before restore"
        }
        actions={
          <Button disabled={!desktop || create.isPending} onClick={() => create.mutate()}>
            <ArchiveIcon aria-hidden="true" />
            {create.isPending ? (zh ? "正在备份" : "Backing up") : zh ? "创建完整备份" : "Create full backup"}
          </Button>
        }
      />
      <main className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
        {!desktop ? (
          <Alert>
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{zh ? "桌面应用功能" : "Desktop app feature"}</AlertTitle>
            <AlertDescription>
              {zh
                ? "浏览器预览不会访问真实数据库或附件。完整备份和恢复仅在 Tauri 桌面应用中运行。"
                : "Browser preview never accesses the real database or attachments. Full backup and restore run only in Tauri."}
            </AlertDescription>
          </Alert>
        ) : null}
        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>{zh ? "恢复不会立即覆盖运行中的数据库" : "Restore never overwrites an open database"}</AlertTitle>
          <AlertDescription>
            {zh
              ? "系统先验证 manifest、每个文件的 SHA-256、SQLite 完整性和版本，再创建恢复前备份。确认后暂存恢复内容，关闭并重新打开应用时原子切换；启动失败会回滚。"
              : "The app verifies the manifest, every SHA-256, SQLite integrity, and version, then creates a pre-restore backup. Confirmed data is staged and atomically swapped on restart; startup failure rolls back."}
          </AlertDescription>
        </Alert>
        {stage.isSuccess ? (
          <Alert className="border-emerald-300">
            <CheckCircleIcon aria-hidden="true" />
            <AlertTitle>{zh ? "恢复已安全暂存" : "Restore safely staged"}</AlertTitle>
            <AlertDescription>
              {zh
                ? "请关闭并重新打开 HomeLedger。恢复前备份已经创建；重启完成前不要移动应用数据目录。"
                : "Close and reopen HomeLedger. A pre-restore backup was created; do not move the app data folder before restart."}
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{zh ? "备份历史" : "Backup history"}</CardTitle>
            <CardDescription>
              {zh
                ? "备份保存在应用数据目录的 backups 文件夹中。"
                : "Backups are stored in the app data backups folder."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {backups.data?.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{zh ? "创建时间" : "Created"}</TableHead>
                      <TableHead>{zh ? "类型" : "Type"}</TableHead>
                      <TableHead>{zh ? "状态" : "Status"}</TableHead>
                      <TableHead>{zh ? "文件" : "File"}</TableHead>
                      <TableHead>{zh ? "大小" : "Size"}</TableHead>
                      <TableHead>{zh ? "操作" : "Actions"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.data.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{new Date(item.createdAt).toLocaleString(i18n.language)}</TableCell>
                        <TableCell>{item.backupType}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.status}</Badge>
                        </TableCell>
                        <TableCell className="max-w-64 truncate" title={item.filename}>
                          {item.filename}
                        </TableCell>
                        <TableCell>{formatBytes(item.totalSize)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={verify.isPending}
                              onClick={() => verify.mutate({ backupId: item.id })}
                            >
                              <ShieldCheckIcon aria-hidden="true" />
                              {zh ? "验证" : "Verify"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRestore(item)
                                setConfirmation("")
                                stage.reset()
                              }}
                            >
                              <RefreshCcwIcon aria-hidden="true" />
                              {zh ? "恢复" : "Restore"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{zh ? "还没有备份。" : "No backups yet."}</p>
            )}
          </CardContent>
        </Card>
        {restore && !stage.isSuccess ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>{zh ? "确认恢复" : "Confirm restore"}</CardTitle>
              <CardDescription>
                {zh
                  ? `将从 ${restore.filename} 恢复。此操作会先备份当前数据，不会静默覆盖。`
                  : `Restore from ${restore.filename}. Current data is backed up first and never silently overwritten.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-xl gap-3">
              <label className="grid gap-1 text-sm font-medium">
                <span>{zh ? "输入 RESTORE 确认" : "Type RESTORE to confirm"}</span>
                <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={confirmation !== "RESTORE" || stage.isPending}
                  onClick={() => stage.mutate({ backupId: restore.id, confirmationText: "RESTORE" })}
                >
                  {zh ? "创建恢复点并暂存恢复" : "Create recovery point and stage restore"}
                </Button>
                <Button variant="ghost" onClick={() => setRestore(null)}>
                  {zh ? "取消" : "Cancel"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {[create, verify, stage].map((mutation, index) =>
          mutation.isError ? (
            <p key={index} className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null,
        )}
      </main>
    </>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}
