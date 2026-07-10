use crate::domain::csv_import::{
    AnalyzeCsvImportInput, CommitCsvImportInput, CsvImportAnalysis, CsvImportAnalyzedRow,
    CsvImportBatchInput, CsvImportCommitResult, CsvImportMapping, CsvImportPreview,
    CsvImportUndoResult, PreviewCsvImportInput,
};
use crate::error::AppError;
use chrono::{NaiveDate, Utc};
use csv::ReaderBuilder;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;
const ANALYSIS_PREVIEW_ROWS: usize = 200;

pub struct CsvImportRepository {
    database: SqlitePool,
}

#[derive(Clone)]
struct NormalizedImportRow {
    row_number: i64,
    transaction_date: String,
    transaction_type: String,
    amount_minor: i64,
    currency_code: String,
    merchant: Option<String>,
    note: Option<String>,
    fingerprint: String,
    duplicate: bool,
    duplicate_of_transaction_id: Option<String>,
}

impl CsvImportRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn preview(
        &self,
        input: &PreviewCsvImportInput,
    ) -> Result<CsvImportPreview, AppError> {
        input.validate()?;
        let path = Path::new(&input.source_path);
        if !path.is_absolute() || !path.is_file() {
            return Err(AppError::validation(
                "sourcePath",
                "CSV 路径必须是存在的绝对文件路径",
            ));
        }
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("csv"))
        {
            return Err(AppError::validation("sourcePath", "请选择 .csv 文件"));
        }
        let bytes = std::fs::read(path)
            .map_err(|error| AppError::import(format!("无法读取 CSV 文件：{error}")))?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(AppError::import("CSV 文件不能超过 25 MiB"));
        }
        let content =
            std::str::from_utf8(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes))
                .map_err(|_| AppError::import("CSV 必须使用 UTF-8 或 UTF-8 BOM 编码"))?;
        let delimiter = detect_delimiter(content);
        let mut reader = ReaderBuilder::new()
            .has_headers(false)
            .delimiter(delimiter)
            .flexible(true)
            .from_reader(content.as_bytes());
        let records: Vec<_> = reader
            .records()
            .map(|result| {
                result.map_err(|error| AppError::import(format!("CSV 解析失败：{error}")))
            })
            .collect::<Result<_, _>>()?;
        if records.is_empty() {
            return Err(AppError::import("CSV 文件没有可导入的行"));
        }
        let column_count = records
            .iter()
            .map(csv::StringRecord::len)
            .max()
            .unwrap_or(0);
        if column_count == 0 {
            return Err(AppError::import("CSV 文件没有可识别的列"));
        }
        let (headers, data_start) = if input.has_header {
            (unique_headers(&records[0], column_count), 1)
        } else {
            (
                (1..=column_count)
                    .map(|index| format!("column_{index}"))
                    .collect(),
                0,
            )
        };
        let data = &records[data_start..];
        if data.len() > MAX_ROWS {
            return Err(AppError::import("CSV 数据行不能超过 100,000 行"));
        }
        let rows: Vec<BTreeMap<String, String>> = data
            .iter()
            .map(|record| row_map(&headers, record))
            .collect();
        let batch_id = Uuid::now_v7().to_string();
        let source_filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("import.csv")
            .to_owned();
        let source_hash = format!("{:x}", Sha256::digest(&bytes));
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "INSERT INTO import_batches(
                id, source_filename, source_sha256, parser_version, mapping_schema_version,
                mapping_json, status, total_rows, created_at
             ) VALUES (?, ?, ?, 1, 1, '{}', 'previewed', ?, ?)",
        )
        .bind(&batch_id)
        .bind(&source_filename)
        .bind(source_hash)
        .bind(rows.len() as i64)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        for (index, row) in rows.iter().enumerate() {
            sqlx::query(
                "INSERT INTO import_rows(id, import_batch_id, row_number, raw_row_json, created_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&batch_id)
            .bind((index + 1) as i64)
            .bind(serde_json::to_string(row)?)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(CsvImportPreview {
            batch_id,
            source_filename,
            delimiter: match delimiter {
                b'\t' => "tab",
                b';' => "semicolon",
                _ => "comma",
            }
            .to_owned(),
            headers,
            preview_rows: rows.into_iter().take(10).collect(),
            total_rows: data.len(),
        })
    }

    pub async fn analyze(
        &self,
        input: &AnalyzeCsvImportInput,
    ) -> Result<CsvImportAnalysis, AppError> {
        input.mapping.validate()?;
        let raw_rows = self.load_batch_rows(&input.batch_id).await?;
        validate_mapping_headers(&input.mapping, &raw_rows)?;
        let analyzed = self.normalize_rows(&input.mapping, &raw_rows).await?;
        let valid_count = analyzed
            .iter()
            .filter(|row| row.error.is_none() && !row.duplicate)
            .count();
        let duplicate_count = analyzed.iter().filter(|row| row.duplicate).count();
        let invalid_count = analyzed.iter().filter(|row| row.error.is_some()).count();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "UPDATE import_batches SET mapping_json = ? WHERE id = ? AND status = 'previewed'",
        )
        .bind(serde_json::to_string(&input.mapping)?)
        .bind(&input.batch_id)
        .execute(&mut *transaction)
        .await?;
        for row in &analyzed {
            sqlx::query(
                "UPDATE import_rows SET normalized_hash = ?, duplicate_of_transaction_id = ?,
                        decision = ?, error_code = ?, error_details_json = ?
                 WHERE import_batch_id = ? AND row_number = ?",
            )
            .bind(row.fingerprint.as_deref())
            .bind(row.duplicate_of_transaction_id.as_deref())
            .bind(if row.error.is_some() {
                "review"
            } else if row.duplicate {
                "skip"
            } else {
                "import"
            })
            .bind(row.error.as_ref().map(|_| "validation_error"))
            .bind(row.error.as_ref().map(|message| {
                serde_json::json!({ "message": message, "analyzedAt": now }).to_string()
            }))
            .bind(&input.batch_id)
            .bind(row.row_number)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(CsvImportAnalysis {
            batch_id: input.batch_id.clone(),
            valid_count,
            duplicate_count,
            invalid_count,
            truncated: analyzed.len() > ANALYSIS_PREVIEW_ROWS,
            rows: analyzed
                .into_iter()
                .take(ANALYSIS_PREVIEW_ROWS)
                .map(Into::into)
                .collect(),
        })
    }

    pub async fn commit(
        &self,
        input: &CommitCsvImportInput,
    ) -> Result<CsvImportCommitResult, AppError> {
        input.mapping.validate()?;
        let raw_rows = self.load_batch_rows(&input.batch_id).await?;
        validate_mapping_headers(&input.mapping, &raw_rows)?;
        if let Some(payment_method_id) = input.mapping.payment_method_id.as_ref() {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM payment_methods WHERE id = ? AND is_active = 1",
            )
            .bind(payment_method_id)
            .fetch_one(&self.database)
            .await?;
            if exists == 0 {
                return Err(AppError::validation(
                    "paymentMethodId",
                    "导入使用的支付方式不存在或已停用",
                ));
            }
        }
        let analyzed = self.normalize_rows(&input.mapping, &raw_rows).await?;
        let force_duplicates: HashSet<i64> =
            input.import_duplicate_row_numbers.iter().copied().collect();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let claimed = sqlx::query(
            "UPDATE import_batches SET status = 'committing', mapping_json = ?
             WHERE id = ? AND status = 'previewed'",
        )
        .bind(serde_json::to_string(&input.mapping)?)
        .bind(&input.batch_id)
        .execute(&mut *transaction)
        .await?;
        if claimed.rows_affected() != 1 {
            return Err(AppError::conflict(
                "导入批次已提交、撤销或正在由其他窗口处理",
            ));
        }
        let mut imported_count = 0usize;
        let mut skipped_duplicate_count = 0usize;
        let mut failed_count = 0usize;
        for row in analyzed {
            if row.error.is_some() {
                failed_count += 1;
                continue;
            }
            if row.duplicate && !force_duplicates.contains(&row.row_number) {
                skipped_duplicate_count += 1;
                continue;
            }
            let normalized = row.normalized.expect("valid row has normalized value");
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO transactions(
                    id, transaction_date, transaction_type, status, amount_minor, currency_code,
                    reporting_amount_minor, reporting_currency_code, payment_method_id,
                    merchant, note, origin, import_batch_id, version, created_at, updated_at
                 ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, 'import', ?, 1, ?, ?)",
            )
            .bind(&id)
            .bind(&normalized.transaction_date)
            .bind(&normalized.transaction_type)
            .bind(normalized.amount_minor)
            .bind(&normalized.currency_code)
            .bind(normalized.amount_minor)
            .bind(&normalized.currency_code)
            .bind(input.mapping.payment_method_id.as_deref())
            .bind(normalized.merchant.as_deref())
            .bind(normalized.note.as_deref())
            .bind(&input.batch_id)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "UPDATE import_rows SET decision = 'import', result_transaction_id = ?, error_code = NULL,
                        error_details_json = NULL WHERE import_batch_id = ? AND row_number = ?",
            )
            .bind(&id)
            .bind(&input.batch_id)
            .bind(row.row_number)
            .execute(&mut *transaction)
            .await?;
            imported_count += 1;
        }
        let status = if failed_count == 0 {
            "completed"
        } else {
            "partially_failed"
        };
        sqlx::query(
            "UPDATE import_batches SET status = ?, success_rows = ?, failed_rows = ?, committed_at = ? WHERE id = ?",
        )
        .bind(status)
        .bind(imported_count as i64)
        .bind(failed_count as i64)
        .bind(&now)
        .bind(&input.batch_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id, after_json)
             VALUES (?, ?, 'import', 'commit_csv_import', 'import_batch', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&input.batch_id)
        .bind(
            serde_json::json!({
                "importedCount": imported_count,
                "skippedDuplicateCount": skipped_duplicate_count,
                "failedCount": failed_count
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(CsvImportCommitResult {
            batch_id: input.batch_id.clone(),
            imported_count,
            skipped_duplicate_count,
            failed_count,
        })
    }

    pub async fn undo(&self, input: &CsvImportBatchInput) -> Result<CsvImportUndoResult, AppError> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let valid: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM import_batches WHERE id = ? AND status IN ('completed', 'partially_failed')",
        )
        .bind(&input.batch_id)
        .fetch_one(&mut *transaction)
        .await?;
        if valid == 0 {
            return Err(AppError::conflict("导入批次不存在、已撤销或尚未提交"));
        }
        let removed = sqlx::query(
            "UPDATE transactions SET deleted_at = ?, updated_at = ?, version = version + 1
             WHERE import_batch_id = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(&input.batch_id)
        .execute(&mut *transaction)
        .await?
        .rows_affected() as usize;
        sqlx::query("UPDATE import_batches SET status = 'undone', undone_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&input.batch_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id, after_json)
             VALUES (?, ?, 'user', 'undo_csv_import', 'import_batch', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&input.batch_id)
        .bind(serde_json::json!({ "removedCount": removed }).to_string())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(CsvImportUndoResult {
            batch_id: input.batch_id.clone(),
            removed_count: removed,
        })
    }

    async fn load_batch_rows(
        &self,
        batch_id: &str,
    ) -> Result<Vec<(i64, BTreeMap<String, String>)>, AppError> {
        if batch_id.trim().is_empty() {
            return Err(AppError::validation("batchId", "导入批次 ID 无效"));
        }
        let status =
            sqlx::query_scalar::<_, String>("SELECT status FROM import_batches WHERE id = ?")
                .bind(batch_id)
                .fetch_optional(&self.database)
                .await?
                .ok_or_else(|| AppError::not_found("import_batch", "导入批次不存在"))?;
        if status != "previewed" {
            return Err(AppError::conflict("导入批次已经提交或撤销"));
        }
        let rows = sqlx::query(
            "SELECT row_number, raw_row_json FROM import_rows WHERE import_batch_id = ? ORDER BY row_number",
        )
        .bind(batch_id)
        .fetch_all(&self.database)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((
                    row.get("row_number"),
                    serde_json::from_str(row.get("raw_row_json"))?,
                ))
            })
            .collect()
    }

    async fn normalize_rows(
        &self,
        mapping: &CsvImportMapping,
        raw_rows: &[(i64, BTreeMap<String, String>)],
    ) -> Result<Vec<AnalyzedInternal>, AppError> {
        let mut results = Vec::with_capacity(raw_rows.len());
        let mut seen = HashMap::<String, i64>::new();
        for (row_number, raw) in raw_rows {
            match normalize_row(*row_number, raw, mapping) {
                Ok(mut normalized) => {
                    let existing = sqlx::query_scalar::<_, String>(
                        "SELECT id FROM transactions
                         WHERE deleted_at IS NULL AND transaction_date = ? AND transaction_type = ?
                           AND amount_minor = ? AND currency_code = ?
                           AND lower(trim(COALESCE(merchant, ''))) = lower(trim(?))
                         ORDER BY created_at LIMIT 1",
                    )
                    .bind(&normalized.transaction_date)
                    .bind(&normalized.transaction_type)
                    .bind(normalized.amount_minor)
                    .bind(&normalized.currency_code)
                    .bind(normalized.merchant.as_deref().unwrap_or(""))
                    .fetch_optional(&self.database)
                    .await?;
                    let duplicate_in_file =
                        seen.insert(normalized.fingerprint.clone(), *row_number);
                    normalized.duplicate = existing.is_some() || duplicate_in_file.is_some();
                    normalized.duplicate_of_transaction_id = existing;
                    results.push(AnalyzedInternal::valid(normalized));
                }
                Err(message) => results.push(AnalyzedInternal::invalid(*row_number, message)),
            }
        }
        Ok(results)
    }
}

