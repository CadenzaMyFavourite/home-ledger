use crate::domain::tax::{
    SaveTaxTagInput, SetTransactionTaxTagInput, TaxCandidateRecord, TaxCandidateTag,
    TaxIncomeRecord, TaxOrganizer, TaxProfileRecord, TaxTagMutationResult, TaxTagRecord,
    TaxTagTotal, TaxYearInput,
};
use crate::error::AppError;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use uuid::Uuid;

const FALLBACK_DISCLAIMER: &str = "系统只能帮助整理记录、分类和生成候选清单，不能保证某项支出可以抵税。最终税务处理应由用户或专业人士确认。";

pub struct TaxRepository {
    database: SqlitePool,
}

impl TaxRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn get_organizer(&self, input: &TaxYearInput) -> Result<TaxOrganizer, AppError> {
        input.validate()?;
        let profile = self.default_profile().await?;
        let tags = self.list_tags().await?;
        let candidates = self.list_candidates(input).await?;
        let income_minor = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(reporting_amount_minor), 0)
             FROM v_actual_transactions
             WHERE transaction_type = 'income' AND transaction_date >= ? AND transaction_date < ?
               AND reporting_currency_code = ?",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_one(&self.database)
        .await?;
        let excluded_currency_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM v_actual_transactions t
             WHERE t.transaction_type = 'expense' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND COALESCE(t.reporting_currency_code, '') <> ?
               AND (EXISTS (SELECT 1 FROM transaction_tax_tags x WHERE x.transaction_id = t.id
                            AND x.tax_tag_id NOT IN ('00000000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-000000000202'))
                    OR EXISTS (SELECT 1 FROM review_flags f WHERE f.transaction_id = t.id
                               AND f.status = 'open' AND f.flag_type IN ('possible_tax_candidate', 'tax_review')))",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_one(&self.database)
        .await?;

        let mut totals: HashMap<String, TaxTagTotal> = HashMap::new();
        for candidate in &candidates {
            for tag in &candidate.tax_tags {
                let total = totals.entry(tag.id.clone()).or_insert_with(|| TaxTagTotal {
                    tax_tag_id: tag.id.clone(),
                    name: tag.name.clone(),
                    amount_minor: 0,
                    transaction_count: 0,
                });
                total.amount_minor += candidate.reporting_amount_minor;
                total.transaction_count += 1;
            }
        }
        let mut tag_totals: Vec<_> = totals.into_values().collect();
        tag_totals.sort_by(|a, b| a.name.cmp(&b.name));
        let candidate_expense_minor = candidates
            .iter()
            .map(|candidate| candidate.reporting_amount_minor)
            .sum();
        let confirmed_tagged_count = candidates
            .iter()
            .filter(|candidate| !candidate.tax_tags.is_empty())
            .count() as i64;
        let missing_receipt_count = candidates
            .iter()
            .filter(|candidate| !candidate.has_attachment)
            .count() as i64;
        let needs_review_count = candidates
            .iter()
            .filter(|candidate| candidate.needs_review)
            .count() as i64;

        Ok(TaxOrganizer {
            year: input.year,
            reporting_currency_code: input.reporting_currency_code.clone(),
            profile,
            income_minor,
            candidate_expense_minor,
            candidate_count: candidates.len() as i64,
            confirmed_tagged_count,
            missing_receipt_count,
            needs_review_count,
            excluded_currency_count,
            tags,
            tag_totals,
            candidates,
        })
    }

    pub async fn list_income(
        &self,
        input: &TaxYearInput,
    ) -> Result<Vec<TaxIncomeRecord>, AppError> {
        input.validate()?;
        let rows = sqlx::query(
            "SELECT t.id, t.transaction_date, t.amount_minor, t.currency_code,
                    t.reporting_amount_minor, t.reporting_currency_code,
                    c.name AS category_name, p.display_name AS payment_method_name,
                    t.merchant, t.note
             FROM v_actual_transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN payment_methods p ON p.id = t.payment_method_id
             WHERE t.transaction_type = 'income' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
             ORDER BY t.transaction_date, t.id",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        Ok(rows
            .iter()
            .map(|row| TaxIncomeRecord {
                transaction_id: row.get("id"),
                transaction_date: row.get("transaction_date"),
                amount_minor: row.get("amount_minor"),
                currency_code: row.get("currency_code"),
                reporting_amount_minor: row.get("reporting_amount_minor"),
                reporting_currency_code: row.get("reporting_currency_code"),
                category_name: row.get("category_name"),
                payment_method_name: row.get("payment_method_name"),
                merchant: row.get("merchant"),
                note: row.get("note"),
            })
            .collect())
    }

    pub async fn set_transaction_tag(
        &self,
        input: &SetTransactionTaxTagInput,
    ) -> Result<TaxTagMutationResult, AppError> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let kind = sqlx::query_scalar::<_, String>(
            "SELECT transaction_type FROM transactions
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(&input.transaction_id)
        .bind(input.transaction_version)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AppError::conflict("交易已在其他窗口修改或不存在，请刷新后重试"))?;
        if kind == "transfer" {
            return Err(AppError::validation(
                "transactionId",
                "转账不能设置税务候选标签",
            ));
        }
        let tag_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tax_tags tt JOIN tax_profiles tp ON tp.id = tt.tax_profile_id
             WHERE tt.id = ? AND tt.is_active = 1 AND tp.is_active = 1 AND tp.is_default = 1",
        )
        .bind(&input.tax_tag_id)
        .fetch_one(&mut *transaction)
        .await?;
        if tag_exists == 0 {
            return Err(AppError::not_found("tax_tag", "税务标签不存在或已停用"));
        }
        if input.selected {
            sqlx::query(
                "INSERT INTO transaction_tax_tags(transaction_id, tax_tag_id, source, confirmed_at, created_at)
                 VALUES (?, ?, 'user', ?, ?)
                 ON CONFLICT(transaction_id, tax_tag_id) DO UPDATE SET source = 'user', confirmed_at = excluded.confirmed_at",
            )
            .bind(&input.transaction_id)
            .bind(&input.tax_tag_id)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            if input.tax_tag_id != "00000000-0000-7000-8000-000000000212" {
                sqlx::query(
                    "UPDATE review_flags SET status = 'resolved', resolved_at = ?, updated_at = ?
                     WHERE transaction_id = ? AND status = 'open'
                       AND flag_type IN ('possible_tax_candidate', 'tax_review')",
                )
                .bind(&now)
                .bind(&now)
                .bind(&input.transaction_id)
                .execute(&mut *transaction)
                .await?;
            }
        } else {
            sqlx::query(
                "DELETE FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
            )
            .bind(&input.transaction_id)
            .bind(&input.tax_tag_id)
            .execute(&mut *transaction)
            .await?;
        }
        let updated = sqlx::query(
            "UPDATE transactions SET version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&input.transaction_id)
        .bind(input.transaction_version)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::conflict("交易已在其他窗口修改，请刷新后重试"));
        }
        let version = input.transaction_version + 1;
        sqlx::query(
            "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id, after_json)
             VALUES (?, ?, 'user', ?, 'transaction_tax_tag', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(if input.selected { "set_tax_tag" } else { "remove_tax_tag" })
        .bind(&input.transaction_id)
        .bind(
            serde_json::json!({
                "taxTagId": input.tax_tag_id,
                "selected": input.selected,
                "transactionVersion": version
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(TaxTagMutationResult {
            transaction_id: input.transaction_id.clone(),
            transaction_version: version,
            tax_tag_id: input.tax_tag_id.clone(),
            selected: input.selected,
        })
    }

    pub async fn save_tag(&self, input: &SaveTaxTagInput) -> Result<TaxTagRecord, AppError> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let profile_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM tax_profiles WHERE is_default = 1 AND is_active = 1",
        )
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AppError::not_found("tax_profile", "默认税务配置不存在"))?;
        let id = if let Some(id) = input.id.as_ref() {
            let changed = sqlx::query(
                "UPDATE tax_tags SET name = ?, description = ?, is_active = ?, updated_at = ?
                 WHERE id = ? AND tax_profile_id = ? AND is_system = 0",
            )
            .bind(input.name.trim())
            .bind(
                input
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty()),
            )
            .bind(input.is_active)
            .bind(&now)
            .bind(id)
            .bind(&profile_id)
            .execute(&mut *transaction)
            .await
            .map_err(map_unique_name)?;
            if changed.rows_affected() == 0 {
                return Err(AppError::conflict(
                    "系统税务标签不可修改，或自定义标签不存在",
                ));
            }
            id.clone()
        } else {
            let id = Uuid::now_v7().to_string();
            let sort_order = sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM tax_tags WHERE tax_profile_id = ?",
            )
            .bind(&profile_id)
            .fetch_one(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO tax_tags(id, tax_profile_id, name, description, is_system, is_active, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&profile_id)
            .bind(input.name.trim())
            .bind(input.description.as_deref().map(str::trim).filter(|value| !value.is_empty()))
            .bind(input.is_active)
            .bind(sort_order)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(map_unique_name)?;
            id
        };
        let row = sqlx::query(
            "SELECT id, name, description, is_system, is_active, sort_order FROM tax_tags WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        let record = map_tag(&row);
        sqlx::query(
            "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id, after_json)
             VALUES (?, ?, 'user', 'save_tax_tag', 'tax_tag', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&id)
        .bind(serde_json::to_string(&record)?)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(record)
    }

    async fn default_profile(&self) -> Result<TaxProfileRecord, AppError> {
        let row = sqlx::query(
            "SELECT id, name, country_code, region_code, config_json
             FROM tax_profiles WHERE is_default = 1 AND is_active = 1",
        )
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("tax_profile", "默认税务配置不存在"))?;
        let config: Value = serde_json::from_str(row.get("config_json"))?;
        Ok(TaxProfileRecord {
            id: row.get("id"),
            name: row.get("name"),
            country_code: row.get("country_code"),
            region_code: row.get("region_code"),
            disclaimer: config
                .get("disclaimer")
                .and_then(Value::as_str)
                .unwrap_or(FALLBACK_DISCLAIMER)
                .to_owned(),
        })
    }

    async fn list_tags(&self) -> Result<Vec<TaxTagRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT tt.id, tt.name, tt.description, tt.is_system, tt.is_active, tt.sort_order
             FROM tax_tags tt JOIN tax_profiles tp ON tp.id = tt.tax_profile_id
             WHERE tp.is_default = 1 AND tp.is_active = 1
             ORDER BY tt.sort_order, tt.name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        Ok(rows.iter().map(map_tag).collect())
    }

    async fn list_candidates(
        &self,
        input: &TaxYearInput,
    ) -> Result<Vec<TaxCandidateRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT t.id, t.version, t.transaction_date, t.amount_minor, t.currency_code,
                    t.reporting_amount_minor, t.reporting_currency_code,
                    c.name AS category_name, p.display_name AS payment_method_name,
                    h.display_name AS household_member_name, t.merchant, t.note
             FROM v_actual_transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN payment_methods p ON p.id = t.payment_method_id
             LEFT JOIN household_members h ON h.id = t.household_member_id
             WHERE t.transaction_type = 'expense' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
               AND (EXISTS (SELECT 1 FROM transaction_tax_tags x WHERE x.transaction_id = t.id
                            AND x.tax_tag_id NOT IN ('00000000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-000000000202'))
                    OR EXISTS (SELECT 1 FROM review_flags f WHERE f.transaction_id = t.id
                               AND f.status = 'open' AND f.flag_type IN ('possible_tax_candidate', 'tax_review')))
             ORDER BY t.transaction_date DESC, t.id DESC",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        let tag_rows = sqlx::query(
            "SELECT x.transaction_id, tt.id, tt.name, x.source
             FROM transaction_tax_tags x JOIN tax_tags tt ON tt.id = x.tax_tag_id
             JOIN v_actual_transactions t ON t.id = x.transaction_id
             WHERE t.transaction_type = 'expense' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
             ORDER BY tt.sort_order, tt.name COLLATE NOCASE",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        let flag_rows = sqlx::query(
            "SELECT f.transaction_id, f.flag_type FROM review_flags f
             JOIN v_actual_transactions t ON t.id = f.transaction_id
             WHERE f.status = 'open' AND f.flag_type IN ('possible_tax_candidate', 'tax_review')
               AND t.transaction_type = 'expense' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ? ORDER BY f.flag_type",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        let attachment_rows = sqlx::query(
            "SELECT ta.transaction_id, a.original_filename FROM transaction_attachments ta
             JOIN attachments a ON a.id = ta.attachment_id AND a.deleted_at IS NULL
             JOIN v_actual_transactions t ON t.id = ta.transaction_id
             WHERE t.transaction_type = 'expense' AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ? ORDER BY ta.sort_order, a.original_filename COLLATE NOCASE",
        )
        .bind(input.start_date())
        .bind(input.end_date_exclusive())
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;

        let mut tags: HashMap<String, Vec<TaxCandidateTag>> = HashMap::new();
        for row in tag_rows {
            tags.entry(row.get("transaction_id"))
                .or_default()
                .push(TaxCandidateTag {
                    id: row.get("id"),
                    name: row.get("name"),
                    source: row.get("source"),
                });
        }
        let mut flags: HashMap<String, Vec<String>> = HashMap::new();
        for row in flag_rows {
            flags
                .entry(row.get("transaction_id"))
                .or_default()
                .push(row.get("flag_type"));
        }
        let mut attachments: HashMap<String, Vec<String>> = HashMap::new();
        for row in attachment_rows {
            attachments
                .entry(row.get("transaction_id"))
                .or_default()
                .push(row.get("original_filename"));
        }
        Ok(rows
            .iter()
            .map(|row| {
                let id: String = row.get("id");
                let tax_tags = tags.remove(&id).unwrap_or_default();
                let review_flags = flags.remove(&id).unwrap_or_default();
                let attachment_names = attachments.remove(&id).unwrap_or_default();
                let needs_review = tax_tags.is_empty()
                    || !review_flags.is_empty()
                    || tax_tags
                        .iter()
                        .any(|tag| tag.id == "00000000-0000-7000-8000-000000000212");
                TaxCandidateRecord {
                    transaction_id: id,
                    version: row.get("version"),
                    transaction_date: row.get("transaction_date"),
                    amount_minor: row.get("amount_minor"),
                    currency_code: row.get("currency_code"),
                    reporting_amount_minor: row.get("reporting_amount_minor"),
                    reporting_currency_code: row.get("reporting_currency_code"),
                    category_name: row.get("category_name"),
                    payment_method_name: row.get("payment_method_name"),
                    household_member_name: row.get("household_member_name"),
                    merchant: row.get("merchant"),
                    note: row.get("note"),
                    has_attachment: !attachment_names.is_empty(),
                    attachment_names,
                    tax_tags,
                    review_flags,
                    needs_review,
                }
            })
            .collect())
    }
}

