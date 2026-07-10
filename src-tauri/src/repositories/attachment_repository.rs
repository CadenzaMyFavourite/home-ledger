use crate::domain::attachments::{
    AttachmentAccessInput, AttachmentOwnerInput, AttachmentOwnerType, AttachmentRecord,
    AttachmentType, LinkedStoredAttachment, MAX_ATTACHMENTS_PER_OWNER, PickAttachmentInput,
    StoredAttachment, UnlinkAttachmentResult,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct AttachmentRepository {
    database: SqlitePool,
}

impl AttachmentRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn ensure_owner_can_accept(
        &self,
        owner: &AttachmentOwnerInput,
    ) -> Result<(), AppError> {
        let exists = owner_exists(&self.database, owner.owner_type, &owner.owner_id).await?;
        if !exists {
            return Err(AppError::not_found(
                owner.owner_type.as_str(),
                "要关联附件的记录不存在或已删除",
            ));
        }
        let count =
            owner_attachment_count(&self.database, owner.owner_type, &owner.owner_id).await?;
        if count >= MAX_ATTACHMENTS_PER_OWNER {
            return Err(AppError::validation(
                "ownerId",
                "单条记录最多关联 50 个附件",
            ));
        }
        Ok(())
    }

    pub async fn list(
        &self,
        owner: &AttachmentOwnerInput,
    ) -> Result<Vec<AttachmentRecord>, AppError> {
        let rows = match owner.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query(
                    "SELECT a.id, a.original_filename, a.mime_type, a.file_size, a.sha256,
                            a.attachment_type, a.created_at
                     FROM transaction_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.transaction_id = ? AND a.deleted_at IS NULL
                     ORDER BY link.sort_order, a.created_at, a.id",
                )
                .bind(&owner.owner_id)
                .fetch_all(&self.database)
                .await?
            }
            AttachmentOwnerType::Event => {
                sqlx::query(
                    "SELECT a.id, a.original_filename, a.mime_type, a.file_size, a.sha256,
                            a.attachment_type, a.created_at
                     FROM event_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.event_id = ? AND a.deleted_at IS NULL
                     ORDER BY link.sort_order, a.created_at, a.id",
                )
                .bind(&owner.owner_id)
                .fetch_all(&self.database)
                .await?
            }
            AttachmentOwnerType::DailyNote => {
                sqlx::query(
                    "SELECT a.id, a.original_filename, a.mime_type, a.file_size, a.sha256,
                            a.attachment_type, a.created_at
                     FROM daily_note_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.daily_note_id = ? AND a.deleted_at IS NULL
                     ORDER BY link.sort_order, a.created_at, a.id",
                )
                .bind(&owner.owner_id)
                .fetch_all(&self.database)
                .await?
            }
        };
        rows.iter()
            .map(|row| map_record(row, owner.owner_type, &owner.owner_id))
            .collect()
    }

    pub async fn create_and_link(
        &self,
        input: &PickAttachmentInput,
        stored: &StoredAttachment,
    ) -> Result<AttachmentRecord, AppError> {
        let mut transaction = self.database.begin().await?;
        let exists = match input.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT EXISTS(SELECT 1 FROM transactions WHERE id = ? AND deleted_at IS NULL)",
                )
                .bind(&input.owner_id)
                .fetch_one(&mut *transaction)
                .await?
            }
            AttachmentOwnerType::Event => sqlx::query_scalar::<_, i64>(
                "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id = ? AND deleted_at IS NULL)",
            )
            .bind(&input.owner_id)
            .fetch_one(&mut *transaction)
            .await?,
            AttachmentOwnerType::DailyNote => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT EXISTS(SELECT 1 FROM daily_notes WHERE id = ? AND deleted_at IS NULL)",
                )
                .bind(&input.owner_id)
                .fetch_one(&mut *transaction)
                .await?
            }
        } == 1;
        if !exists {
            return Err(AppError::not_found(
                input.owner_type.as_str(),
                "要关联附件的记录不存在或已删除",
            ));
        }

        let count = match input.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM transaction_attachments WHERE transaction_id = ?",
                )
                .bind(&input.owner_id)
                .fetch_one(&mut *transaction)
                .await?
            }
            AttachmentOwnerType::Event => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM event_attachments WHERE event_id = ?",
                )
                .bind(&input.owner_id)
                .fetch_one(&mut *transaction)
                .await?
            }
            AttachmentOwnerType::DailyNote => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM daily_note_attachments WHERE daily_note_id = ?",
                )
                .bind(&input.owner_id)
                .fetch_one(&mut *transaction)
                .await?
            }
        };
        if count >= MAX_ATTACHMENTS_PER_OWNER {
            return Err(AppError::validation(
                "ownerId",
                "单条记录最多关联 50 个附件",
            ));
        }

        sqlx::query(
            "INSERT INTO attachments(
                id, original_filename, stored_filename, relative_path, mime_type,
                file_size, sha256, attachment_type, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&stored.id)
        .bind(&stored.original_filename)
        .bind(&stored.stored_filename)
        .bind(&stored.relative_path)
        .bind(&stored.mime_type)
        .bind(stored.file_size)
        .bind(&stored.sha256)
        .bind(stored.attachment_type.as_str())
        .bind(&stored.created_at)
        .execute(&mut *transaction)
        .await?;

        match input.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query(
                    "INSERT INTO transaction_attachments(transaction_id, attachment_id, sort_order, created_at)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(&input.owner_id)
                .bind(&stored.id)
                .bind(count)
                .bind(&stored.created_at)
                .execute(&mut *transaction)
                .await?;
            }
            AttachmentOwnerType::Event => {
                sqlx::query(
                    "INSERT INTO event_attachments(event_id, attachment_id, sort_order, created_at)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(&input.owner_id)
                .bind(&stored.id)
                .bind(count)
                .bind(&stored.created_at)
                .execute(&mut *transaction)
                .await?;
            }
            AttachmentOwnerType::DailyNote => {
                sqlx::query(
                    "INSERT INTO daily_note_attachments(daily_note_id, attachment_id, sort_order, created_at)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(&input.owner_id)
                .bind(&stored.id)
                .bind(count)
                .bind(&stored.created_at)
                .execute(&mut *transaction)
                .await?;
            }
        }
        insert_audit(
            &mut transaction,
            AttachmentAudit {
                action: "attach",
                attachment_id: &stored.id,
                owner_type: input.owner_type,
                owner_id: &input.owner_id,
                filename: &stored.original_filename,
                file_size: stored.file_size,
                occurred_at: &stored.created_at,
            },
        )
        .await?;
        transaction.commit().await?;

        Ok(AttachmentRecord {
            id: stored.id.clone(),
            owner_type: input.owner_type,
            owner_id: input.owner_id.clone(),
            original_filename: stored.original_filename.clone(),
            mime_type: stored.mime_type.clone(),
            file_size: stored.file_size,
            sha256: stored.sha256.clone(),
            attachment_type: stored.attachment_type,
            created_at: stored.created_at.clone(),
        })
    }

    pub async fn get_linked(
        &self,
        input: &AttachmentAccessInput,
    ) -> Result<LinkedStoredAttachment, AppError> {
        let row =
            match input.owner_type {
                AttachmentOwnerType::Transaction => sqlx::query(
                    "SELECT a.id, a.original_filename, a.relative_path, a.mime_type, a.file_size,
                            a.sha256, a.attachment_type, a.created_at
                     FROM transaction_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.transaction_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&self.database)
                .await?,
                AttachmentOwnerType::Event => sqlx::query(
                    "SELECT a.id, a.original_filename, a.relative_path, a.mime_type, a.file_size,
                            a.sha256, a.attachment_type, a.created_at
                     FROM event_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.event_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&self.database)
                .await?,
                AttachmentOwnerType::DailyNote => sqlx::query(
                    "SELECT a.id, a.original_filename, a.relative_path, a.mime_type, a.file_size,
                            a.sha256, a.attachment_type, a.created_at
                     FROM daily_note_attachments link
                     JOIN attachments a ON a.id = link.attachment_id
                     WHERE link.daily_note_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&self.database)
                .await?,
            }
            .ok_or_else(|| AppError::not_found("attachment", "附件不存在或未关联到这条记录"))?;
        Ok(LinkedStoredAttachment {
            record: map_record(&row, input.owner_type, &input.owner_id)?,
            relative_path: row.get("relative_path"),
        })
    }

    pub async fn unlink(
        &self,
        input: &AttachmentAccessInput,
    ) -> Result<UnlinkAttachmentResult, AppError> {
        let mut transaction = self.database.begin().await?;
        let relative_path: Option<String> = match input.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query_scalar(
                    "SELECT a.relative_path FROM transaction_attachments link
                 JOIN attachments a ON a.id = link.attachment_id
                 WHERE link.transaction_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&mut *transaction)
                .await?
            }
            AttachmentOwnerType::Event => {
                sqlx::query_scalar(
                    "SELECT a.relative_path FROM event_attachments link
                 JOIN attachments a ON a.id = link.attachment_id
                 WHERE link.event_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&mut *transaction)
                .await?
            }
            AttachmentOwnerType::DailyNote => {
                sqlx::query_scalar(
                    "SELECT a.relative_path FROM daily_note_attachments link
                 JOIN attachments a ON a.id = link.attachment_id
                 WHERE link.daily_note_id = ? AND a.id = ? AND a.deleted_at IS NULL",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .fetch_optional(&mut *transaction)
                .await?
            }
        };
        let relative_path = relative_path
            .ok_or_else(|| AppError::not_found("attachment", "附件不存在或未关联到这条记录"))?;
        let now = Utc::now().to_rfc3339();

        match input.owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query(
                    "DELETE FROM transaction_attachments WHERE transaction_id = ? AND attachment_id = ?",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .execute(&mut *transaction)
                .await?;
            }
            AttachmentOwnerType::Event => {
                sqlx::query(
                    "DELETE FROM event_attachments WHERE event_id = ? AND attachment_id = ?",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .execute(&mut *transaction)
                .await?;
            }
            AttachmentOwnerType::DailyNote => {
                sqlx::query(
                    "DELETE FROM daily_note_attachments WHERE daily_note_id = ? AND attachment_id = ?",
                )
                .bind(&input.owner_id)
                .bind(&input.id)
                .execute(&mut *transaction)
                .await?;
            }
        }

        let remaining_references: i64 = sqlx::query_scalar(
            "SELECT
                (SELECT COUNT(*) FROM transaction_attachments WHERE attachment_id = ?) +
                (SELECT COUNT(*) FROM event_attachments WHERE attachment_id = ?) +
                (SELECT COUNT(*) FROM daily_note_attachments WHERE attachment_id = ?)",
        )
        .bind(&input.id)
        .bind(&input.id)
        .bind(&input.id)
        .fetch_one(&mut *transaction)
        .await?;
        let delete_managed_file = remaining_references == 0;
        if delete_managed_file {
            sqlx::query("UPDATE attachments SET deleted_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&input.id)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, after_json
             ) VALUES (?, ?, 'user', 'detach', 'attachment', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&input.id)
        .bind(
            serde_json::json!({
                "ownerType": input.owner_type.as_str(),
                "ownerId": input.owner_id,
                "deletedManagedFile": delete_managed_file,
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(UnlinkAttachmentResult {
            relative_path,
            delete_managed_file,
        })
    }
}

async fn owner_exists(
    database: &SqlitePool,
    owner_type: AttachmentOwnerType,
    owner_id: &str,
) -> Result<bool, AppError> {
    let exists =
        match owner_type {
            AttachmentOwnerType::Transaction => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT EXISTS(SELECT 1 FROM transactions WHERE id = ? AND deleted_at IS NULL)",
                )
                .bind(owner_id)
                .fetch_one(database)
                .await?
            }
            AttachmentOwnerType::Event => sqlx::query_scalar::<_, i64>(
                "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id = ? AND deleted_at IS NULL)",
            )
            .bind(owner_id)
            .fetch_one(database)
            .await?,
            AttachmentOwnerType::DailyNote => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT EXISTS(SELECT 1 FROM daily_notes WHERE id = ? AND deleted_at IS NULL)",
                )
                .bind(owner_id)
                .fetch_one(database)
                .await?
            }
        };
    Ok(exists == 1)
}

