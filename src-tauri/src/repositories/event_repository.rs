use crate::domain::events::{
    CalendarEventRecord, CalendarEventVersionInput, CreateCalendarEventInput,
    EventTransactionLinkInput, PreparedEventRange, UpdateCalendarEventInput,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct EventRepository {
    database: SqlitePool,
}

impl EventRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list(
        &self,
        range: &PreparedEventRange,
    ) -> Result<Vec<CalendarEventRecord>, AppError> {
        let event_type = range.event_type.map(|value| value.as_str());
        let rows = sqlx::query(
            "SELECT e.id, e.title, e.description, e.event_type, e.is_all_day,
                    e.start_date, e.end_date_exclusive, e.start_at_utc, e.end_at_utc,
                    e.timezone_id, e.priority, e.color, e.icon, e.location_id,
                    l.name AS location_name, e.household_member_id,
                    hm.display_name AS household_member_name, e.is_completed, e.version,
                    e.created_at, e.updated_at,
                    (SELECT COUNT(*) FROM event_transactions et WHERE et.event_id = e.id) AS linked_transaction_count,
                    (SELECT GROUP_CONCAT(et.transaction_id) FROM event_transactions et WHERE et.event_id = e.id)
                        AS linked_transaction_ids
             FROM calendar_events e
             LEFT JOIN locations l ON l.id = e.location_id
             LEFT JOIN household_members hm ON hm.id = e.household_member_id
             WHERE e.deleted_at IS NULL
               AND (
                    (e.is_all_day = 1 AND e.start_date < ? AND e.end_date_exclusive > ?)
                    OR
                    (e.is_all_day = 0 AND e.start_at_utc < ? AND e.end_at_utc > ?)
               )
               AND (? IS NULL OR e.event_type = ?)
               AND (? IS NULL OR e.household_member_id = ?)
             ORDER BY COALESCE(e.start_date, e.start_at_utc), e.priority DESC, e.title COLLATE NOCASE",
        )
        .bind(&range.range_end_date_exclusive)
        .bind(&range.range_start_date)
        .bind(&range.range_end_utc)
        .bind(&range.range_start_utc)
        .bind(event_type)
        .bind(event_type)
        .bind(&range.household_member_id)
        .bind(&range.household_member_id)
        .fetch_all(&self.database)
        .await?;
        Ok(rows.iter().map(map_event).collect())
    }

    pub async fn create(
        &self,
        input: &CreateCalendarEventInput,
    ) -> Result<CalendarEventRecord, AppError> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "INSERT INTO calendar_events(
                id, title, description, event_type, is_all_day, start_date, end_date_exclusive,
                start_at_utc, end_at_utc, timezone_id, priority, color, icon, location_id,
                household_member_id, is_completed, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(input.title.trim())
        .bind(trimmed(&input.description))
        .bind(input.event_type.as_str())
        .bind(input.is_all_day)
        .bind(&input.start_date)
        .bind(&input.end_date_exclusive)
        .bind(&input.start_at_utc)
        .bind(&input.end_at_utc)
        .bind(input.timezone_id.trim())
        .bind(input.priority.as_str())
        .bind(trimmed(&input.color))
        .bind(trimmed(&input.icon))
        .bind(&input.location_id)
        .bind(&input.household_member_id)
        .bind(input.is_completed)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        insert_audit(&mut transaction, "create", &id, &now).await?;
        transaction.commit().await?;
        self.get(&id).await
    }

    pub async fn update(
        &self,
        input: &UpdateCalendarEventInput,
    ) -> Result<CalendarEventRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let event = &input.event;
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE calendar_events SET
                title = ?, description = ?, event_type = ?, is_all_day = ?,
                start_date = ?, end_date_exclusive = ?, start_at_utc = ?, end_at_utc = ?,
                timezone_id = ?, priority = ?, color = ?, icon = ?, location_id = ?,
                household_member_id = ?, is_completed = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(event.title.trim())
        .bind(trimmed(&event.description))
        .bind(event.event_type.as_str())
        .bind(event.is_all_day)
        .bind(&event.start_date)
        .bind(&event.end_date_exclusive)
        .bind(&event.start_at_utc)
        .bind(&event.end_at_utc)
        .bind(event.timezone_id.trim())
        .bind(event.priority.as_str())
        .bind(trimmed(&event.color))
        .bind(trimmed(&event.icon))
        .bind(&event.location_id)
        .bind(&event.household_member_id)
        .bind(event.is_completed)
        .bind(&now)
        .bind(&input.id)
        .bind(input.version)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("事件已被修改或删除，请刷新后重试"));
        }
        insert_audit(&mut transaction, "update", &input.id, &now).await?;
        transaction.commit().await?;
        self.get(&input.id).await
    }

    pub async fn soft_delete(
        &self,
        input: &CalendarEventVersionInput,
    ) -> Result<CalendarEventVersionInput, AppError> {
        self.set_deleted(input, true).await
    }

    pub async fn set_transaction_link(
        &self,
        input: &EventTransactionLinkInput,
        linked: bool,
    ) -> Result<CalendarEventRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let event_exists: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id = ? AND deleted_at IS NULL)",
        )
        .bind(&input.event_id)
        .fetch_one(&mut *transaction)
        .await?;
        let transaction_exists: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM transactions WHERE id = ? AND deleted_at IS NULL)",
        )
        .bind(&input.transaction_id)
        .fetch_one(&mut *transaction)
        .await?;
        if event_exists != 1 || transaction_exists != 1 {
            transaction.rollback().await?;
            return Err(AppError::not_found("event_transaction", "事件或交易不存在"));
        }
        if linked {
            sqlx::query(
                "INSERT OR IGNORE INTO event_transactions(event_id, transaction_id, created_at)
                 VALUES (?, ?, ?)",
            )
            .bind(&input.event_id)
            .bind(&input.transaction_id)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query("DELETE FROM event_transactions WHERE event_id = ? AND transaction_id = ?")
                .bind(&input.event_id)
                .bind(&input.transaction_id)
                .execute(&mut *transaction)
                .await?;
        }
        insert_audit(
            &mut transaction,
            if linked {
                "link_transaction"
            } else {
                "unlink_transaction"
            },
            &input.event_id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get(&input.event_id).await
    }

    pub async fn restore(
        &self,
        input: &CalendarEventVersionInput,
    ) -> Result<CalendarEventRecord, AppError> {
        let result = self.set_deleted(input, false).await?;
        self.get(&result.id).await
    }

    async fn set_deleted(
        &self,
        input: &CalendarEventVersionInput,
        deleted: bool,
    ) -> Result<CalendarEventVersionInput, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = if deleted {
            sqlx::query(
                "UPDATE calendar_events SET deleted_at = ?, updated_at = ?, version = version + 1
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(&now)
            .bind(&now)
            .bind(&input.id)
            .bind(input.version)
            .execute(&mut *transaction)
            .await?
        } else {
            sqlx::query(
                "UPDATE calendar_events SET deleted_at = NULL, updated_at = ?, version = version + 1
                 WHERE id = ? AND version = ? AND deleted_at IS NOT NULL",
            )
            .bind(&now)
            .bind(&input.id)
            .bind(input.version)
            .execute(&mut *transaction)
            .await?
        };
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("事件已被修改或删除，请刷新后重试"));
        }
        insert_audit(
            &mut transaction,
            if deleted { "delete" } else { "restore" },
            &input.id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        Ok(CalendarEventVersionInput {
            id: input.id.clone(),
            version: input.version + 1,
        })
    }

    pub async fn get(&self, id: &str) -> Result<CalendarEventRecord, AppError> {
        let row = sqlx::query(
            "SELECT e.id, e.title, e.description, e.event_type, e.is_all_day,
                    e.start_date, e.end_date_exclusive, e.start_at_utc, e.end_at_utc,
                    e.timezone_id, e.priority, e.color, e.icon, e.location_id,
                    l.name AS location_name, e.household_member_id,
                    hm.display_name AS household_member_name, e.is_completed, e.version,
                    e.created_at, e.updated_at,
                    (SELECT COUNT(*) FROM event_transactions et WHERE et.event_id = e.id) AS linked_transaction_count,
                    (SELECT GROUP_CONCAT(et.transaction_id) FROM event_transactions et WHERE et.event_id = e.id)
                        AS linked_transaction_ids
             FROM calendar_events e
             LEFT JOIN locations l ON l.id = e.location_id
             LEFT JOIN household_members hm ON hm.id = e.household_member_id
             WHERE e.id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("calendar_event", "事件不存在"))?;
        Ok(map_event(&row))
    }
}

