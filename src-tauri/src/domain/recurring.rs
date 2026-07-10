use crate::domain::events::{CalendarEventType, CreateCalendarEventInput, EventPriority};
use crate::domain::transactions::{CreateTransactionInput, TransactionStatus, TransactionType};
use crate::error::AppError;
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecurringFrequency {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
    Custom,
}

impl RecurringFrequency {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Quarterly => "quarterly",
            Self::Yearly => "yearly",
            Self::Custom => "custom",
        }
    }

    pub fn rrule(self, interval: i64) -> String {
        match self {
            Self::Daily => format!("FREQ=DAILY;INTERVAL={interval}"),
            Self::Weekly => format!("FREQ=WEEKLY;INTERVAL={interval}"),
            Self::Monthly => format!("FREQ=MONTHLY;INTERVAL={interval}"),
            Self::Quarterly => format!("FREQ=MONTHLY;INTERVAL={}", interval * 3),
            Self::Yearly => format!("FREQ=YEARLY;INTERVAL={interval}"),
            Self::Custom => unreachable!("custom recurrence uses a validated RRULE"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecurringTransactionTemplate {
    pub transaction_type: TransactionType,
    pub amount_minor: i64,
    pub currency_code: String,
    pub category_id: Option<String>,
    pub payment_method_id: Option<String>,
    pub transfer_to_payment_method_id: Option<String>,
    pub transfer_to_amount_minor: Option<i64>,
    pub transfer_to_currency_code: Option<String>,
    pub household_member_id: Option<String>,
    pub location_id: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
}

impl RecurringTransactionTemplate {
    pub fn as_planned_input(&self, date: NaiveDate) -> CreateTransactionInput {
        CreateTransactionInput {
            transaction_date: date.format("%Y-%m-%d").to_string(),
            transaction_type: self.transaction_type,
            status: TransactionStatus::Planned,
            amount_minor: self.amount_minor,
            currency_code: self.currency_code.clone(),
            category_id: self.category_id.clone(),
            payment_method_id: self.payment_method_id.clone(),
            transfer_to_payment_method_id: self.transfer_to_payment_method_id.clone(),
            transfer_to_amount_minor: self.transfer_to_amount_minor,
            transfer_to_currency_code: self.transfer_to_currency_code.clone(),
            household_member_id: self.household_member_id.clone(),
            location_id: self.location_id.clone(),
            merchant: self.merchant.clone(),
            note: self.note.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRecurringTransactionInput {
    pub id: Option<String>,
    pub name: String,
    pub frequency: RecurringFrequency,
    pub interval: i64,
    pub custom_rrule: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub occurrence_count: Option<i64>,
    pub timezone_id: String,
    pub advance_notice_days: i64,
    pub materialize_days_ahead: i64,
    pub is_active: bool,
    pub template: RecurringTransactionTemplate,
}

impl SaveRecurringTransactionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() || self.name.trim().chars().count() > 120 {
            return Err(AppError::validation(
                "name",
                "周期项目名称必须为 1 到 120 个字符",
            ));
        }
        if self
            .id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(AppError::validation("id", "周期项目 ID 无效"));
        }
        if !(1..=365).contains(&self.interval) {
            return Err(AppError::validation("interval", "重复间隔必须为 1 到 365"));
        }
        match self.frequency {
            RecurringFrequency::Custom => {
                parse_custom_rrule(self.custom_rrule.as_deref().unwrap_or_default())?;
            }
            _ if self
                .custom_rrule
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty()) =>
            {
                return Err(AppError::validation(
                    "customRrule",
                    "只有自定义频率可以设置 RRULE",
                ));
            }
            _ => {}
        }
        let start = parse_date("startDate", &self.start_date)?;
        if let Some(end) = self.end_date.as_deref()
            && parse_date("endDate", end)? < start
        {
            return Err(AppError::validation("endDate", "结束日期不能早于开始日期"));
        }
        if self
            .occurrence_count
            .is_some_and(|value| !(1..=10_000).contains(&value))
        {
            return Err(AppError::validation(
                "occurrenceCount",
                "重复次数必须为 1 到 10000",
            ));
        }
        if !(0..=365).contains(&self.advance_notice_days) {
            return Err(AppError::validation(
                "advanceNoticeDays",
                "提前提醒天数必须为 0 到 365",
            ));
        }
        if !(0..=730).contains(&self.materialize_days_ahead) {
            return Err(AppError::validation(
                "materializeDaysAhead",
                "提前创建天数必须为 0 到 730",
            ));
        }
        self.timezone_id
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("timezoneId", "时区必须是有效的 IANA 时区"))?;
        self.template.as_planned_input(start).validate_shape()?;
        Ok(())
    }

    pub fn rrule(&self) -> Result<String, AppError> {
        if self.frequency == RecurringFrequency::Custom {
            let value = self.custom_rrule.as_deref().unwrap_or_default().trim();
            parse_custom_rrule(value)?;
            Ok(value
                .strip_prefix("RRULE:")
                .unwrap_or(value)
                .to_ascii_uppercase())
        } else {
            Ok(self.frequency.rrule(self.interval))
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterializeRecurringInput {
    pub as_of_date: String,
}

impl MaterializeRecurringInput {
    pub fn date(&self) -> Result<NaiveDate, AppError> {
        parse_date("asOfDate", &self.as_of_date)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringTransactionRecord {
    pub id: String,
    pub name: String,
    pub frequency: RecurringFrequency,
    pub interval: i64,
    pub custom_rrule: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub occurrence_count: Option<i64>,
    pub timezone_id: String,
    pub advance_notice_days: i64,
    pub materialize_days_ahead: i64,
    pub is_active: bool,
    pub template: RecurringTransactionTemplate,
    pub last_evaluated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeRecurringResult {
    pub created_count: i64,
    pub already_materialized_count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecurringEventTemplate {
    pub title: String,
    pub description: Option<String>,
    pub event_type: CalendarEventType,
    pub duration_days: i64,
    pub priority: EventPriority,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub location_id: Option<String>,
    pub household_member_id: Option<String>,
}

impl RecurringEventTemplate {
    pub fn as_event_input(
        &self,
        date: NaiveDate,
        timezone_id: &str,
    ) -> Result<CreateCalendarEventInput, AppError> {
        let end = date
            .checked_add_signed(Duration::days(self.duration_days))
            .ok_or_else(|| AppError::validation("durationDays", "事件结束日期超出支持范围"))?;
        Ok(CreateCalendarEventInput {
            title: self.title.clone(),
            description: self.description.clone(),
            event_type: self.event_type,
            is_all_day: true,
            start_date: Some(date.format("%Y-%m-%d").to_string()),
            end_date_exclusive: Some(end.format("%Y-%m-%d").to_string()),
            start_at_utc: None,
            end_at_utc: None,
            timezone_id: timezone_id.to_owned(),
            priority: self.priority,
            color: self.color.clone(),
            icon: self.icon.clone(),
            location_id: self.location_id.clone(),
            household_member_id: self.household_member_id.clone(),
            is_completed: false,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRecurringEventInput {
    pub id: Option<String>,
    pub name: String,
    pub frequency: RecurringFrequency,
    pub interval: i64,
    pub custom_rrule: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub occurrence_count: Option<i64>,
    pub timezone_id: String,
    pub advance_notice_days: i64,
    pub materialize_days_ahead: i64,
    pub is_active: bool,
    pub template: RecurringEventTemplate,
}

impl SaveRecurringEventInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_schedule(
            self.id.as_deref(),
            &self.name,
            self.frequency,
            self.interval,
            self.custom_rrule.as_deref(),
            &self.start_date,
            self.end_date.as_deref(),
            self.occurrence_count,
            &self.timezone_id,
            self.advance_notice_days,
            self.materialize_days_ahead,
        )?;
        if !(1..=366).contains(&self.template.duration_days) {
            return Err(AppError::validation(
                "durationDays",
                "事件持续天数必须为 1 到 366",
            ));
        }
        self.template
            .as_event_input(
                parse_date("startDate", &self.start_date)?,
                &self.timezone_id,
            )?
            .validate()
    }

    pub fn rrule(&self) -> Result<String, AppError> {
        recurrence_rrule(self.frequency, self.interval, self.custom_rrule.as_deref())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringEventRecord {
    pub id: String,
    pub name: String,
    pub frequency: RecurringFrequency,
    pub interval: i64,
    pub custom_rrule: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub occurrence_count: Option<i64>,
    pub timezone_id: String,
    pub advance_notice_days: i64,
    pub materialize_days_ahead: i64,
    pub is_active: bool,
    pub template: RecurringEventTemplate,
    pub last_evaluated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn event_occurrence_dates(
    input: &SaveRecurringEventInput,
    through: NaiveDate,
) -> Result<Vec<NaiveDate>, AppError> {
    input.validate()?;
    occurrence_dates_for_schedule(
        input.frequency,
        input.interval,
        input.custom_rrule.as_deref(),
        &input.start_date,
        input.end_date.as_deref(),
        input.occurrence_count,
        through,
    )
}

pub fn occurrence_dates(
    input: &SaveRecurringTransactionInput,
    through: NaiveDate,
) -> Result<Vec<NaiveDate>, AppError> {
    input.validate()?;
    let start = parse_date("startDate", &input.start_date)?;
    let custom = (input.frequency == RecurringFrequency::Custom)
        .then(|| parse_custom_rrule(input.custom_rrule.as_deref().unwrap_or_default()))
        .transpose()?;
    let input_end = input
        .end_date
        .as_deref()
        .map(|value| parse_date("endDate", value))
        .transpose()?;
    let custom_end = custom.as_ref().and_then(|rule| rule.until);
    let limit = [input_end, custom_end]
        .into_iter()
        .flatten()
        .fold(through, |current, value| current.min(value));
    if limit < start {
        return Ok(Vec::new());
    }

    let max_count = [
        input.occurrence_count,
        custom.as_ref().and_then(|rule| rule.count),
    ]
    .into_iter()
    .flatten()
    .min()
    .unwrap_or(10_000) as usize;
    if let Some(rule) = custom {
        return custom_occurrence_dates(start, limit, max_count, &rule);
    }
    let mut dates = Vec::new();
    let mut step = 0_i64;
    while dates.len() < max_count && step < 120_000 {
        let date = occurrence_at(input.frequency, start, input.interval, step);
        step += 1;
        let Some(date) = date else { continue };
        if date > limit {
            break;
        }
        dates.push(date);
    }
    Ok(dates)
}

fn occurrence_at(
    frequency: RecurringFrequency,
    start: NaiveDate,
    interval: i64,
    step: i64,
) -> Option<NaiveDate> {
    match frequency {
        RecurringFrequency::Daily => start.checked_add_signed(Duration::days(interval * step)),
        RecurringFrequency::Weekly => start.checked_add_signed(Duration::weeks(interval * step)),
        RecurringFrequency::Monthly => anchored_month(start, interval * step),
        RecurringFrequency::Quarterly => anchored_month(start, interval * 3 * step),
        RecurringFrequency::Yearly => anchored_month(start, interval * 12 * step),
        RecurringFrequency::Custom => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CustomFrequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, Debug)]
struct ParsedCustomRrule {
    frequency: CustomFrequency,
    interval: i64,
    by_day: Vec<Weekday>,
    by_month_day: Vec<u32>,
    by_month: Vec<u32>,
    count: Option<i64>,
    until: Option<NaiveDate>,
}

fn parse_custom_rrule(value: &str) -> Result<ParsedCustomRrule, AppError> {
    let value = value.trim().strip_prefix("RRULE:").unwrap_or(value.trim());
    if value.is_empty() {
        return Err(AppError::validation("customRrule", "请输入自定义 RRULE"));
    }
    let mut frequency = None;
    let mut interval = 1_i64;
    let mut by_day = Vec::new();
    let mut by_month_day = Vec::new();
    let mut by_month = Vec::new();
    let mut count = None;
    let mut until = None;
    for part in value.split(';') {
        let (key, raw) = part
            .split_once('=')
            .ok_or_else(|| AppError::validation("customRrule", "RRULE 每一项必须使用 KEY=VALUE"))?;
        match key.trim().to_ascii_uppercase().as_str() {
            "FREQ" => {
                frequency = Some(match raw.trim().to_ascii_uppercase().as_str() {
                    "DAILY" => CustomFrequency::Daily,
                    "WEEKLY" => CustomFrequency::Weekly,
                    "MONTHLY" => CustomFrequency::Monthly,
                    "YEARLY" => CustomFrequency::Yearly,
                    _ => return Err(AppError::validation("customRrule", "不支持该 FREQ")),
                });
            }
            "INTERVAL" => interval = parse_positive_i64("customRrule", raw, 365)?,
            "BYDAY" => {
                by_day = raw
                    .split(',')
                    .map(|item| match item.trim().to_ascii_uppercase().as_str() {
                        "MO" => Ok(Weekday::Mon),
                        "TU" => Ok(Weekday::Tue),
                        "WE" => Ok(Weekday::Wed),
                        "TH" => Ok(Weekday::Thu),
                        "FR" => Ok(Weekday::Fri),
                        "SA" => Ok(Weekday::Sat),
                        "SU" => Ok(Weekday::Sun),
                        _ => Err(AppError::validation("customRrule", "BYDAY 只支持 MO 到 SU")),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
            }
            "BYMONTHDAY" => {
                by_month_day = parse_number_list(raw, 1, 31, "BYMONTHDAY")?;
            }
            "BYMONTH" => by_month = parse_number_list(raw, 1, 12, "BYMONTH")?,
            "COUNT" => count = Some(parse_positive_i64("customRrule", raw, 10_000)?),
            "UNTIL" => {
                let normalized = raw.trim().trim_end_matches("T000000Z");
                until = Some(
                    NaiveDate::parse_from_str(normalized, "%Y%m%d").map_err(|_| {
                        AppError::validation("customRrule", "UNTIL 必须为 YYYYMMDD")
                    })?,
                );
            }
            _ => {
                return Err(AppError::validation(
                    "customRrule",
                    "RRULE 包含不支持的字段",
                ));
            }
        }
    }
    Ok(ParsedCustomRrule {
        frequency: frequency
            .ok_or_else(|| AppError::validation("customRrule", "RRULE 缺少 FREQ"))?,
        interval,
        by_day,
        by_month_day,
        by_month,
        count,
        until,
    })
}

fn custom_occurrence_dates(
    start: NaiveDate,
    limit: NaiveDate,
    max_count: usize,
    rule: &ParsedCustomRrule,
) -> Result<Vec<NaiveDate>, AppError> {
    let mut dates = Vec::new();
    let mut date = start;
    while date <= limit && dates.len() < max_count {
        let days = (date - start).num_days();
        let months = i64::from(date.year() - start.year()) * 12 + i64::from(date.month())
            - i64::from(start.month());
        let base_matches = match rule.frequency {
            CustomFrequency::Daily => days % rule.interval == 0,
            CustomFrequency::Weekly => (days / 7) % rule.interval == 0,
            CustomFrequency::Monthly => months % rule.interval == 0,
            CustomFrequency::Yearly => i64::from(date.year() - start.year()) % rule.interval == 0,
        };
        let default_matches = match rule.frequency {
            CustomFrequency::Daily => true,
            CustomFrequency::Weekly => !rule.by_day.is_empty() || date.weekday() == start.weekday(),
            CustomFrequency::Monthly => !rule.by_month_day.is_empty() || date.day() == start.day(),
            CustomFrequency::Yearly => {
                (!rule.by_month.is_empty() || date.month() == start.month())
                    && (!rule.by_month_day.is_empty() || date.day() == start.day())
            }
        };
        if base_matches
            && default_matches
            && (rule.by_day.is_empty() || rule.by_day.contains(&date.weekday()))
            && (rule.by_month_day.is_empty() || rule.by_month_day.contains(&date.day()))
            && (rule.by_month.is_empty() || rule.by_month.contains(&date.month()))
        {
            dates.push(date);
        }
        date = date
            .checked_add_signed(Duration::days(1))
            .ok_or_else(|| AppError::validation("customRrule", "RRULE 日期超出支持范围"))?;
    }
    Ok(dates)
}

fn parse_positive_i64(field: &'static str, value: &str, max: i64) -> Result<i64, AppError> {
    let parsed = value
        .trim()
        .parse::<i64>()
        .map_err(|_| AppError::validation(field, "RRULE 数字格式无效"))?;
    if !(1..=max).contains(&parsed) {
        return Err(AppError::validation(field, "RRULE 数值超出支持范围"));
    }
    Ok(parsed)
}

fn parse_number_list(value: &str, min: u32, max: u32, label: &str) -> Result<Vec<u32>, AppError> {
    value
        .split(',')
        .map(|item| {
            let parsed = item.trim().parse::<u32>().map_err(|_| {
                AppError::validation("customRrule", format!("{label} 数字格式无效"))
            })?;
            if !(min..=max).contains(&parsed) {
                return Err(AppError::validation(
                    "customRrule",
                    format!("{label} 数值超出范围"),
                ));
            }
            Ok(parsed)
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn validate_schedule(
    id: Option<&str>,
    name: &str,
    frequency: RecurringFrequency,
    interval: i64,
    custom_rrule: Option<&str>,
    start_date: &str,
    end_date: Option<&str>,
    occurrence_count: Option<i64>,
    timezone_id: &str,
    advance_notice_days: i64,
    materialize_days_ahead: i64,
) -> Result<(), AppError> {
    if name.trim().is_empty() || name.trim().chars().count() > 120 {
        return Err(AppError::validation(
            "name",
            "周期项目名称必须为 1 到 120 个字符",
        ));
    }
    if id.is_some_and(|value| value.trim().is_empty()) {
        return Err(AppError::validation("id", "周期项目 ID 无效"));
    }
    if !(1..=365).contains(&interval) {
        return Err(AppError::validation("interval", "重复间隔必须为 1 到 365"));
    }
    match frequency {
        RecurringFrequency::Custom => {
            parse_custom_rrule(custom_rrule.unwrap_or_default())?;
        }
        _ if custom_rrule.is_some_and(|value| !value.trim().is_empty()) => {
            return Err(AppError::validation(
                "customRrule",
                "只有自定义频率可以设置 RRULE",
            ));
        }
        _ => {}
    }
    let start = parse_date("startDate", start_date)?;
    if let Some(end) = end_date
        && parse_date("endDate", end)? < start
    {
        return Err(AppError::validation("endDate", "结束日期不能早于开始日期"));
    }
    if occurrence_count.is_some_and(|value| !(1..=10_000).contains(&value)) {
        return Err(AppError::validation(
            "occurrenceCount",
            "重复次数必须为 1 到 10000",
        ));
    }
    if !(0..=365).contains(&advance_notice_days) {
        return Err(AppError::validation(
            "advanceNoticeDays",
            "提前提醒天数必须为 0 到 365",
        ));
    }
    if !(0..=730).contains(&materialize_days_ahead) {
        return Err(AppError::validation(
            "materializeDaysAhead",
            "提前创建天数必须为 0 到 730",
        ));
    }
    timezone_id
        .parse::<chrono_tz::Tz>()
        .map_err(|_| AppError::validation("timezoneId", "时区必须是有效的 IANA 时区"))?;
    Ok(())
}

fn recurrence_rrule(
    frequency: RecurringFrequency,
    interval: i64,
    custom_rrule: Option<&str>,
) -> Result<String, AppError> {
    if frequency == RecurringFrequency::Custom {
        let value = custom_rrule.unwrap_or_default().trim();
        parse_custom_rrule(value)?;
        Ok(value
            .strip_prefix("RRULE:")
            .unwrap_or(value)
            .to_ascii_uppercase())
    } else {
        Ok(frequency.rrule(interval))
    }
}

#[allow(clippy::too_many_arguments)]
fn occurrence_dates_for_schedule(
    frequency: RecurringFrequency,
    interval: i64,
    custom_rrule: Option<&str>,
    start_date: &str,
    end_date: Option<&str>,
    occurrence_count: Option<i64>,
    through: NaiveDate,
) -> Result<Vec<NaiveDate>, AppError> {
    let proxy = SaveRecurringTransactionInput {
        id: None,
        name: "schedule".into(),
        frequency,
        interval,
        custom_rrule: custom_rrule.map(str::to_owned),
        start_date: start_date.to_owned(),
        end_date: end_date.map(str::to_owned),
        occurrence_count,
        timezone_id: "America/Toronto".into(),
        advance_notice_days: 0,
        materialize_days_ahead: 0,
        is_active: true,
        template: RecurringTransactionTemplate {
            transaction_type: TransactionType::Expense,
            amount_minor: 1,
            currency_code: "CAD".into(),
            category_id: None,
            payment_method_id: None,
            transfer_to_payment_method_id: None,
            transfer_to_amount_minor: None,
            transfer_to_currency_code: None,
            household_member_id: None,
            location_id: None,
            merchant: None,
            note: None,
        },
    };
    occurrence_dates(&proxy, through)
}

fn anchored_month(start: NaiveDate, months: i64) -> Option<NaiveDate> {
    let month_index = i64::from(start.year()) * 12 + i64::from(start.month0()) + months;
    let year = i32::try_from(month_index.div_euclid(12)).ok()?;
    let month = u32::try_from(month_index.rem_euclid(12) + 1).ok()?;
    NaiveDate::from_ymd_opt(year, month, start.day())
}

fn parse_date(field: &'static str, value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::validation(field, "日期格式无效"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monthly(start_date: &str) -> SaveRecurringTransactionInput {
        SaveRecurringTransactionInput {
            id: None,
            name: "Monthly rent".into(),
            frequency: RecurringFrequency::Monthly,
            interval: 1,
            custom_rrule: None,
            start_date: start_date.into(),
            end_date: None,
            occurrence_count: None,
            timezone_id: "America/Toronto".into(),
            advance_notice_days: 3,
            materialize_days_ahead: 30,
            is_active: true,
            template: RecurringTransactionTemplate {
                transaction_type: TransactionType::Expense,
                amount_minor: 200_000,
                currency_code: "CAD".into(),
                category_id: None,
                payment_method_id: Some("cash".into()),
                transfer_to_payment_method_id: None,
                transfer_to_amount_minor: None,
                transfer_to_currency_code: None,
                household_member_id: None,
                location_id: None,
                merchant: Some("Landlord".into()),
                note: None,
            },
        }
    }

    #[test]
    fn monthly_occurrences_keep_anchor_and_skip_missing_days() {
        let dates = occurrence_dates(
            &monthly("2026-01-31"),
            NaiveDate::from_ymd_opt(2026, 5, 31).unwrap(),
        )
        .unwrap();
        assert_eq!(
            dates,
            ["2026-01-31", "2026-03-31", "2026-05-31"]
                .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
        );
    }

    #[test]
    fn recurrence_always_builds_planned_transactions() {
        let input = monthly("2026-01-01");
        assert_eq!(
            input
                .template
                .as_planned_input(NaiveDate::from_ymd_opt(2026, 2, 1).unwrap())
                .status,
            TransactionStatus::Planned
        );
    }

    #[test]
    fn biweekly_count_and_leap_day_rules_are_deterministic() {
        let mut biweekly = monthly("2026-01-01");
        biweekly.frequency = RecurringFrequency::Weekly;
        biweekly.interval = 2;
        biweekly.occurrence_count = Some(3);
        let dates =
            occurrence_dates(&biweekly, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap()).unwrap();
        assert_eq!(
            dates,
            ["2026-01-01", "2026-01-15", "2026-01-29"]
                .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
        );

        let mut leap_day = monthly("2024-02-29");
        leap_day.frequency = RecurringFrequency::Yearly;
        let dates =
            occurrence_dates(&leap_day, NaiveDate::from_ymd_opt(2028, 3, 1).unwrap()).unwrap();
        assert_eq!(
            dates,
            ["2024-02-29", "2028-02-29"]
                .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
        );
    }

    #[test]
    fn custom_rrule_is_whitelisted_and_generates_selected_weekdays() {
        let mut input = monthly("2026-07-01");
        input.frequency = RecurringFrequency::Custom;
        input.custom_rrule = Some("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4".into());
        let dates =
            occurrence_dates(&input, NaiveDate::from_ymd_opt(2026, 7, 31).unwrap()).unwrap();
        assert_eq!(
            dates,
            ["2026-07-01", "2026-07-06", "2026-07-08", "2026-07-13"]
                .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
        );

        input.custom_rrule = Some("FREQ=HOURLY;BYSECOND=1".into());
        assert!(input.validate().is_err());
    }
}
