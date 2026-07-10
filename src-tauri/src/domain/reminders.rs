use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListReminderDeliveriesInput {
    pub range_start_utc: String,
    pub range_end_utc: String,
}

impl ListReminderDeliveriesInput {
    pub fn range(&self) -> Result<(DateTime<Utc>, DateTime<Utc>), AppError> {
        let start = parse_utc("rangeStartUtc", &self.range_start_utc)?;
        let end = parse_utc("rangeEndUtc", &self.range_end_utc)?;
        if end <= start || end - start > Duration::days(120) {
            return Err(AppError::validation(
                "rangeEndUtc",
                "提醒查询范围必须大于 0 且不超过 120 天",
            ));
        }
        Ok((start, end))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderDeliveryActionInput {
    pub id: String,
}

impl ReminderDeliveryActionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "提醒 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDeliveryRecord {
    pub id: String,
    pub recurring_item_id: String,
    pub recurring_item_name: String,
    pub occurrence_key: String,
    pub scheduled_for_utc: String,
    pub transaction_id: Option<String>,
    pub transaction_status: Option<String>,
    pub amount_minor: Option<i64>,
    pub currency_code: Option<String>,
}

fn parse_utc(field: &'static str, value: &str) -> Result<DateTime<Utc>, AppError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| AppError::validation(field, "时间必须是带时区的 RFC 3339 格式"))
}