struct AnalyzedInternal {
    row_number: i64,
    normalized: Option<NormalizedImportRow>,
    fingerprint: Option<String>,
    duplicate: bool,
    duplicate_of_transaction_id: Option<String>,
    error: Option<String>,
}

impl AnalyzedInternal {
    fn valid(row: NormalizedImportRow) -> Self {
        Self {
            row_number: row.row_number,
            fingerprint: Some(row.fingerprint.clone()),
            duplicate: row.duplicate,
            duplicate_of_transaction_id: row.duplicate_of_transaction_id.clone(),
            normalized: Some(row),
            error: None,
        }
    }

    fn invalid(row_number: i64, message: String) -> Self {
        Self {
            row_number,
            normalized: None,
            fingerprint: None,
            duplicate: false,
            duplicate_of_transaction_id: None,
            error: Some(message),
        }
    }
}

impl From<AnalyzedInternal> for CsvImportAnalyzedRow {
    fn from(value: AnalyzedInternal) -> Self {
        let normalized = value.normalized;
        Self {
            row_number: value.row_number,
            transaction_date: normalized.as_ref().map(|row| row.transaction_date.clone()),
            transaction_type: normalized.as_ref().map(|row| row.transaction_type.clone()),
            amount_minor: normalized.as_ref().map(|row| row.amount_minor),
            currency_code: normalized.as_ref().map(|row| row.currency_code.clone()),
            merchant: normalized.as_ref().and_then(|row| row.merchant.clone()),
            note: normalized.as_ref().and_then(|row| row.note.clone()),
            duplicate: value.duplicate,
            duplicate_of_transaction_id: value.duplicate_of_transaction_id,
            error: value.error,
        }
    }
}

