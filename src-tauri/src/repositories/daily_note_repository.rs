use crate::domain::daily_notes::{
    DailyNoteRecord, DeleteDailyNoteInput, GetDailyNoteInput, SaveDailyNoteInput,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct DailyNoteRepository {
    database: SqlitePool,
}

impl DailyNoteRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn get(
        &self,
        input: &GetDailyNoteInput,
    ) -> Result<Option<DailyNoteRecord>, AppError> {
        let row = sqlx::query(
            "SELECT n.id, n.note_date, n.household_member_id, hm.display_name AS household_member_name,
                    n.note, n.version, n.created_at, n.updated_at,
                    (SELECT COUNT(*) FROM daily_note_attachments link
                     JOIN attachments a ON a.id = link.attachment_id AND a.deleted_at IS NULL
                     WHERE link.daily_note_id = n.id) AS attachment_count
             FROM daily_notes n
             LEFT JOIN household_members hm ON hm.id = n.household_member_id
             WHERE n.note_date = ? AND COALESCE(n.household_member_id, '') = COALESCE(?, '')
               AND n.deleted_at IS NULL",
        )
        .bind(&input.note_date)
        .bind(&input.household_member_id)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_record))
    }

    pub async fn save(&self, input: &SaveDailyNoteInput) -> Result<DailyNoteRecord, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM daily_notes
                WHERE note_date = ? AND COALESCE(household_member_id, '') = COALESCE(?, '')
                  AND deleted_at IS NULL AND id <> ?
             )",
        )
        .bind(&input.note_date)
        .bind(&input.household_member_id)
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            return Err(AppError::conflict("这一天已经存在相同成员的备注"));
        }

        let action;
        if let (Some(_), Some(version)) = (&input.id, input.version) {
            let result = sqlx::query(
                "UPDATE daily_notes SET note_date = ?, household_member_id = ?, note = ?,
                        version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(&input.note_date)
            .bind(&input.household_member_id)
            .bind(&input.note)
            .bind(&now)
            .bind(&id)
            .bind(version)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                return Err(AppError::conflict("每日备注已被修改或删除，请刷新后重试"));
            }
            action = "update_daily_note";
        } else {
            sqlx::query(
                "INSERT INTO daily_notes(
                    id, note_date, household_member_id, note, version, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 1, ?, ?)",
            )
            .bind(&id)
            .bind(&input.note_date)
            .bind(&input.household_member_id)
            .bind(&input.note)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            action = "create_daily_note";
        }
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, after_json
             ) VALUES (?, ?, 'user', ?, 'daily_note', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(action)
        .bind(&id)
        .bind(
            serde_json::json!({
                "noteDate": input.note_date,
                "householdMemberId": input.household_member_id,
                "noteLength": input.note.chars().count(),
                "version": input.version.unwrap_or(0) + 1,
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.get_by_id(&id).await
    }

    pub async fn delete(&self, input: &DeleteDailyNoteInput) -> Result<(), AppError> {
        let attachment_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM daily_note_attachments WHERE daily_note_id = ?",
        )
        .bind(&input.id)
        .fetch_one(&self.database)
        .await?;
        if attachment_count > 0 {
            return Err(AppError::conflict(
                "请先移除每日备注中的附件，再删除这条备注",
            ));
        }
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE daily_notes SET deleted_at = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(&input.id)
        .bind(input.version)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AppError::conflict("每日备注已被修改或删除，请刷新后重试"));
        }
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, after_json
             ) VALUES (?, ?, 'user', 'delete_daily_note', 'daily_note', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&input.id)
        .bind(serde_json::json!({ "version": input.version + 1 }).to_string())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn get_by_id(&self, id: &str) -> Result<DailyNoteRecord, AppError> {
        let row = sqlx::query(
            "SELECT n.id, n.note_date, n.household_member_id, hm.display_name AS household_member_name,
                    n.note, n.version, n.created_at, n.updated_at,
                    (SELECT COUNT(*) FROM daily_note_attachments link
                     JOIN attachments a ON a.id = link.attachment_id AND a.deleted_at IS NULL
                     WHERE link.daily_note_id = n.id) AS attachment_count
             FROM daily_notes n
             LEFT JOIN household_members hm ON hm.id = n.household_member_id
             WHERE n.id = ? AND n.deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("daily_note", "每日备注不存在"))?;
        Ok(map_record(&row))
    }
}

fn map_record(row: &sqlx::sqlite::SqliteRow) -> DailyNoteRecord {
    DailyNoteRecord {
        id: row.get("id"),
        note_date: row.get("note_date"),
        household_member_id: row.get("household_member_id"),
        household_member_name: row.get("household_member_name"),
        note: row.get("note"),
        attachment_count: row.get("attachment_count"),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn daily_note_crud_uses_versions_and_audit_events() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("daily-notes.sqlite3"))
            .await
            .unwrap();
        let repository = DailyNoteRepository::new(database.clone());
        let created = repository
            .save(&SaveDailyNoteInput {
                id: None,
                version: None,
                note_date: "2026-07-04".into(),
                household_member_id: None,
                note: "Family picnic".into(),
            })
            .await
            .unwrap();
        assert_eq!(created.version, 1);
        let updated = repository
            .save(&SaveDailyNoteInput {
                id: Some(created.id.clone()),
                version: Some(created.version),
                note_date: created.note_date.clone(),
                household_member_id: None,
                note: "Family picnic and fireworks".into(),
            })
            .await
            .unwrap();
        assert_eq!(updated.version, 2);
        assert!(
            repository
                .save(&SaveDailyNoteInput {
                    id: Some(created.id.clone()),
                    version: Some(1),
                    note_date: created.note_date.clone(),
                    household_member_id: None,
                    note: "Stale".into(),
                })
                .await
                .is_err()
        );
        repository
            .delete(&DeleteDailyNoteInput {
                id: created.id.clone(),
                version: updated.version,
            })
            .await
            .unwrap();
        let found = repository
            .get(&GetDailyNoteInput {
                note_date: "2026-07-04".into(),
                household_member_id: None,
            })
            .await
            .unwrap();
        assert!(found.is_none());
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE entity_type = 'daily_note' AND entity_id = ?",
        )
        .bind(&created.id)
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(audit_count, 3);
    }
}