fn map_tag(row: &sqlx::sqlite::SqliteRow) -> TaxTagRecord {
    TaxTagRecord {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        is_system: row.get("is_system"),
        is_active: row.get("is_active"),
        sort_order: row.get("sort_order"),
    }
}

fn map_unique_name(error: sqlx::Error) -> AppError {
    if error.to_string().contains("tax_tags_unique_name")
        || error
            .to_string()
            .contains("UNIQUE constraint failed: tax_tags")
    {
        AppError::conflict("同名税务标签已经存在")
    } else {
        AppError::Database(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    async fn insert_transaction(
        database: &SqlitePool,
        id: &str,
        kind: &str,
        status: &str,
        amount_minor: i64,
        currency: &str,
    ) {
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, origin, version, created_at, updated_at
             ) VALUES (?, '2026-03-12', ?, ?, ?, ?, ?, ?, 'manual', 1, '2026-03-12T12:00:00Z', '2026-03-12T12:00:00Z')",
        )
        .bind(id)
        .bind(kind)
        .bind(status)
        .bind(amount_minor)
        .bind(currency)
        .bind(amount_minor)
        .bind(currency)
        .execute(database)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn organizer_uses_actual_transactions_and_tracks_missing_receipts() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("tax.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "income", "income", "completed", 500_001, "CAD").await;
        insert_transaction(&database, "tagged", "expense", "completed", 12_345, "CAD").await;
        insert_transaction(&database, "flagged", "expense", "completed", 8_765, "CAD").await;
        insert_transaction(&database, "planned", "expense", "planned", 99_999, "CAD").await;
        insert_transaction(&database, "foreign", "expense", "completed", 4_000, "USD").await;
        for id in ["tagged", "foreign"] {
            sqlx::query(
                "INSERT INTO transaction_tax_tags(transaction_id, tax_tag_id, source, confirmed_at, created_at)
                 VALUES (?, '00000000-0000-7000-8000-000000000207', 'user', '2026-03-12T12:00:00Z', '2026-03-12T12:00:00Z')",
            )
            .bind(id)
            .execute(&database)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO review_flags(id, transaction_id, flag_type, severity, detector_version, details_json, status, created_at, updated_at)
             VALUES ('flag-1', 'flagged', 'possible_tax_candidate', 'info', 1, '{}', 'open', '2026-03-12T12:00:00Z', '2026-03-12T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO attachments(id, original_filename, stored_filename, relative_path, mime_type, file_size, sha256, attachment_type, created_at)
             VALUES ('receipt', 'receipt.pdf', 'receipt.pdf', 'attachments/receipt.pdf', 'application/pdf', 1,
                     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'receipt', '2026-03-12T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_attachments(transaction_id, attachment_id, created_at)
             VALUES ('tagged', 'receipt', '2026-03-12T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();

        let organizer = TaxRepository::new(database)
            .get_organizer(&TaxYearInput {
                year: 2026,
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        assert_eq!(organizer.income_minor, 500_001);
        assert_eq!(organizer.candidate_expense_minor, 21_110);
        assert_eq!(organizer.candidate_count, 2);
        assert_eq!(organizer.confirmed_tagged_count, 1);
        assert_eq!(organizer.missing_receipt_count, 1);
        assert_eq!(organizer.needs_review_count, 1);
        assert_eq!(organizer.excluded_currency_count, 1);
    }

    #[tokio::test]
    async fn manual_tax_tag_is_audited_without_changing_amount() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("tag.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "expense", "expense", "completed", 54_321, "CAD").await;
        let repository = TaxRepository::new(database.clone());
        let changed = repository
            .set_transaction_tag(&SetTransactionTaxTagInput {
                transaction_id: "expense".into(),
                transaction_version: 1,
                tax_tag_id: "00000000-0000-7000-8000-000000000211".into(),
                selected: true,
            })
            .await
            .unwrap();
        let row =
            sqlx::query("SELECT amount_minor, version FROM transactions WHERE id = 'expense'")
                .fetch_one(&database)
                .await
                .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE entity_id = 'expense' AND action = 'set_tax_tag'",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(changed.transaction_version, 2);
        assert_eq!(row.get::<i64, _>("amount_minor"), 54_321);
        assert_eq!(row.get::<i64, _>("version"), 2);
        assert_eq!(audit_count, 1);
    }

    #[tokio::test]
    async fn non_tax_tag_resolves_hint_and_excludes_candidate() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("exclude.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "personal", "expense", "completed", 44_444, "CAD").await;
        sqlx::query(
            "INSERT INTO review_flags(id, transaction_id, flag_type, severity, detector_version, details_json, status, created_at, updated_at)
             VALUES ('tax-hint', 'personal', 'possible_tax_candidate', 'info', 1, '{}', 'open', '2026-03-12T12:00:00Z', '2026-03-12T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        let repository = TaxRepository::new(database.clone());
        repository
            .set_transaction_tag(&SetTransactionTaxTagInput {
                transaction_id: "personal".into(),
                transaction_version: 1,
                tax_tag_id: "00000000-0000-7000-8000-000000000201".into(),
                selected: true,
            })
            .await
            .unwrap();
        let flag_status: String =
            sqlx::query_scalar("SELECT status FROM review_flags WHERE id = 'tax-hint'")
                .fetch_one(&database)
                .await
                .unwrap();
        let organizer = repository
            .get_organizer(&TaxYearInput {
                year: 2026,
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        assert_eq!(flag_status, "resolved");
        assert_eq!(organizer.candidate_count, 0);
        assert_eq!(organizer.candidate_expense_minor, 0);
    }
}
