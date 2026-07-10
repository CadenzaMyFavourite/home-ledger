use crate::domain::recurring::{
    MaterializeRecurringResult, RecurringEventRecord, RecurringEventTemplate, RecurringFrequency,
    RecurringTransactionRecord, RecurringTransactionTemplate, SaveRecurringEventInput,
    SaveRecurringTransactionInput, event_occurrence_dates, occurrence_dates,
};
use crate::error::AppError;
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct RecurringRepository {
    database: SqlitePool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRecurringTemplate {
    frequency: RecurringFrequency,
    interval: i64,
    custom_rrule: Option<String>,
    template: RecurringTransactionTemplate,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRecurringEventTemplate {
    frequency: RecurringFrequency,
    interval: i64,
    custom_rrule: Option<String>,
    template: RecurringEventTemplate,
}

impl RecurringRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list(&self) -> Result<Vec<RecurringTransactionRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT ri.id, ri.name, ri.template_json, ri.materialize_days_ahead,
                    ri.is_active, ri.last_evaluated_at, ri.created_at, ri.updated_at,
                    rr.timezone_id, rr.dtstart_local, rr.until_local, rr.occurrence_count,
                    COALESCE(r.offset_minutes, 0) AS offset_minutes
             FROM recurring_items ri
             JOIN recurrence_rules rr ON rr.id = ri.recurrence_rule_id
             LEFT JOIN reminders r ON r.recurring_item_id = ri.id
             WHERE ri.item_type = 'transaction'
             ORDER BY ri.is_active DESC, ri.name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_recurring).collect()
    }

    pub async fn list_events(&self) -> Result<Vec<RecurringEventRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT ri.id, ri.name, ri.template_json, ri.materialize_days_ahead,
                    ri.is_active, ri.last_evaluated_at, ri.created_at, ri.updated_at,
                    rr.timezone_id, rr.dtstart_local, rr.until_local, rr.occurrence_count,
                    COALESCE(r.offset_minutes, 0) AS offset_minutes
             FROM recurring_items ri
             JOIN recurrence_rules rr ON rr.id = ri.recurrence_rule_id
             LEFT JOIN reminders r ON r.recurring_item_id = ri.id
             WHERE ri.item_type = 'event'
             ORDER BY ri.is_active DESC, ri.name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_recurring_event).collect()
    }

    pub async fn save_event(
        &self,
        input: &SaveRecurringEventInput,
    ) -> Result<RecurringEventRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let stored = serde_json::to_string(&StoredRecurringEventTemplate {
            frequency: input.frequency,
            interval: input.interval,
            custom_rrule: input.custom_rrule.clone(),
            template: input.template.clone(),
        })?;
        let mut transaction = self.database.begin().await?;
        let existing_rule: Option<String> = sqlx::query_scalar(
            "SELECT recurrence_rule_id FROM recurring_items WHERE id = ? AND item_type = 'event'",
        )
        .bind(&id)
        .fetch_optional(&mut *transaction)
        .await?;
        let rule_id = existing_rule
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());

        if existing_rule.is_some() {
            sqlx::query(
                "UPDATE recurrence_rules SET timezone_id = ?, dtstart_local = ?, rrule = ?,
                        until_local = ?, occurrence_count = ?, updated_at = ? WHERE id = ?",
            )
            .bind(input.timezone_id.trim())
            .bind(&input.start_date)
            .bind(input.rrule()?)
            .bind(&input.end_date)
            .bind(input.occurrence_count)
            .bind(&now)
            .bind(&rule_id)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "UPDATE recurring_items SET name = ?, template_json = ?,
                        materialize_days_ahead = ?, is_active = ?, updated_at = ? WHERE id = ?",
            )
            .bind(input.name.trim())
            .bind(&stored)
            .bind(input.materialize_days_ahead)
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO recurrence_rules(
                    id, timezone_id, dtstart_local, rrule, until_local, occurrence_count, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&rule_id)
            .bind(input.timezone_id.trim())
            .bind(&input.start_date)
            .bind(input.rrule()?)
            .bind(&input.end_date)
            .bind(input.occurrence_count)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO recurring_items(
                    id, name, item_type, recurrence_rule_id, template_schema_version, template_json,
                    materialize_days_ahead, is_active, created_at, updated_at
                 ) VALUES (?, ?, 'event', ?, 1, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(&rule_id)
            .bind(&stored)
            .bind(input.materialize_days_ahead)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        upsert_recurring_reminder(
            &mut transaction,
            &id,
            input.advance_notice_days,
            input.is_active,
            &now,
        )
        .await?;
        insert_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "recurring_item",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_event(&id).await
    }

    pub async fn save(
        &self,
        input: &SaveRecurringTransactionInput,
    ) -> Result<RecurringTransactionRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let stored = serde_json::to_string(&StoredRecurringTemplate {
            frequency: input.frequency,
            interval: input.interval,
            custom_rrule: input.custom_rrule.clone(),
            template: input.template.clone(),
        })?;
        let mut transaction = self.database.begin().await?;
        let existing_rule: Option<String> = sqlx::query_scalar(
            "SELECT recurrence_rule_id FROM recurring_items WHERE id = ? AND item_type = 'transaction'",
        )
        .bind(&id)
        .fetch_optional(&mut *transaction)
        .await?;
        let rule_id = existing_rule
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());

        if existing_rule.is_some() {
            sqlx::query(
                "UPDATE recurrence_rules SET timezone_id = ?, dtstart_local = ?, rrule = ?,
                        until_local = ?, occurrence_count = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.timezone_id.trim())
            .bind(&input.start_date)
            .bind(input.rrule()?)
            .bind(&input.end_date)
            .bind(input.occurrence_count)
            .bind(&now)
            .bind(&rule_id)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "UPDATE recurring_items SET name = ?, template_json = ?,
                        default_transaction_status = 'planned', requires_confirmation = 1,
                        auto_confirm_enabled = 0, materialize_days_ahead = ?, is_active = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.name.trim())
            .bind(&stored)
            .bind(input.materialize_days_ahead)
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO recurrence_rules(
                    id, timezone_id, dtstart_local, rrule, until_local, occurrence_count, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&rule_id)
            .bind(input.timezone_id.trim())
            .bind(&input.start_date)
            .bind(input.rrule()?)
            .bind(&input.end_date)
            .bind(input.occurrence_count)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO recurring_items(
                    id, name, item_type, recurrence_rule_id, template_schema_version, template_json,
                    default_transaction_status, requires_confirmation, auto_confirm_enabled,
                    materialize_days_ahead, is_active, created_at, updated_at
                 ) VALUES (?, ?, 'transaction', ?, 1, ?, 'planned', 1, 0, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(&rule_id)
            .bind(&stored)
            .bind(input.materialize_days_ahead)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }

        let reminder_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM reminders WHERE recurring_item_id = ? LIMIT 1")
                .bind(&id)
                .fetch_optional(&mut *transaction)
                .await?;
        if let Some(reminder_id) = reminder_id {
            sqlx::query(
                "UPDATE reminders SET offset_minutes = ?, is_active = ?, updated_at = ? WHERE id = ?",
            )
            .bind(input.advance_notice_days * 24 * 60)
            .bind(input.is_active)
            .bind(&now)
            .bind(reminder_id)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO reminders(
                    id, recurring_item_id, offset_minutes, notify_on_startup,
                    desktop_notification, is_active, created_at, updated_at
                 ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&id)
            .bind(input.advance_notice_days * 24 * 60)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "recurring_item",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get(&id).await
    }

    pub async fn materialize(
        &self,
        as_of: NaiveDate,
    ) -> Result<MaterializeRecurringResult, AppError> {
        let items = self.list().await?;
        let mut created_count = 0_i64;
        let mut already_materialized_count = 0_i64;
        for item in items.into_iter().filter(|item| item.is_active) {
            let through = as_of
                .checked_add_signed(Duration::days(item.materialize_days_ahead))
                .ok_or_else(|| AppError::validation("asOfDate", "物化日期超出支持范围"))?;
            let source = item.as_save_input();
            for date in occurrence_dates(&source, through)? {
                if self.materialize_occurrence(&item, date).await? {
                    created_count += 1;
                } else {
                    already_materialized_count += 1;
                }
            }
            sqlx::query("UPDATE recurring_items SET last_evaluated_at = ? WHERE id = ?")
                .bind(Utc::now().to_rfc3339())
                .bind(&item.id)
                .execute(&self.database)
                .await?;
        }
        for item in self
            .list_events()
            .await?
            .into_iter()
            .filter(|item| item.is_active)
        {
            let through = as_of
                .checked_add_signed(Duration::days(item.materialize_days_ahead))
                .ok_or_else(|| AppError::validation("asOfDate", "物化日期超出支持范围"))?;
            let source = item.as_save_input();
            for date in event_occurrence_dates(&source, through)? {
                if self.materialize_event_occurrence(&item, date).await? {
                    created_count += 1;
                } else {
                    already_materialized_count += 1;
                }
            }
            sqlx::query("UPDATE recurring_items SET last_evaluated_at = ? WHERE id = ?")
                .bind(Utc::now().to_rfc3339())
                .bind(&item.id)
                .execute(&self.database)
                .await?;
        }
        Ok(MaterializeRecurringResult {
            created_count,
            already_materialized_count,
        })
    }

    async fn materialize_occurrence(
        &self,
        item: &RecurringTransactionRecord,
        date: NaiveDate,
    ) -> Result<bool, AppError> {
        let occurrence_key = date.format("%Y-%m-%d").to_string();
        let now = Utc::now().to_rfc3339();
        let tz = item
            .timezone_id
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("timezoneId", "时区无效"))?;
        let local_due = date.and_hms_opt(9, 0, 0).expect("valid 09:00");
        let scheduled = tz
            .from_local_datetime(&local_due)
            .single()
            .ok_or_else(|| AppError::validation("startDate", "周期日期无法转换为本地时间"))?
            .with_timezone(&Utc);
        let mut transaction = self.database.begin().await?;
        let occurrence_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO recurring_occurrences(
                id, recurring_item_id, occurrence_key, scheduled_local, scheduled_at_utc,
                status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(&occurrence_id)
        .bind(&item.id)
        .bind(&occurrence_key)
        .bind(&occurrence_key)
        .bind(scheduled.to_rfc3339())
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        let occurrence_id: String = sqlx::query_scalar(
            "SELECT id FROM recurring_occurrences WHERE recurring_item_id = ? AND occurrence_key = ?",
        )
        .bind(&item.id)
        .bind(&occurrence_key)
        .fetch_one(&mut *transaction)
        .await?;
        let existing: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM transactions WHERE recurring_occurrence_id = ?)",
        )
        .bind(&occurrence_id)
        .fetch_one(&mut *transaction)
        .await?;
        if existing == 1 {
            transaction.rollback().await?;
            return Ok(false);
        }

        let input = item.template.as_planned_input(date);
        input.validate_shape()?;
        let transaction_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                category_id, payment_method_id, transfer_to_payment_method_id,
                transfer_to_amount_minor, transfer_to_currency_code, household_member_id,
                location_id, merchant, note, origin, recurring_occurrence_id,
                version, created_at, updated_at
             ) VALUES (?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recurring', ?, 1, ?, ?)",
        )
        .bind(&transaction_id)
        .bind(&input.transaction_date)
        .bind(input.transaction_type.as_str())
        .bind(input.amount_minor)
        .bind(&input.currency_code)
        .bind(&input.category_id)
        .bind(&input.payment_method_id)
        .bind(&input.transfer_to_payment_method_id)
        .bind(input.transfer_to_amount_minor)
        .bind(&input.transfer_to_currency_code)
        .bind(&input.household_member_id)
        .bind(&input.location_id)
        .bind(input.merchant.as_deref().map(str::trim))
        .bind(input.note.as_deref().map(str::trim))
        .bind(&occurrence_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE recurring_occurrences SET status = 'materialized', materialized_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(&occurrence_id)
        .execute(&mut *transaction)
        .await?;

        let reminder = sqlx::query(
            "SELECT id, offset_minutes FROM reminders WHERE recurring_item_id = ? AND is_active = 1 LIMIT 1",
        )
        .bind(&item.id)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(reminder) = reminder {
            let reminder_id: String = reminder.get("id");
            let offset_minutes: i64 = reminder.get("offset_minutes");
            let notify_at = scheduled - Duration::minutes(offset_minutes);
            sqlx::query(
                "INSERT OR IGNORE INTO reminder_deliveries(
                    id, reminder_id, occurrence_key, scheduled_for_utc, status, created_at
                 ) VALUES (?, ?, ?, ?, 'pending', ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(reminder_id)
            .bind(&occurrence_key)
            .bind(notify_at.to_rfc3339())
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_audit(
            &mut transaction,
            "create",
            "transaction",
            &transaction_id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn materialize_event_occurrence(
        &self,
        item: &RecurringEventRecord,
        date: NaiveDate,
    ) -> Result<bool, AppError> {
        let occurrence_key = date.format("%Y-%m-%d").to_string();
        let now = Utc::now().to_rfc3339();
        let tz = item
            .timezone_id
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("timezoneId", "时区无效"))?;
        let local_due = date.and_hms_opt(9, 0, 0).expect("valid 09:00");
        let scheduled = tz
            .from_local_datetime(&local_due)
            .single()
            .ok_or_else(|| AppError::validation("startDate", "周期日期无法转换为本地时间"))?
            .with_timezone(&Utc);
        let mut transaction = self.database.begin().await?;
        let proposed_occurrence_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO recurring_occurrences(
                id, recurring_item_id, occurrence_key, scheduled_local, scheduled_at_utc,
                status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(&proposed_occurrence_id)
        .bind(&item.id)
        .bind(&occurrence_key)
        .bind(&occurrence_key)
        .bind(scheduled.to_rfc3339())
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        let occurrence_id: String = sqlx::query_scalar(
            "SELECT id FROM recurring_occurrences WHERE recurring_item_id = ? AND occurrence_key = ?",
        )
        .bind(&item.id)
        .bind(&occurrence_key)
        .fetch_one(&mut *transaction)
        .await?;
        let existing: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE recurring_occurrence_id = ?)",
        )
        .bind(&occurrence_id)
        .fetch_one(&mut *transaction)
        .await?;
        if existing == 1 {
            transaction.rollback().await?;
            return Ok(false);
        }

        let event = item.template.as_event_input(date, &item.timezone_id)?;
        event.validate()?;
        let event_id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO calendar_events(
                id, title, description, event_type, is_all_day, start_date, end_date_exclusive,
                timezone_id, priority, color, icon, location_id, household_member_id,
                is_completed, recurring_occurrence_id, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)",
        )
        .bind(&event_id)
        .bind(event.title.trim())
        .bind(event.description.as_deref().map(str::trim))
        .bind(event.event_type.as_str())
        .bind(&event.start_date)
        .bind(&event.end_date_exclusive)
        .bind(event.timezone_id.trim())
        .bind(event.priority.as_str())
        .bind(event.color.as_deref().map(str::trim))
        .bind(event.icon.as_deref().map(str::trim))
        .bind(&event.location_id)
        .bind(&event.household_member_id)
        .bind(&occurrence_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE recurring_occurrences SET status = 'materialized', materialized_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(&occurrence_id)
        .execute(&mut *transaction)
        .await?;
        insert_reminder_delivery(&mut transaction, &item.id, &occurrence_key, scheduled, &now)
            .await?;
        insert_audit(
            &mut transaction,
            "create",
            "calendar_event",
            &event_id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn get_event(&self, id: &str) -> Result<RecurringEventRecord, AppError> {
        let row = sqlx::query(
            "SELECT ri.id, ri.name, ri.template_json, ri.materialize_days_ahead,
                    ri.is_active, ri.last_evaluated_at, ri.created_at, ri.updated_at,
                    rr.timezone_id, rr.dtstart_local, rr.until_local, rr.occurrence_count,
                    COALESCE(r.offset_minutes, 0) AS offset_minutes
             FROM recurring_items ri
             JOIN recurrence_rules rr ON rr.id = ri.recurrence_rule_id
             LEFT JOIN reminders r ON r.recurring_item_id = ri.id
             WHERE ri.id = ? AND ri.item_type = 'event'",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("recurring_item", "周期事件不存在"))?;
        map_recurring_event(&row)
    }

    async fn get(&self, id: &str) -> Result<RecurringTransactionRecord, AppError> {
        let row = sqlx::query(
            "SELECT ri.id, ri.name, ri.template_json, ri.materialize_days_ahead,
                    ri.is_active, ri.last_evaluated_at, ri.created_at, ri.updated_at,
                    rr.timezone_id, rr.dtstart_local, rr.until_local, rr.occurrence_count,
                    COALESCE(r.offset_minutes, 0) AS offset_minutes
             FROM recurring_items ri
             JOIN recurrence_rules rr ON rr.id = ri.recurrence_rule_id
             LEFT JOIN reminders r ON r.recurring_item_id = ri.id
             WHERE ri.id = ? AND ri.item_type = 'transaction'",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("recurring_item", "周期项目不存在"))?;
        map_recurring(&row)
    }
}

impl RecurringTransactionRecord {
    fn as_save_input(&self) -> SaveRecurringTransactionInput {
        SaveRecurringTransactionInput {
            id: Some(self.id.clone()),
            name: self.name.clone(),
            frequency: self.frequency,
            interval: self.interval,
            custom_rrule: self.custom_rrule.clone(),
            start_date: self.start_date.clone(),
            end_date: self.end_date.clone(),
            occurrence_count: self.occurrence_count,
            timezone_id: self.timezone_id.clone(),
            advance_notice_days: self.advance_notice_days,
            materialize_days_ahead: self.materialize_days_ahead,
            is_active: self.is_active,
            template: self.template.clone(),
        }
    }
}

impl RecurringEventRecord {
    fn as_save_input(&self) -> SaveRecurringEventInput {
        SaveRecurringEventInput {
            id: Some(self.id.clone()),
            name: self.name.clone(),
            frequency: self.frequency,
            interval: self.interval,
            custom_rrule: self.custom_rrule.clone(),
            start_date: self.start_date.clone(),
            end_date: self.end_date.clone(),
            occurrence_count: self.occurrence_count,
            timezone_id: self.timezone_id.clone(),
            advance_notice_days: self.advance_notice_days,
            materialize_days_ahead: self.materialize_days_ahead,
            is_active: self.is_active,
            template: self.template.clone(),
        }
    }
}

fn map_recurring(row: &sqlx::sqlite::SqliteRow) -> Result<RecurringTransactionRecord, AppError> {
    let stored: StoredRecurringTemplate = serde_json::from_str(row.get("template_json"))?;
    let offset_minutes: i64 = row.get("offset_minutes");
    Ok(RecurringTransactionRecord {
        id: row.get("id"),
        name: row.get("name"),
        frequency: stored.frequency,
        interval: stored.interval,
        custom_rrule: stored.custom_rrule,
        start_date: row.get("dtstart_local"),
        end_date: row.get("until_local"),
        occurrence_count: row.get("occurrence_count"),
        timezone_id: row.get("timezone_id"),
        advance_notice_days: offset_minutes / (24 * 60),
        materialize_days_ahead: row.get("materialize_days_ahead"),
        is_active: row.get::<i64, _>("is_active") == 1,
        template: stored.template,
        last_evaluated_at: row.get("last_evaluated_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn map_recurring_event(row: &sqlx::sqlite::SqliteRow) -> Result<RecurringEventRecord, AppError> {
    let stored: StoredRecurringEventTemplate = serde_json::from_str(row.get("template_json"))?;
    let offset_minutes: i64 = row.get("offset_minutes");
    Ok(RecurringEventRecord {
        id: row.get("id"),
        name: row.get("name"),
        frequency: stored.frequency,
        interval: stored.interval,
        custom_rrule: stored.custom_rrule,
        start_date: row.get("dtstart_local"),
        end_date: row.get("until_local"),
        occurrence_count: row.get("occurrence_count"),
        timezone_id: row.get("timezone_id"),
        advance_notice_days: offset_minutes / (24 * 60),
        materialize_days_ahead: row.get("materialize_days_ahead"),
        is_active: row.get::<i64, _>("is_active") == 1,
        template: stored.template,
        last_evaluated_at: row.get("last_evaluated_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn upsert_recurring_reminder(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    item_id: &str,
    advance_notice_days: i64,
    is_active: bool,
    now: &str,
) -> Result<(), AppError> {
    let reminder_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM reminders WHERE recurring_item_id = ? LIMIT 1")
            .bind(item_id)
            .fetch_optional(&mut **transaction)
            .await?;
    if let Some(reminder_id) = reminder_id {
        sqlx::query(
            "UPDATE reminders SET offset_minutes = ?, is_active = ?, updated_at = ? WHERE id = ?",
        )
        .bind(advance_notice_days * 24 * 60)
        .bind(is_active)
        .bind(now)
        .bind(reminder_id)
        .execute(&mut **transaction)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO reminders(
                id, recurring_item_id, offset_minutes, notify_on_startup,
                desktop_notification, is_active, created_at, updated_at
             ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(item_id)
        .bind(advance_notice_days * 24 * 60)
        .bind(is_active)
        .bind(now)
        .bind(now)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn insert_reminder_delivery(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    item_id: &str,
    occurrence_key: &str,
    scheduled: DateTime<Utc>,
    now: &str,
) -> Result<(), AppError> {
    let reminder = sqlx::query(
        "SELECT id, offset_minutes FROM reminders WHERE recurring_item_id = ? AND is_active = 1 LIMIT 1",
    )
    .bind(item_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if let Some(reminder) = reminder {
        let reminder_id: String = reminder.get("id");
        let offset_minutes: i64 = reminder.get("offset_minutes");
        sqlx::query(
            "INSERT OR IGNORE INTO reminder_deliveries(
                id, reminder_id, occurrence_key, scheduled_for_utc, status, created_at
             ) VALUES (?, ?, ?, ?, 'pending', ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(reminder_id)
        .bind(occurrence_key)
        .bind((scheduled - Duration::minutes(offset_minutes)).to_rfc3339())
        .bind(now)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::events::{CalendarEventType, EventPriority};
    use crate::domain::recurring::{RecurringFrequency, RecurringTransactionTemplate};
    use crate::domain::reminders::{ListReminderDeliveriesInput, ReminderDeliveryActionInput};
    use crate::domain::transactions::TransactionType;
    use crate::infrastructure::database::open_database;
    use crate::repositories::reminder_repository::ReminderRepository;

    fn rent() -> SaveRecurringTransactionInput {
        SaveRecurringTransactionInput {
            id: None,
            name: "Monthly rent".into(),
            frequency: RecurringFrequency::Monthly,
            interval: 1,
            custom_rrule: None,
            start_date: "2026-07-01".into(),
            end_date: None,
            occurrence_count: Some(3),
            timezone_id: "America/Toronto".into(),
            advance_notice_days: 3,
            materialize_days_ahead: 40,
            is_active: true,
            template: RecurringTransactionTemplate {
                transaction_type: TransactionType::Expense,
                amount_minor: 200_000,
                currency_code: "CAD".into(),
                category_id: Some("10000000-0000-7000-8000-000000000201".into()),
                payment_method_id: Some("20000000-0000-7000-8000-000000000001".into()),
                transfer_to_payment_method_id: None,
                transfer_to_amount_minor: None,
                transfer_to_currency_code: None,
                household_member_id: None,
                location_id: None,
                merchant: Some("Landlord".into()),
                note: Some("Confirm after payment".into()),
            },
        }
    }

    fn birthday() -> SaveRecurringEventInput {
        SaveRecurringEventInput {
            id: None,
            name: "Family birthday".into(),
            frequency: RecurringFrequency::Yearly,
            interval: 1,
            custom_rrule: None,
            start_date: "2026-07-01".into(),
            end_date: None,
            occurrence_count: Some(2),
            timezone_id: "America/Toronto".into(),
            advance_notice_days: 7,
            materialize_days_ahead: 400,
            is_active: true,
            template: RecurringEventTemplate {
                title: "Birthday".into(),
                description: Some("Family birthday".into()),
                event_type: CalendarEventType::Important,
                duration_days: 1,
                priority: EventPriority::Important,
                color: Some("#D9364F".into()),
                icon: Some("cake".into()),
                location_id: None,
                household_member_id: Some("00000000-0000-7000-8000-000000000001".into()),
            },
        }
    }

    #[tokio::test]
    async fn materialization_is_idempotent_and_only_creates_planned_transactions() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("recurring.sqlite3"))
            .await
            .unwrap();
        let repository = RecurringRepository::new(database.clone());
        let input = rent();
        input.validate().unwrap();
        let saved = repository.save(&input).await.unwrap();
        assert_eq!(saved.advance_notice_days, 3);

        let result = repository
            .materialize(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
            .await
            .unwrap();
        assert_eq!(result.created_count, 2);
        let transactions = sqlx::query(
            "SELECT status, reporting_amount_minor, origin FROM transactions ORDER BY transaction_date",
        )
        .fetch_all(&database)
        .await
        .unwrap();
        assert_eq!(transactions.len(), 2);
        assert!(transactions.iter().all(|row| {
            row.get::<String, _>("status") == "planned"
                && row
                    .get::<Option<i64>, _>("reporting_amount_minor")
                    .is_none()
                && row.get::<String, _>("origin") == "recurring"
        }));
        let deliveries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reminder_deliveries")
            .fetch_one(&database)
            .await
            .unwrap();
        assert_eq!(deliveries, 2);
        let reminders = ReminderRepository::new(database.clone());
        let pending = reminders
            .list(&ListReminderDeliveriesInput {
                range_start_utc: "2026-06-01T00:00:00Z".into(),
                range_end_utc: "2026-09-01T00:00:00Z".into(),
            })
            .await
            .unwrap();
        assert_eq!(pending.len(), 2);
        reminders
            .set_status(
                &ReminderDeliveryActionInput {
                    id: pending[0].id.clone(),
                },
                "dismissed",
            )
            .await
            .unwrap();

        let again = repository
            .materialize(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
            .await
            .unwrap();
        assert_eq!(again.created_count, 0);
        assert_eq!(again.already_materialized_count, 2);
    }

    #[tokio::test]
    async fn recurring_events_materialize_once_with_reminders() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("recurring-events.sqlite3"))
            .await
            .unwrap();
        let repository = RecurringRepository::new(database.clone());
        let input = birthday();
        input.validate().unwrap();
        let saved = repository.save_event(&input).await.unwrap();
        assert_eq!(saved.template.title, "Birthday");

        let first = repository
            .materialize(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
            .await
            .unwrap();
        assert_eq!(first.created_count, 2);
        let events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_events WHERE recurring_occurrence_id IS NOT NULL",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        let reminders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reminder_deliveries")
            .fetch_one(&database)
            .await
            .unwrap();
        assert_eq!((events, reminders), (2, 2));

        let second = repository
            .materialize(NaiveDate::from_ymd_opt(2026, 7, 1).unwrap())
            .await
            .unwrap();
        assert_eq!(second.created_count, 0);
        assert_eq!(second.already_materialized_count, 2);
    }
}
