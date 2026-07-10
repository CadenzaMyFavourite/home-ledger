-- Add optimistic concurrency to editable daily notes.

ALTER TABLE daily_notes
    ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE INDEX daily_notes_active_date
    ON daily_notes(note_date, household_member_id)
    WHERE deleted_at IS NULL;