fn normalize_row(
    row_number: i64,
    row: &BTreeMap<String, String>,
    mapping: &CsvImportMapping,
) -> Result<NormalizedImportRow, String> {
    let date_text = required(row, &mapping.date_column, "日期")?;
    let date_format = match mapping.date_format.as_str() {
        "MM/dd/yyyy" => "%m/%d/%Y",
        "dd/MM/yyyy" => "%d/%m/%Y",
        "yyyy/MM/dd" => "%Y/%m/%d",
        _ => "%Y-%m-%d",
    };
    let transaction_date = NaiveDate::parse_from_str(date_text.trim(), date_format)
        .map_err(|_| format!("第 {row_number} 行日期格式无效"))?
        .format("%Y-%m-%d")
        .to_string();
    let signed_minor = parse_minor(required(row, &mapping.amount_column, "金额")?)
        .map_err(|message| format!("第 {row_number} 行{message}"))?;
    if signed_minor == 0 {
        return Err(format!("第 {row_number} 行金额不能为零"));
    }
    let explicit_type = mapping
        .transaction_type_column
        .as_ref()
        .and_then(|column| row.get(column))
        .map(|value| value.trim().to_lowercase());
    let transaction_type = if let Some(kind) = explicit_type {
        match kind.as_str() {
            "income" | "credit" | "收入" => "income",
            "expense" | "debit" | "支出" => "expense",
            _ => return Err(format!("第 {row_number} 行交易类型无法识别")),
        }
    } else if (signed_minor < 0 && mapping.amount_sign == "negative_expense")
        || (signed_minor > 0 && mapping.amount_sign == "positive_expense")
    {
        "expense"
    } else {
        "income"
    }
    .to_owned();
    let amount_minor = signed_minor.unsigned_abs() as i64;
    let currency_code = mapping
        .currency_column
        .as_ref()
        .and_then(|column| row.get(column))
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| mapping.default_currency_code.clone());
    if currency_code != mapping.default_currency_code {
        return Err(format!(
            "第 {row_number} 行币种为 {currency_code}；首版导入不自动换汇，请先换算为 {}",
            mapping.default_currency_code
        ));
    }
    let merchant = optional(row, mapping.merchant_column.as_ref());
    let note = optional(row, mapping.description_column.as_ref());
    let fingerprint_source = format!(
        "{}|{}|{}|{}|{}",
        transaction_date,
        transaction_type,
        amount_minor,
        currency_code,
        merchant.as_deref().unwrap_or("").trim().to_lowercase()
    );
    let fingerprint = format!("{:x}", Sha256::digest(fingerprint_source.as_bytes()));
    Ok(NormalizedImportRow {
        row_number,
        transaction_date,
        transaction_type,
        amount_minor,
        currency_code,
        merchant,
        note,
        fingerprint,
        duplicate: false,
        duplicate_of_transaction_id: None,
    })
}

