use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxYearInput {
    pub year: i32,
    pub reporting_currency_code: String,
}

impl TaxYearInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(1900..=2200).contains(&self.year) {
            return Err(AppError::validation(
                "year",
                "税务年度必须在 1900 到 2200 之间",
            ));
        }
        validate_currency(&self.reporting_currency_code)
    }

    pub fn start_date(&self) -> String {
        format!("{:04}-01-01", self.year)
    }

    pub fn end_date_exclusive(&self) -> String {
        format!("{:04}-01-01", self.year + 1)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxProfileRecord {
    pub id: String,
    pub name: String,
    pub country_code: String,
    pub region_code: Option<String>,
    pub disclaimer: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxTagRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub is_active: bool,
    pub sort_order: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxOrganizer {
    pub year: i32,
    pub reporting_currency_code: String,
    pub profile: TaxProfileRecord,
    pub income_minor: i64,
    pub candidate_expense_minor: i64,
    pub candidate_count: i64,
    pub confirmed_tagged_count: i64,
    pub missing_receipt_count: i64,
    pub needs_review_count: i64,
    pub excluded_currency_count: i64,
    pub tags: Vec<TaxTagRecord>,
    pub tag_totals: Vec<TaxTagTotal>,
    pub candidates: Vec<TaxCandidateRecord>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxTagTotal {
    pub tax_tag_id: String,
    pub name: String,
    pub amount_minor: i64,
    pub transaction_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxCandidateRecord {
    pub transaction_id: String,
    pub version: i64,
    pub transaction_date: String,
    pub amount_minor: i64,
    pub currency_code: String,
    pub reporting_amount_minor: i64,
    pub reporting_currency_code: String,
    pub category_name: Option<String>,
    pub payment_method_name: Option<String>,
    pub household_member_name: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub tax_tags: Vec<TaxCandidateTag>,
    pub review_flags: Vec<String>,
    pub attachment_names: Vec<String>,
    pub has_attachment: bool,
    pub needs_review: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxCandidateTag {
    pub id: String,
    pub name: String,
    pub source: String,
}

#[derive(Clone, Debug)]
pub struct TaxIncomeRecord {
    pub transaction_id: String,
    pub transaction_date: String,
    pub amount_minor: i64,
    pub currency_code: String,
    pub reporting_amount_minor: i64,
    pub reporting_currency_code: String,
    pub category_name: Option<String>,
    pub payment_method_name: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxTagMutationResult {
    pub transaction_id: String,
    pub transaction_version: i64,
    pub tax_tag_id: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetTransactionTaxTagInput {
    pub transaction_id: String,
    pub transaction_version: i64,
    pub tax_tag_id: String,
    pub selected: bool,
}

impl SetTransactionTaxTagInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.transaction_id.trim().is_empty() || self.tax_tag_id.trim().is_empty() {
            return Err(AppError::validation(
                "transactionId",
                "交易或税务标签 ID 无效",
            ));
        }
        if self.transaction_version < 1 {
            return Err(AppError::validation("transactionVersion", "交易版本无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTaxTagInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
}

impl SaveTaxTagInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(1..=100).contains(&self.name.trim().chars().count()) {
            return Err(AppError::validation(
                "name",
                "税务标签名称必须为 1 到 100 个字符",
            ));
        }
        if self
            .description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1_000)
        {
            return Err(AppError::validation(
                "description",
                "税务标签说明不能超过 1000 个字符",
            ));
        }
        if self.id.as_ref().is_some_and(|id| id.trim().is_empty()) {
            return Err(AppError::validation("id", "税务标签 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportTaxPackageInput {
    pub year: i32,
    pub reporting_currency_code: String,
    pub export_format: String,
    pub destination_path: String,
}

impl ExportTaxPackageInput {
    pub fn validate(&self) -> Result<(), AppError> {
        TaxYearInput {
            year: self.year,
            reporting_currency_code: self.reporting_currency_code.clone(),
        }
        .validate()?;
        if !matches!(self.export_format.as_str(), "csv" | "xlsx") {
            return Err(AppError::validation("exportFormat", "税务资料包格式无效"));
        }
        if self.destination_path.trim().is_empty() {
            return Err(AppError::validation(
                "destinationPath",
                "请选择税务资料包保存位置",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTaxPackageResult {
    pub destination_path: String,
    pub export_format: String,
    pub candidate_count: usize,
    pub income_count: usize,
    pub byte_count: usize,
}

fn validate_currency(code: &str) -> Result<(), AppError> {
    if code.len() != 3 || !code.bytes().all(|value| value.is_ascii_uppercase()) {
        return Err(AppError::validation(
            "reportingCurrencyCode",
            "报告币种必须是三个大写字母",
        ));
    }
    Ok(())
}