async fn owner_attachment_count(
    database: &SqlitePool,
    owner_type: AttachmentOwnerType,
    owner_id: &str,
) -> Result<i64, AppError> {
    Ok(match owner_type {
        AttachmentOwnerType::Transaction => {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM transaction_attachments WHERE transaction_id = ?",
            )
            .bind(owner_id)
            .fetch_one(database)
            .await?
        }
        AttachmentOwnerType::Event => {
            sqlx::query_scalar("SELECT COUNT(*) FROM event_attachments WHERE event_id = ?")
                .bind(owner_id)
                .fetch_one(database)
                .await?
        }
        AttachmentOwnerType::DailyNote => {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM daily_note_attachments WHERE daily_note_id = ?",
            )
            .bind(owner_id)
            .fetch_one(database)
            .await?
        }
    })
}

fn map_record(
    row: &SqliteRow,
    owner_type: AttachmentOwnerType,
    owner_id: &str,
) -> Result<AttachmentRecord, AppError> {
    let attachment_type: String = row.get("attachment_type");
    Ok(AttachmentRecord {
        id: row.get("id"),
        owner_type,
        owner_id: owner_id.to_owned(),
        original_filename: row.get("original_filename"),
        mime_type: row.get("mime_type"),
        file_size: row.get("file_size"),
        sha256: row.get("sha256"),
        attachment_type: AttachmentType::from_stored(&attachment_type)?,
        created_at: row.get("created_at"),
    })
}

