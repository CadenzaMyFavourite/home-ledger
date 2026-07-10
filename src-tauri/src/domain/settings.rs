use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupPolicy {
    pub enabled: bool,
    pub interval_days: u16,
    #[serde(default = "default_retention_count")]
    pub retention_count: u16,
}

impl Default for AutoBackupPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_days: 7,
            retention_count: default_retention_count(),
        }
    }
}

fn default_retention_count() -> u16 {
    8
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarColorOverrides {
    pub general: String,
    pub important: String,
    pub travel: String,
    pub medical: String,
    pub education: String,
    pub bill: String,
    pub tax: String,
    pub maintenance: String,
    pub other: String,
}

impl Default for CalendarColorOverrides {
    fn default() -> Self {
        Self {
            general: "#1976D2".to_owned(),
            important: "#D9364F".to_owned(),
            travel: "#7455D9".to_owned(),
            medical: "#D9364F".to_owned(),
            education: "#1976D2".to_owned(),
            bill: "#B66A00".to_owned(),
            tax: "#B66A00".to_owned(),
            maintenance: "#087F7A".to_owned(),
            other: "#667085".to_owned(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub locale: String,
    pub timezone_id: String,
    pub reporting_currency_code: String,
    pub country_code: String,
    pub region_code: String,
    pub theme: ThemePreference,
    pub auto_backup_policy: AutoBackupPolicy,
    pub calendar_color_overrides: CalendarColorOverrides,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            locale: "zh-CN".to_owned(),
            timezone_id: "America/Toronto".to_owned(),
            reporting_currency_code: "CAD".to_owned(),
            country_code: "CA".to_owned(),
            region_code: "ON".to_owned(),
            theme: ThemePreference::System,
            auto_backup_policy: AutoBackupPolicy::default(),
            calendar_color_overrides: CalendarColorOverrides::default(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateSettingsInput {
    pub locale: String,
    pub timezone_id: String,
    pub reporting_currency_code: String,
    pub country_code: String,
    pub region_code: String,
    pub theme: ThemePreference,
    pub auto_backup_policy: AutoBackupPolicy,
    pub calendar_color_overrides: CalendarColorOverrides,
}

impl UpdateSettingsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.locale.as_str(), "zh-CN" | "en-CA") {
            return Err(AppError::validation("locale", "暂不支持该界面语言"));
        }
        if self.timezone_id.trim().is_empty() || self.timezone_id.len() > 100 {
            return Err(AppError::validation("timezoneId", "时区不能为空"));
        }
        validate_upper_code("reportingCurrencyCode", &self.reporting_currency_code, 3)?;
        validate_upper_code("countryCode", &self.country_code, 2)?;
        if self.region_code.is_empty()
            || self.region_code.len() > 3
            || !self.region_code.chars().all(|c| c.is_ascii_uppercase())
        {
            return Err(AppError::validation("regionCode", "地区代码格式无效"));
        }
        if !(1..=365).contains(&self.auto_backup_policy.interval_days) {
            return Err(AppError::validation(
                "autoBackupPolicy.intervalDays",
                "自动备份间隔必须为 1 到 365 天",
            ));
        }
        if !(1..=100).contains(&self.auto_backup_policy.retention_count) {
            return Err(AppError::validation(
                "autoBackupPolicy.retentionCount",
                "自动备份保留数量必须为 1 到 100",
            ));
        }
        for (field, color) in [
            (
                "calendarColorOverrides.general",
                &self.calendar_color_overrides.general,
            ),
            (
                "calendarColorOverrides.important",
                &self.calendar_color_overrides.important,
            ),
            (
                "calendarColorOverrides.travel",
                &self.calendar_color_overrides.travel,
            ),
            (
                "calendarColorOverrides.medical",
                &self.calendar_color_overrides.medical,
            ),
            (
                "calendarColorOverrides.education",
                &self.calendar_color_overrides.education,
            ),
            (
                "calendarColorOverrides.bill",
                &self.calendar_color_overrides.bill,
            ),
            (
                "calendarColorOverrides.tax",
                &self.calendar_color_overrides.tax,
            ),
            (
                "calendarColorOverrides.maintenance",
                &self.calendar_color_overrides.maintenance,
            ),
            (
                "calendarColorOverrides.other",
                &self.calendar_color_overrides.other,
            ),
        ] {
            validate_hex_color(field, color)?;
        }
        Ok(())
    }
}

fn validate_hex_color(field: &'static str, value: &str) -> Result<(), AppError> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::validation(field, "颜色必须是六位十六进制值"));
    }
    Ok(())
}

fn validate_upper_code(field: &'static str, value: &str, length: usize) -> Result<(), AppError> {
    if value.len() != length || !value.chars().all(|c| c.is_ascii_uppercase()) {
        return Err(AppError::validation(field, "代码必须使用大写英文字母"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_lowercase_currency_code() {
        let input = UpdateSettingsInput {
            locale: "zh-CN".into(),
            timezone_id: "America/Toronto".into(),
            reporting_currency_code: "cad".into(),
            country_code: "CA".into(),
            region_code: "ON".into(),
            theme: ThemePreference::System,
            auto_backup_policy: AutoBackupPolicy::default(),
            calendar_color_overrides: CalendarColorOverrides::default(),
        };

        assert!(input.validate().is_err());
    }

    #[test]
    fn legacy_auto_backup_policy_gets_safe_retention_default() {
        let policy: AutoBackupPolicy =
            serde_json::from_str(r#"{"enabled":true,"intervalDays":14}"#).unwrap();

        assert!(policy.enabled);
        assert_eq!(policy.interval_days, 14);
        assert_eq!(policy.retention_count, 8);
    }

    #[test]
    fn rejects_invalid_calendar_color_override() {
        let input = UpdateSettingsInput {
            locale: "zh-CN".into(),
            timezone_id: "America/Toronto".into(),
            reporting_currency_code: "CAD".into(),
            country_code: "CA".into(),
            region_code: "ON".into(),
            theme: ThemePreference::System,
            auto_backup_policy: AutoBackupPolicy::default(),
            calendar_color_overrides: CalendarColorOverrides {
                travel: "blue".into(),
                ..CalendarColorOverrides::default()
            },
        };

        assert!(input.validate().is_err());
    }
}
