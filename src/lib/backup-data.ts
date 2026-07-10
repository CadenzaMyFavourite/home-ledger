import { z } from "zod"

export const backupRecordSchema = z.object({
  id: z.string(),
  backupType: z.string(),
  formatVersion: z.number().int(),
  schemaVersion: z.number().int(),
  appVersion: z.string(),
  filename: z.string(),
  status: z.string(),
  totalSize: z.number().int().nonnegative(),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
  failureCode: z.string().nullable(),
})
export const backupIdInputSchema = z.object({ backupId: z.string().min(1) })
export const backupVerificationResultSchema = z.object({
  backupId: z.string(),
  valid: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  totalSize: z.number().int().nonnegative(),
  checkedAt: z.string(),
})
export const stageRestoreInputSchema = z.object({ backupId: z.string().min(1), confirmationText: z.literal("RESTORE") })
export const stageRestoreResultSchema = z.object({
  backupId: z.string(),
  preRestoreBackupId: z.string(),
  restartRequired: z.boolean(),
})
export type BackupRecord = z.infer<typeof backupRecordSchema>
export type BackupIdInput = z.infer<typeof backupIdInputSchema>
export type BackupVerificationResult = z.infer<typeof backupVerificationResultSchema>
export type StageRestoreInput = z.infer<typeof stageRestoreInputSchema>
export type StageRestoreResult = z.infer<typeof stageRestoreResultSchema>
