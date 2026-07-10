use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewCsvImportInput {
    pub source_path: String,
    pub has_header: bool,
}

impl PreviewCsvImportInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.source_path.trim().is_empty() {
            return Err(AppError::validation("sourcePath", "请选择 CSV 文件"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportPreview {
    pub batch_id: String,
    pub source_filename: String,
    pub delimiter: String,
    pub headers: Vec<String>,
    pub preview_rows: Vec<BTreeMap<String, String>>,
    pub total_rows: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvImportMapping {
    pub date_column: String,
    pub amount_column: String,
    pub description_column: Option<String>,
    pub merchant_column: Option<String>,
    pub transaction_type_column: Option<String>,
    pub currency_column: Option<String>,
    pub date_format: String,
    pub amount_sign: String,
    pub default_currency_code: String,
    pub payment_method_id: Option<String>,
}

impl CsvImportMapping {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.date_column.trim().is_empty() || self.amount_column.trim().is_empty() {
            return Err(AppError::validation(
                "mapping",
                "必须映射交易日期和金额字段",
            ));
        }
        if !matches!(
            self.date_format.as_str(),
            "yyyy-MM-dd" | "MM/dd/yyyy" | "dd/MM/yyyy" | "yyyy/MM/dd"
        ) {
            return Err(AppError::validation("dateFormat", "不支持的日期格式"));
        }
        if !matches!(
            self.amount_sign.as_str(),
            "negative_expense" | "positive_expense"
        ) {
            return Err(AppError::validation("amountSign", "不支持的金额正负规则"));
        }
        if self.default_currency_code.len() != 3
            || !self
                .default_currency_code
                .bytes()
                .all(|value| value.is_ascii_uppercase())
        {
            return Err(AppError::validation(
                "defaultCurrencyCode",
                "默认币种必须是三个大写字母",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyzeCsvImportInput {
    pub batch_id: String,
    pub mapping: CsvImportMapping,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportAnalysis {
    pub batch_id: String,
    pub valid_count: usize,
    pub duplicate_count: usize,
    pub invalid_count: usize,
    pub rows: Vec<CsvImportAnalyzedRow>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportAnalyzedRow {
    pub row_number: i64,
    pub transaction_date: Option<String>,
    pub transaction_type: Option<String>,
    pub amount_minor: Option<i64>,
    pub currency_code: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub duplicate: bool,
    pub duplicate_of_transaction_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitCsvImportInput {
    pub batch_id: String,
    pub mapping: CsvImportMapping,
    #[serde(default)]
    pub import_duplicate_row_numbers: Vec<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportCommitResult {
    pub batch_id: String,
    pub imported_count: usize,
    pub skipped_duplicate_count: usize,
    pub failed_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvImportBatchInput {
    pub batch_id: String,
}

impl CsvImportBatchInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.batch_id.trim().is_empty() {
            return Err(AppError::validation("batchId", "导入批次 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportUndoResult {
    pub batch_id: String,
    pub removed_count: usize,
}
