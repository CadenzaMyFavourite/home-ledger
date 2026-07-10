import { z } from "zod"

export const getDailyNoteInputSchema = z.object({
  noteDate: z.string().date(),
  householdMemberId: z.string().min(1).max(100).nullable(),
})
export const saveDailyNoteInputSchema = getDailyNoteInputSchema.extend({
  id: z.string().min(1).max(100).nullable(),
  version: z.number().int().positive().nullable(),
  note: z.string().max(10_000),
})
export const deleteDailyNoteInputSchema = z.object({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
})
export const dailyNoteRecordSchema = z.object({
  id: z.string(),
  noteDate: z.string().date(),
  householdMemberId: z.string().nullable(),
  householdMemberName: z.string().nullable(),
  note: z.string(),
  attachmentCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type GetDailyNoteInput = z.infer<typeof getDailyNoteInputSchema>
export type SaveDailyNoteInput = z.infer<typeof saveDailyNoteInputSchema>
export type DeleteDailyNoteInput = z.infer<typeof deleteDailyNoteInputSchema>
export type DailyNoteRecord = z.infer<typeof dailyNoteRecordSchema>

const storageKey = "home-ledger:daily-notes:v1"

export function getBrowserDailyNote(input: GetDailyNoteInput): DailyNoteRecord | null {
  const validated = getDailyNoteInputSchema.parse(input)
  return (
    readNotes().find(
      (note) => note.noteDate === validated.noteDate && note.householdMemberId === validated.householdMemberId,
    ) ?? null
  )
}

export function saveBrowserDailyNote(input: SaveDailyNoteInput): DailyNoteRecord {
  const validated = saveDailyNoteInputSchema.parse(input)
  if ((validated.id === null) !== (validated.version === null)) {
    throw new Error("更新每日备注时必须同时提供记录 ID 和版本")
  }
  const notes = readNotes()
  const now = new Date().toISOString()
  if (validated.id) {
    const index = notes.findIndex((note) => note.id === validated.id && note.version === validated.version)
    if (index < 0) throw new Error("每日备注已被修改或删除，请刷新后重试")
    const existing = notes[index]!
    const saved = dailyNoteRecordSchema.parse({
      ...existing,
      noteDate: validated.noteDate,
      householdMemberId: validated.householdMemberId,
      note: validated.note,
      version: existing.version + 1,
      updatedAt: now,
    })
    notes[index] = saved
    writeNotes(notes)
    return saved
  }
  if (
    notes.some((note) => note.noteDate === validated.noteDate && note.householdMemberId === validated.householdMemberId)
  ) {
    throw new Error("这一天已经存在相同成员的备注")
  }
  const saved = dailyNoteRecordSchema.parse({
    id: window.crypto.randomUUID(),
    noteDate: validated.noteDate,
    householdMemberId: validated.householdMemberId,
    householdMemberName: null,
    note: validated.note,
    attachmentCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
  writeNotes([saved, ...notes])
  return saved
}

export function deleteBrowserDailyNote(input: DeleteDailyNoteInput) {
  const validated = deleteDailyNoteInputSchema.parse(input)
  const notes = readNotes()
  const record = notes.find((note) => note.id === validated.id && note.version === validated.version)
  if (!record) throw new Error("每日备注已被修改或删除，请刷新后重试")
  if (record.attachmentCount > 0) throw new Error("请先移除每日备注中的附件，再删除这条备注")
  writeNotes(notes.filter((note) => note.id !== validated.id))
}

function readNotes(): DailyNoteRecord[] {
  try {
    return z.array(dailyNoteRecordSchema).parse(JSON.parse(localStorage.getItem(storageKey) ?? "[]"))
  } catch {
    return []
  }
}

function writeNotes(notes: DailyNoteRecord[]) {
  localStorage.setItem(storageKey, JSON.stringify(notes))
}