fn parse_minor(value: &str) -> Result<i64, String> {
    let trimmed = value.trim();
    let parenthesized = trimmed.starts_with('(') && trimmed.ends_with(')');
    let mut normalized: String = trimmed
        .chars()
        .filter(|character| {
            !character.is_whitespace()
                && *character != ','
                && *character != '$'
                && !character.is_ascii_alphabetic()
        })
        .collect();
    if parenthesized {
        normalized = format!("-{}", normalized.trim_matches(['(', ')']));
    }
    let negative = normalized.starts_with('-');
    let unsigned = normalized.trim_start_matches(['-', '+']);
    let parts: Vec<_> = unsigned.split('.').collect();
    if parts.len() > 2 || parts[0].is_empty() || !parts[0].bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("金额格式无效".to_owned());
    }
    let fraction = parts.get(1).copied().unwrap_or("");
    if fraction.len() > 2 || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("金额最多只能有两位小数".to_owned());
    }
    let whole: i64 = parts[0]
        .parse()
        .map_err(|_| "金额超出可保存范围".to_owned())?;
    let cents = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().unwrap() * 10,
        _ => fraction.parse::<i64>().unwrap(),
    };
    let result = whole
        .checked_mul(100)
        .and_then(|amount| amount.checked_add(cents))
        .ok_or_else(|| "金额超出可保存范围".to_owned())?;
    Ok(if negative { -result } else { result })
}