struct AttachmentAudit<'a> {
    action: &'a str,
    attachment_id: &'a str,
    owner_type: AttachmentOwnerType,
    owner_id: &'a str,
    filename: &'a str,
    file_size: i64,
    occurred_at: &'a str,
}

async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    audit: AttachmentAudit<'_>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(
            id, occurred_at, actor_type, action, entity_type, entity_id, after_json
         ) VALUES (?, ?, 'user', ?, 'attachment', ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(audit.occurred_at)
    .bind(audit.action)
    .bind(audit.attachment_id)
    .bind(
        serde_json::json!({
            "ownerType": audit.owner_type.as_str(),
            "ownerId": audit.owner_id,
            "originalFilename": audit.filename,
            "fileSize": audit.file_size,
        })
        .to_string(),
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::attachments::{AttachmentOwnerType, AttachmentType};
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn daily_note_attachment_uses_the_same_audited_link_contract() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("daily-attachment.sqlite3"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO daily_notes(id, note_date, note, version, created_at, updated_at)
             VALUES ('note-1', '2026-07-04', 'Picnic', 1, '2026-07-04T12:00:00Z', '2026-07-04T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        let repository = AttachmentRepository::new(database.clone());
        let input = PickAttachmentInput {
            owner_type: AttachmentOwnerType::DailyNote,
            owner_id: "note-1".into(),
            attachment_type: AttachmentType::Image,
        };
        let stored = StoredAttachment {
            id: "attachment-1".into(),
            original_filename: "picnic.jpg".into(),
            stored_filename: "attachment-1.jpg".into(),
            relative_path: "attachments/attachment-1.jpg".into(),
            mime_type: "image/jpeg".into(),
            file_size: 4,
            sha256: "a".repeat(64),
            attachment_type: AttachmentType::Image,
            created_at: "2026-07-04T12:00:00Z".into(),
        };
        let linked = repository.create_and_link(&input, &stored).await.unwrap();
        assert_eq!(linked.owner_type, AttachmentOwnerType::DailyNote);
        let records = repository
            .list(&AttachmentOwnerInput {
                owner_type: AttachmentOwnerType::DailyNote,
                owner_id: "note-1".into(),
            })
            .await
            .unwrap();
        assert_eq!(records.len(), 1);
        let unlinked = repository
            .unlink(&AttachmentAccessInput {
                id: stored.id.clone(),
                owner_type: AttachmentOwnerType::DailyNote,
                owner_id: "note-1".into(),
            })
            .await
            .unwrap();
        assert!(unlinked.delete_managed_file);
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE entity_id = 'attachment-1'",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(audit_count, 2);
    }
}
