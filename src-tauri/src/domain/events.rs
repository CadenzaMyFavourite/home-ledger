use crate::error::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventType {
    General,
    Important,
    Travel,
    Medical,
    Education,
    Bill,
    Tax,
    Maintenance,
    Other,
}

impl CalendarEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Important => "important",
            Self::Travel => "travel",
            Self::Medical => "medical",
            Self::Education => "education",
            Self::Bill => "bill",
            Self::Tax => "tax",
            Self::Maintenance => "maintenance",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventPriority {
    Normal,
    Important,
}

impl EventPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Important => "important",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCalendarEventInput {
    pub title: String,
    pub description: Option<String>,
    pub event_type: CalendarEventType,
    pub is_all_day: bool,
    pub start_date: Option<String>,
    pub end_date_exclusive: Option<String>,
    pub start_at_utc: Option<String>,
    pub end_at_utc: Option<String>,
    pub timezone_id: String,
    pub priority: EventPriority,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub location_id: Option<String>,
    pub household_member_id: Option<String>,
    pub is_completed: bool,
}

impl CreateCalendarEventInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let title = self.title.trim();
        if title.is_empty() || title.len() > 200 {
            return Err(AppError::validation(
                "title",
                "事件标题必须为 1 到 200 个字符",
            ));
        }
        if self
            .description
            .as_ref()
            .is_some_and(|value| value.len() > 4_000)
        {
            return Err(AppError::validation(
                "description",
                "事件说明不能超过 4000 个字符",
            ));
        }
        if self.timezone_id.trim().is_empty() || self.timezone_id.len() > 100 {
            return Err(AppError::validation("timezoneId", "时区无效"));
        }
        self.timezone_id
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("timezoneId", "必须使用有效的 IANA 时区"))?;
        if self.color.as_ref().is_some_and(|value| {
            value.len() != 7
                || !value.starts_with('#')
                || !value[1..]
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        }) {
            return Err(AppError::validation("color", "颜色必须是 #RRGGBB 格式"));
        }
        if self.is_all_day {
            if self.start_at_utc.is_some() || self.end_at_utc.is_some() {
                return Err(AppError::validation(
                    "isAllDay",
                    "全天事件不能包含 UTC 时间",
                ));
            }
            let start = parse_date("startDate", self.start_date.as_deref())?;
            let end = parse_date("endDateExclusive", self.end_date_exclusive.as_deref())?;
            if start >= end {
                return Err(AppError::validation(
                    "endDateExclusive",
                    "结束日期必须晚于开始日期",
                ));
            }
        } else {
            if self.start_date.is_some() || self.end_date_exclusive.is_some() {
                return Err(AppError::validation(
                    "isAllDay",
                    "定时事件不能包含全天日期字段",
                ));
            }
            let start = parse_utc("startAtUtc", self.start_at_utc.as_deref())?;
            let end = parse_utc("endAtUtc", self.end_at_utc.as_deref())?;
            if start >= end {
                return Err(AppError::validation("endAtUtc", "结束时间必须晚于开始时间"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateCalendarEventInput {
    pub id: String,
    pub version: i64,
    #[serde(flatten)]
    pub event: CreateCalendarEventInput,
}

impl UpdateCalendarEventInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_identity(&self.id, self.version)?;
        self.event.validate()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarEventVersionInput {
    pub id: String,
    pub version: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventTransactionLinkInput {
    pub event_id: String,
    pub transaction_id: String,
}

impl EventTransactionLinkInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.event_id.trim().is_empty() || self.transaction_id.trim().is_empty() {
            return Err(AppError::validation("eventId", "事件和交易 ID 不能为空"));
        }
        Ok(())
    }
}

impl CalendarEventVersionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_identity(&self.id, self.version)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListCalendarEventsInput {
    pub range_start_date: String,
    pub range_end_date_exclusive: String,
    pub timezone_id: String,
    pub event_type: Option<CalendarEventType>,
    pub household_member_id: Option<String>,
}

pub struct PreparedEventRange {
    pub range_start_date: String,
    pub range_end_date_exclusive: String,
    pub range_start_utc: String,
    pub range_end_utc: String,
    pub event_type: Option<CalendarEventType>,
    pub household_member_id: Option<String>,
}

impl ListCalendarEventsInput {
    pub fn prepare(&self) -> Result<PreparedEventRange, AppError> {
        use chrono::{LocalResult, TimeZone};
        let start = NaiveDate::parse_from_str(&self.range_start_date, "%Y-%m-%d")
            .map_err(|_| AppError::validation("rangeStartDate", "开始日期格式无效"))?;
        let end = NaiveDate::parse_from_str(&self.range_end_date_exclusive, "%Y-%m-%d")
            .map_err(|_| AppError::validation("rangeEndDateExclusive", "结束日期格式无效"))?;
        if start >= end || (end - start).num_days() > 370 {
            return Err(AppError::validation(
                "rangeEndDateExclusive",
                "事件查询范围必须为 1 到 370 天",
            ));
        }
        let timezone = self
            .timezone_id
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("timezoneId", "必须使用有效的 IANA 时区"))?;
        let local_start = start.and_hms_opt(0, 0, 0).expect("valid midnight");
        let local_end = end.and_hms_opt(0, 0, 0).expect("valid midnight");
        let resolve = |value| match timezone.from_local_datetime(&value) {
            LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
            LocalResult::Ambiguous(earlier, _) => Ok(earlier.with_timezone(&Utc)),
            LocalResult::None => Err(AppError::validation(
                "timezoneId",
                "日期边界在所选时区不存在",
            )),
        };
        Ok(PreparedEventRange {
            range_start_date: self.range_start_date.clone(),
            range_end_date_exclusive: self.range_end_date_exclusive.clone(),
            range_start_utc: resolve(local_start)?.to_rfc3339(),
            range_end_utc: resolve(local_end)?.to_rfc3339(),
            event_type: self.event_type,
            household_member_id: self.household_member_id.clone(),
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventRecord {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub event_type: String,
    pub is_all_day: bool,
    pub start_date: Option<String>,
    pub end_date_exclusive: Option<String>,
    pub start_at_utc: Option<String>,
    pub end_at_utc: Option<String>,
    pub timezone_id: String,
    pub priority: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub location_id: Option<String>,
    pub location_name: Option<String>,
    pub household_member_id: Option<String>,
    pub household_member_name: Option<String>,
    pub is_completed: bool,
    pub linked_transaction_count: i64,
    pub linked_transaction_ids: Vec<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarEventIdInput {
    pub id: String,
}

impl CalendarEventIdInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() || self.id.len() > 100 {
            return Err(AppError::validation("id", "事件 ID 无效"));
        }
        Ok(())
    }
}

fn validate_identity(id: &str, version: i64) -> Result<(), AppError> {
    if id.trim().is_empty() || version < 1 {
        return Err(AppError::validation("id", "事件 ID 或版本无效"));
    }
    Ok(())
}

fn parse_date(field: &'static str, value: Option<&str>) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value.unwrap_or_default(), "%Y-%m-%d")
        .map_err(|_| AppError::validation(field, "日期格式必须是 YYYY-MM-DD"))
}

fn parse_utc(field: &'static str, value: Option<&str>) -> Result<DateTime<Utc>, AppError> {
    DateTime::parse_from_rfc3339(value.unwrap_or_default())
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| AppError::validation(field, "时间必须是带时区的 ISO 8601 格式"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toronto_range_uses_dst_aware_utc_boundaries() {
        let range = ListCalendarEventsInput {
            range_start_date: "2026-03-08".into(),
            range_end_date_exclusive: "2026-03-09".into(),
            timezone_id: "America/Toronto".into(),
            event_type: None,
            household_member_id: None,
        }
        .prepare()
        .unwrap();
        assert_eq!(range.range_start_utc, "2026-03-08T05:00:00+00:00");
        assert_eq!(range.range_end_utc, "2026-03-09T04:00:00+00:00");

        let fall_back = ListCalendarEventsInput {
            range_start_date: "2026-11-01".into(),
            range_end_date_exclusive: "2026-11-02".into(),
            timezone_id: "America/Toronto".into(),
            event_type: None,
            household_member_id: None,
        }
        .prepare()
        .unwrap();
        assert_eq!(fall_back.range_start_utc, "2026-11-01T04:00:00+00:00");
        assert_eq!(fall_back.range_end_utc, "2026-11-02T05:00:00+00:00");
    }
}
