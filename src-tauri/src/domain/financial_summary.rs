use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinancialSummaryInput {
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub reporting_currency_code: String,
}

impl FinancialSummaryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let start = parse_date("periodStartDate", &self.period_start_date)?;
        let end = parse_date("periodEndDateExclusive", &self.period_end_date_exclusive)?;
        let days = (end - start).num_days();
        if !(1..=3_700).contains(&days) {
            return Err(AppError::validation(
                "periodEndDateExclusive",
                "统计期间必须为 1 到 3700 天",
            ));
        }
        if self.reporting_currency_code.len() != 3
            || !self
                .reporting_currency_code
                .bytes()
                .all(|value| value.is_ascii_uppercase())
        {
            return Err(AppError::validation(
                "reportingCurrencyCode",
                "报表币种必须是三个大写字母",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialSummary {
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub reporting_currency_code: String,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub fixed_expense_minor: i64,
    pub variable_expense_minor: i64,
    pub net_minor: i64,
    pub actual_transaction_count: i64,
    pub excluded_currency_count: i64,
    pub daily_trend: Vec<DailyFinancialPoint>,
    pub category_totals: Vec<NamedFinancialTotal>,
    pub payment_method_totals: Vec<NamedFinancialTotal>,
    pub household_member_totals: Vec<NamedFinancialTotal>,
    pub largest_expense: Option<LargestExpense>,
    pub review_candidates: Vec<FinancialReviewCandidate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyFinancialPoint {
    pub summary_date: String,
    pub income_minor: i64,
    pub expense_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedFinancialTotal {
    pub id: String,
    pub name: String,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargestExpense {
    pub transaction_id: String,
    pub transaction_date: String,
    pub merchant: Option<String>,
    pub amount_minor: i64,
    pub category_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialReviewCandidate {
    pub transaction_id: String,
    pub transaction_date: String,
    pub merchant: Option<String>,
    pub amount_minor: i64,
    pub flag_type: String,
    pub severity: String,
    pub related_transaction_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewCandidateActionInput {
    pub transaction_id: String,
    pub flag_type: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReportNoteQueryInput {
    pub report_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
}

impl ReportNoteQueryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.report_type.as_str(), "monthly" | "annual" | "tax") {
            return Err(AppError::validation("reportType", "报告类型无效"));
        }
        let start = parse_date("periodStartDate", &self.period_start_date)?;
        let end = parse_date("periodEndDateExclusive", &self.period_end_date_exclusive)?;
        if !(1..=3_700).contains(&(end - start).num_days()) {
            return Err(AppError::validation(
                "periodEndDateExclusive",
                "报告期间必须为 1 到 3700 天",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveReportNoteInput {
    pub report_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub note: String,
    pub expected_version: Option<i64>,
}

impl SaveReportNoteInput {
    pub fn validate(&self) -> Result<(), AppError> {
        ReportNoteQueryInput {
            report_type: self.report_type.clone(),
            period_start_date: self.period_start_date.clone(),
            period_end_date_exclusive: self.period_end_date_exclusive.clone(),
        }
        .validate()?;
        if self.note.len() > 10_000 {
            return Err(AppError::validation(
                "note",
                "报告说明不能超过 10000 个字符",
            ));
        }
        if self.expected_version.is_some_and(|version| version < 1) {
            return Err(AppError::validation("expectedVersion", "版本号无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportNoteRecord {
    pub id: String,
    pub report_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub note: String,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportFinancialReportInput {
    pub report_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub reporting_currency_code: String,
    pub export_format: String,
    pub destination_path: String,
}

impl ExportFinancialReportInput {
    pub fn validate(&self) -> Result<(), AppError> {
        FinancialSummaryInput {
            period_start_date: self.period_start_date.clone(),
            period_end_date_exclusive: self.period_end_date_exclusive.clone(),
            reporting_currency_code: self.reporting_currency_code.clone(),
        }
        .validate()?;
        if !matches!(self.report_type.as_str(), "monthly" | "annual") {
            return Err(AppError::validation("reportType", "报告类型无效"));
        }
        if !matches!(self.export_format.as_str(), "csv" | "xlsx") {
            return Err(AppError::validation("exportFormat", "导出格式无效"));
        }
        if self.destination_path.trim().is_empty() {
            return Err(AppError::validation("destinationPath", "请选择保存位置"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFinancialReportResult {
    pub destination_path: String,
    pub export_format: String,
    pub record_count: usize,
    pub byte_count: usize,
}

#[derive(Clone, Debug)]
pub struct ReportExportTransaction {
    pub transaction_date: String,
    pub transaction_type: String,
    pub amount_minor: i64,
    pub currency_code: String,
    pub reporting_amount_minor: i64,
    pub reporting_currency_code: String,
    pub category_name: Option<String>,
    pub payment_method_name: Option<String>,
    pub household_member_name: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub is_fixed: bool,
}

impl ReviewCandidateActionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        const FLAGS: [&str; 8] = [
            "possible_duplicate",
            "unusually_high",
            "missing_attachment",
            "uncategorized",
            "missing_fx",
            "possible_tax_candidate",
            "tax_review",
            "subscription_change",
        ];
        if self.transaction_id.trim().is_empty() {
            return Err(AppError::validation("transactionId", "交易 ID 不能为空"));
        }
        if !FLAGS.contains(&self.flag_type.as_str()) {
            return Err(AppError::validation("flagType", "审核类型无效"));
        }
        if !matches!(self.status.as_str(), "confirmed" | "dismissed") {
            return Err(AppError::validation(
                "status",
                "审核状态必须是 confirmed 或 dismissed",
            ));
        }
        Ok(())
    }
}

fn parse_date(field: &'static str, value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::validation(field, "日期格式无效"))
}
