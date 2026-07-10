use crate::domain::reminders::{
    ListReminderDeliveriesInput, ReminderDeliveryActionInput, ReminderDeliveryRecord,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};

pub struct ReminderRepository {
    database: SqlitePool,
}

impl ReminderRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list(
        &self,
        input: &ListReminderDeliveriesInput,
    ) -> Result<Vec<ReminderDeliveryRecord>, AppError> {
        input.range()?;
        let rows = sqlx::query(
            "SELECT rd.id, ri.id AS recurring_item_id, ri.name AS recurring_item_name,
                    rd.occurrence_key, rd.scheduled_for_utc, t.id AS transaction_id,
                    t.status AS transaction_status, t.amount_minor, t.currency_code
             FROM reminder_deliveries rd
             JOIN reminders r ON r.id = rd.reminder_id
             JOIN recurring_items ri ON ri.id = r.recurring_item_id
             LEFT JOIN recurring_occurrences ro
                ON ro.recurring_item_id = ri.id AND ro.occurrence_key = rd.occurrence_key
             LEFT JOIN transactions t ON t.recurring_occurrence_id = ro.id AND t.deleted_at IS NULL
             WHERE rd.status = 'pending'
               AND rd.scheduled_for_utc >= ? AND rd.scheduled_for_utc < ?
             ORDER BY rd.scheduled_for_utc, ri.name COLLATE NOCASE",
        )
        .bind(&input.range_start_utc)
        .bind(&input.range_end_utc)
        .fetch_all(&self.database)
        .await?;
        Ok(rows
            .iter()
            .map(|row| ReminderDeliveryRecord {
                id: row.get("id"),
                recurring_item_id: row.get("recurring_item_id"),
                recurring_item_name: row.get("recurring_item_name"),
                occurrence_key: row.get("occurrence_key"),
                scheduled_for_utc: row.get("scheduled_for_utc"),
                transaction_id: row.get("transaction_id"),
                transaction_status: row.get("transaction_status"),
                amount_minor: row.get("amount_minor"),
                currency_code: row.get("currency_code"),
            })
            .collect())
    }

    pub async fn set_status(
        &self,
        input: &ReminderDeliveryActionInput,
        status: &str,
    ) -> Result<(), AppError> {
        input.validate()?;
        let delivered_at = (status == "delivered").then(|| Utc::now().to_rfc3339());
        let result = sqlx::query(
            "UPDATE reminder_deliveries SET status = ?, delivered_at = ?
             WHERE id = ? AND status = 'pending'",
        )
        .bind(status)
        .bind(delivered_at)
        .bind(&input.id)
        .execute(&self.database)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AppError::conflict("提醒已处理或不存在"));
        }
        Ok(())
    }
}