fn map_event(row: &sqlx::sqlite::SqliteRow) -> CalendarEventRecord {
    let linked_transaction_ids: Option<String> = row.get("linked_transaction_ids");
    CalendarEventRecord {
        id: row.get("id"),
        title: row.get("title"),
        description: row.get("description"),
        event_type: row.get("event_type"),
        is_all_day: row.get::<i64, _>("is_all_day") == 1,
        start_date: row.get("start_date"),
        end_date_exclusive: row.get("end_date_exclusive"),
        start_at_utc: row.get("start_at_utc"),
        end_at_utc: row.get("end_at_utc"),
        timezone_id: row.get("timezone_id"),
        priority: row.get("priority"),
        color: row.get("color"),
        icon: row.get("icon"),
        location_id: row.get("location_id"),
        location_name: row.get("location_name"),
        household_member_id: row.get("household_member_id"),
        household_member_name: row.get("household_member_name"),
        is_completed: row.get::<i64, _>("is_completed") == 1,
        linked_transaction_count: row.get("linked_transaction_count"),
        linked_transaction_ids: linked_transaction_ids
            .map(|value| value.split(',').map(str::to_owned).collect())
            .unwrap_or_default(),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn trimmed(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    event_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, 'calendar_event', ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(event_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::events::{CalendarEventType, EventPriority, ListCalendarEventsInput};
    use crate::infrastructure::database::open_database;

    fn all_day_event(title: &str) -> CreateCalendarEventInput {
        CreateCalendarEventInput {
            title: title.into(),
            description: Some("Family trip".into()),
            event_type: CalendarEventType::Travel,
            is_all_day: true,
            start_date: Some("2026-07-10".into()),
            end_date_exclusive: Some("2026-07-13".into()),
            start_at_utc: None,
            end_at_utc: None,
            timezone_id: "America/Toronto".into(),
            priority: EventPriority::Important,
            color: Some("#7455D9".into()),
            icon: Some("luggage".into()),
            location_id: None,
            household_member_id: Some("00000000-0000-7000-8000-000000000001".into()),
            is_completed: false,
        }
    }

    #[tokio::test]
    async fn event_crud_uses_overlap_and_optimistic_versions() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("events.sqlite3"))
            .await
            .expect("database");
        let repository = EventRepository::new(database);
        let created = repository
            .create(&all_day_event("Vancouver trip"))
            .await
            .unwrap();
        assert_eq!(created.version, 1);

        let range = ListCalendarEventsInput {
            range_start_date: "2026-07-11".into(),
            range_end_date_exclusive: "2026-07-12".into(),
            timezone_id: "America/Toronto".into(),
            event_type: None,
            household_member_id: None,
        }
        .prepare()
        .unwrap();
        assert_eq!(repository.list(&range).await.unwrap().len(), 1);

        let updated = repository
            .update(&UpdateCalendarEventInput {
                id: created.id.clone(),
                version: created.version,
                event: all_day_event("Updated trip"),
            })
            .await
            .unwrap();
        assert_eq!(
            (updated.title.as_str(), updated.version),
            ("Updated trip", 2)
        );
        let transaction_id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, payment_method_id,
                merchant, origin, version, created_at, updated_at
             ) VALUES (?, '2026-07-11', 'expense', 'completed', 18500, 'CAD',
                       18500, 'CAD', '20000000-0000-7000-8000-000000000001',
                       'Vancouver hotel', 'manual', 1, ?, ?)",
        )
        .bind(&transaction_id)
        .bind(&now)
        .bind(&now)
        .execute(&repository.database)
        .await
        .unwrap();
        let link = EventTransactionLinkInput {
            event_id: updated.id.clone(),
            transaction_id: transaction_id.clone(),
        };
        let linked = repository.set_transaction_link(&link, true).await.unwrap();
        assert_eq!(linked.linked_transaction_count, 1);
        assert_eq!(linked.linked_transaction_ids, vec![transaction_id]);
        let unlinked = repository.set_transaction_link(&link, false).await.unwrap();
        assert_eq!(unlinked.linked_transaction_count, 0);
        assert!(unlinked.linked_transaction_ids.is_empty());
        assert!(
            repository
                .update(&UpdateCalendarEventInput {
                    id: created.id.clone(),
                    version: 1,
                    event: all_day_event("Stale"),
                })
                .await
                .is_err()
        );

        let deleted = repository
            .soft_delete(&CalendarEventVersionInput {
                id: updated.id.clone(),
                version: updated.version,
            })
            .await
            .unwrap();
        assert!(repository.list(&range).await.unwrap().is_empty());
        let restored = repository.restore(&deleted).await.unwrap();
        assert_eq!(restored.version, 4);
    }
}
