use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetDailyNoteInput {
    pub note_date: String,
    pub household_member_id: Option<String>,
}

impl GetDailyNoteInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_date(&self.note_date)?;
        validate_optional_id("householdMemberId", self.household_member_id.as_deref())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveDailyNoteInput {
    pub id: Option<String>,
    pub version: Option<i64>,
    pub note_date: String,
    pub household_member_id: Option<String>,
    pub note: String,
}

impl SaveDailyNoteInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_date(&self.note_date)?;
        validate_optional_id("householdMemberId", self.household_member_id.as_deref())?;
        if self.id.is_some() != self.version.is_some() {
            return Err(AppError::validation(
                "version",
                "更新每日备注时必须同时提供记录 ID 和版本",
            ));
        }
        validate_optional_id("id", self.id.as_deref())?;
        if self.version.is_some_and(|version| version < 1) {
            return Err(AppError::validation("version", "每日备注版本无效"));
        }
        if self.note.chars().count() > 10_000 {
            return Err(AppError::validation(
                "note",
                "每日备注不能超过 10000 个字符",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteDailyNoteInput {
    pub id: String,
    pub version: i64,
}

impl DeleteDailyNoteInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_optional_id("id", Some(&self.id))?;
        if self.version < 1 {
            return Err(AppError::validation("version", "每日备注版本无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyNoteRecord {
    pub id: String,
    pub note_date: String,
    pub household_member_id: Option<String>,
    pub household_member_name: Option<String>,
    pub note: String,
    pub attachment_count: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

fn validate_date(value: &str) -> Result<(), AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| AppError::validation("noteDate", "每日备注日期格式无效"))
}

fn validate_optional_id(field: &'static str, value: Option<&str>) -> Result<(), AppError> {
    if value.is_some_and(|id| id.trim().is_empty() || id.len() > 100) {
        return Err(AppError::validation(field, "记录 ID 无效"));
    }
    Ok(())
}