fn validate_mapping_headers(
    mapping: &CsvImportMapping,
    rows: &[(i64, BTreeMap<String, String>)],
) -> Result<(), AppError> {
    let Some((_, first)) = rows.first() else {
        return Err(AppError::import("导入批次没有数据行"));
    };
    for column in [
        Some(&mapping.date_column),
        Some(&mapping.amount_column),
        mapping.description_column.as_ref(),
        mapping.merchant_column.as_ref(),
        mapping.transaction_type_column.as_ref(),
        mapping.currency_column.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        if !first.contains_key(column) {
            return Err(AppError::validation(
                "mapping",
                format!("CSV 中不存在列：{column}"),
            ));
        }
    }
    Ok(())
}

fn required<'a>(
    row: &'a BTreeMap<String, String>,
    column: &str,
    label: &str,
) -> Result<&'a str, String> {
    row.get(column)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{label}不能为空"))
}

fn optional(row: &BTreeMap<String, String>, column: Option<&String>) -> Option<String> {
    column
        .and_then(|column| row.get(column))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn unique_headers(record: &csv::StringRecord, column_count: usize) -> Vec<String> {
    let mut counts = HashMap::<String, usize>::new();
    (0..column_count)
        .map(|index| {
            let base = record
                .get(index)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("column_{}", index + 1));
            let count = counts.entry(base.clone()).or_default();
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base}_{}", *count)
            }
        })
        .collect()
}

