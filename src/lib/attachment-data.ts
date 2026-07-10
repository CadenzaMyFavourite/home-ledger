import { z } from "zod"

export const attachmentOwnerTypeSchema = z.enum(["transaction", "event", "daily_note"])
export const attachmentTypeSchema = z.enum(["receipt", "invoice", "image", "pdf", "contract", "other"])

export const attachmentOwnerInputSchema = z.object({
  ownerType: attachmentOwnerTypeSchema,
  ownerId: z.string().trim().min(1).max(100),
})

export const pickAttachmentInputSchema = attachmentOwnerInputSchema.extend({
  attachmentType: attachmentTypeSchema,
})

export const attachmentAccessInputSchema = attachmentOwnerInputSchema.extend({
  id: z.string().trim().min(1).max(100),
})

export const attachmentRecordSchema = attachmentAccessInputSchema.extend({
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  attachmentType: attachmentTypeSchema,
  createdAt: z.string(),
})

export type AttachmentOwnerType = z.infer<typeof attachmentOwnerTypeSchema>
export type AttachmentType = z.infer<typeof attachmentTypeSchema>
export type AttachmentOwnerInput = z.infer<typeof attachmentOwnerInputSchema>
export type PickAttachmentInput = z.infer<typeof pickAttachmentInputSchema>
export type AttachmentAccessInput = z.infer<typeof attachmentAccessInputSchema>
export type AttachmentRecord = z.infer<typeof attachmentRecordSchema>
