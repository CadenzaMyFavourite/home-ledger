use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyFinancialSummaryInput {
    pub range_start_date: String,
    pub range_end_date_exclusive: String,
}

impl DailyFinancialSummaryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let start = parse_date("rangeStartDate", &self.range_start_date)?;
        let end = parse_date("rangeEndDateExclusive", &self.range_end_date_exclusive)?;
        let days = (end - start).num_days();
        if !(1..=370).contains(&days) {
            return Err(AppError::validation(
                "rangeEndDateExclusive",
                "日历统计范围必须为 1 到 370 天",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyFinancialSummary {
    pub summary_date: String,
    pub reporting_currency_code: Option<String>,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub planned_count: i64,
    pub pending_count: i64,
}

fn parse_date(field: &'static str, value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::validation(field, "日期格式无效"))
}