fn row_map(headers: &[String], record: &csv::StringRecord) -> BTreeMap<String, String> {
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            (
                header.clone(),
                record.get(index).unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

fn detect_delimiter(content: &str) -> u8 {
    let line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    [
        (b',', line.matches(',').count()),
        (b'\t', line.matches('\t').count()),
        (b';', line.matches(';').count()),
    ]
    .into_iter()
    .max_by_key(|(_, count)| *count)
    .filter(|(_, count)| *count > 0)
    .map(|(delimiter, _)| delimiter)
    .unwrap_or(b',')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    fn mapping() -> CsvImportMapping {
        CsvImportMapping {
            date_column: "date".into(),
            amount_column: "amount".into(),
            description_column: Some("note".into()),
            merchant_column: Some("merchant".into()),
            transaction_type_column: None,
            currency_column: None,
            date_format: "yyyy-MM-dd".into(),
            amount_sign: "negative_expense".into(),
            default_currency_code: "CAD".into(),
            payment_method_id: None,
        }
    }

    #[tokio::test]
    async fn preview_analyze_commit_and_undo_are_exact_and_batch_scoped() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("import.sqlite3"))
            .await
            .unwrap();
        let source = directory.path().join("bank.csv");
        std::fs::write(
            &source,
            "date,amount,merchant,note\n2026-01-02,-12.34,Store,Groceries\n2026-01-03,100.00,Employer,Pay\n2026-01-02,-12.34,Store,Duplicate\nbad,-5.00,Invalid,Bad date\n",
        )
        .unwrap();
        let repository = CsvImportRepository::new(database.clone());
        let preview = repository
            .preview(&PreviewCsvImportInput {
                source_path: source.to_string_lossy().into_owned(),
                has_header: true,
            })
            .await
            .unwrap();
        assert_eq!(preview.total_rows, 4);
        assert_eq!(preview.headers, ["date", "amount", "merchant", "note"]);

        let analysis = repository
            .analyze(&AnalyzeCsvImportInput {
                batch_id: preview.batch_id.clone(),
                mapping: mapping(),
            })
            .await
            .unwrap();
        assert_eq!(analysis.valid_count, 2);
        assert_eq!(analysis.duplicate_count, 1);
        assert_eq!(analysis.invalid_count, 1);
        assert_eq!(analysis.rows[0].amount_minor, Some(1_234));
        assert_eq!(
            analysis.rows[0].transaction_type.as_deref(),
            Some("expense")
        );

        let committed = repository
            .commit(&CommitCsvImportInput {
                batch_id: preview.batch_id.clone(),
                mapping: mapping(),
                import_duplicate_row_numbers: vec![],
            })
            .await
            .unwrap();
        assert_eq!(committed.imported_count, 2);
        assert_eq!(committed.skipped_duplicate_count, 1);
        assert_eq!(committed.failed_count, 1);
        let amounts: Vec<i64> = sqlx::query_scalar(
            "SELECT amount_minor FROM transactions WHERE import_batch_id = ? ORDER BY amount_minor",
        )
        .bind(&preview.batch_id)
        .fetch_all(&database)
        .await
        .unwrap();
        assert_eq!(amounts, [1_234, 10_000]);

        let undone = repository
            .undo(&CsvImportBatchInput {
                batch_id: preview.batch_id.clone(),
            })
            .await
            .unwrap();
        assert_eq!(undone.removed_count, 2);
        let actual_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM v_actual_transactions")
            .fetch_one(&database)
            .await
            .unwrap();
        assert_eq!(actual_count, 0);
    }

    #[test]
    fn amount_parser_never_uses_floating_point() {
        assert_eq!(parse_minor("$1,234.56 CAD").unwrap(), 123_456);
        assert_eq!(parse_minor("(12.3)").unwrap(), -1_230);
        assert!(parse_minor("1.234").is_err());
        assert!(parse_minor("NaN").is_err());
    }
}
