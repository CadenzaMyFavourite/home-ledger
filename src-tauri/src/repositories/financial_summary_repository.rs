use crate::domain::financial_summary::{
    DailyFinancialPoint, FinancialReviewCandidate, FinancialSummary, FinancialSummaryInput,
    LargestExpense, NamedFinancialTotal, ReportExportTransaction, ReportNoteQueryInput,
    ReportNoteRecord, ReviewCandidateActionInput, SaveReportNoteInput,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct FinancialSummaryRepository {
    database: SqlitePool,
}

impl FinancialSummaryRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn get(&self, input: &FinancialSummaryInput) -> Result<FinancialSummary, AppError> {
        input.validate()?;
        let totals = sqlx::query(
            "SELECT
                COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN reporting_amount_minor ELSE 0 END), 0) AS income_minor,
                COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN reporting_amount_minor ELSE 0 END), 0) AS expense_minor,
                COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND origin = 'recurring' THEN reporting_amount_minor ELSE 0 END), 0) AS fixed_expense_minor,
                COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND origin <> 'recurring' THEN reporting_amount_minor ELSE 0 END), 0) AS variable_expense_minor,
                COUNT(*) AS actual_transaction_count
             FROM v_actual_transactions
             WHERE transaction_date >= ? AND transaction_date < ?
               AND reporting_currency_code = ?",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_one(&self.database)
        .await?;
        let excluded_currency_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM v_actual_transactions
             WHERE transaction_date >= ? AND transaction_date < ?
               AND reporting_currency_code <> ?",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_one(&self.database)
        .await?;

        let daily_rows = sqlx::query(
            "SELECT transaction_date AS summary_date,
                    SUM(CASE WHEN transaction_type = 'income' THEN reporting_amount_minor ELSE 0 END) AS income_minor,
                    SUM(CASE WHEN transaction_type = 'expense' THEN reporting_amount_minor ELSE 0 END) AS expense_minor
             FROM v_actual_transactions
             WHERE transaction_date >= ? AND transaction_date < ? AND reporting_currency_code = ?
             GROUP BY transaction_date ORDER BY transaction_date",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        let category_rows = sqlx::query(
            "SELECT COALESCE(parent.id, c.id, 'uncategorized') AS id,
                    COALESCE(parent.name, c.name, '未分类') AS name,
                    SUM(t.reporting_amount_minor) AS amount_minor
             FROM v_actual_transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN categories parent ON parent.id = c.parent_id
             WHERE t.transaction_type = 'expense'
               AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
             GROUP BY COALESCE(parent.id, c.id, 'uncategorized'), COALESCE(parent.name, c.name, '未分类')
             ORDER BY amount_minor DESC, name COLLATE NOCASE",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        let payment_rows = named_totals(
            &self.database,
            "payment_methods",
            "payment_method_id",
            "display_name",
            "未设置支付方式",
            input,
        )
        .await?;
        let member_rows = named_totals(
            &self.database,
            "household_members",
            "household_member_id",
            "display_name",
            "未设置成员",
            input,
        )
        .await?;
        let largest = sqlx::query(
            "SELECT t.id, t.transaction_date, t.merchant, t.reporting_amount_minor,
                    COALESCE(parent.name, c.name) AS category_name
             FROM v_actual_transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN categories parent ON parent.id = c.parent_id
             WHERE t.transaction_type = 'expense'
               AND t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
             ORDER BY t.reporting_amount_minor DESC, t.transaction_date DESC, t.id
             LIMIT 1",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_optional(&self.database)
        .await?;
        let review_rows = sqlx::query(
            "WITH period_actual AS (
                SELECT * FROM v_actual_transactions
                WHERE transaction_date >= ? AND transaction_date < ?
                  AND reporting_currency_code = ?
             ), candidates AS (
                SELECT t.id AS transaction_id, t.transaction_date, t.merchant,
                       t.reporting_amount_minor AS amount_minor,
                       rf.flag_type, rf.severity, NULL AS related_transaction_id
                FROM period_actual t
                JOIN review_flags rf ON rf.transaction_id = t.id AND rf.status = 'open'
                UNION ALL
                SELECT t.id, t.transaction_date, t.merchant, t.reporting_amount_minor,
                       'uncategorized', 'warning', NULL
                FROM period_actual t
                WHERE t.transaction_type = 'expense' AND t.category_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                      AND rf.flag_type = 'uncategorized'
                  )
                UNION ALL
                SELECT t.id, t.transaction_date, t.merchant, t.reporting_amount_minor,
                       'unusually_high', 'warning', NULL
                FROM period_actual t
                WHERE t.transaction_type = 'expense' AND t.reporting_amount_minor >= 100000
                  AND NOT EXISTS (
                    SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                      AND rf.flag_type = 'unusually_high'
                  )
                UNION ALL
                SELECT t.id, t.transaction_date, t.merchant, t.reporting_amount_minor,
                       'missing_attachment', 'warning', NULL
                FROM period_actual t
                WHERE t.transaction_type = 'expense' AND t.reporting_amount_minor >= 50000
                  AND NOT EXISTS (
                    SELECT 1 FROM transaction_attachments ta
                    JOIN attachments a ON a.id = ta.attachment_id AND a.deleted_at IS NULL
                    WHERE ta.transaction_id = t.id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                      AND rf.flag_type = 'missing_attachment'
                  )
                UNION ALL
                SELECT t.id, t.transaction_date, t.merchant, t.reporting_amount_minor,
                       'possible_duplicate', 'warning',
                       (SELECT MIN(other.id) FROM period_actual other
                        WHERE other.id <> t.id
                          AND other.transaction_date = t.transaction_date
                          AND other.transaction_type = t.transaction_type
                          AND other.reporting_amount_minor = t.reporting_amount_minor
                          AND other.reporting_currency_code = t.reporting_currency_code
                          AND other.payment_method_id IS t.payment_method_id
                          AND lower(trim(COALESCE(other.merchant, ''))) = lower(trim(COALESCE(t.merchant, '')))
                       )
                FROM period_actual t
                WHERE t.id <> (
                    SELECT MIN(other.id) FROM period_actual other
                    WHERE other.transaction_date = t.transaction_date
                      AND other.transaction_type = t.transaction_type
                      AND other.reporting_amount_minor = t.reporting_amount_minor
                      AND other.reporting_currency_code = t.reporting_currency_code
                      AND other.payment_method_id IS t.payment_method_id
                      AND lower(trim(COALESCE(other.merchant, ''))) = lower(trim(COALESCE(t.merchant, '')))
                )
                  AND NOT EXISTS (
                    SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                      AND rf.flag_type = 'possible_duplicate'
                  )
             )
             SELECT transaction_id, transaction_date, merchant, amount_minor,
                    flag_type, severity, related_transaction_id
             FROM candidates
             ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                      transaction_date DESC, amount_minor DESC, transaction_id, flag_type",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;

        let income_minor: i64 = totals.get("income_minor");
        let expense_minor: i64 = totals.get("expense_minor");
        Ok(FinancialSummary {
            period_start_date: input.period_start_date.clone(),
            period_end_date_exclusive: input.period_end_date_exclusive.clone(),
            reporting_currency_code: input.reporting_currency_code.clone(),
            income_minor,
            expense_minor,
            fixed_expense_minor: totals.get("fixed_expense_minor"),
            variable_expense_minor: totals.get("variable_expense_minor"),
            net_minor: income_minor - expense_minor,
            actual_transaction_count: totals.get("actual_transaction_count"),
            excluded_currency_count,
            daily_trend: daily_rows
                .iter()
                .map(|row| DailyFinancialPoint {
                    summary_date: row.get("summary_date"),
                    income_minor: row.get("income_minor"),
                    expense_minor: row.get("expense_minor"),
                })
                .collect(),
            category_totals: map_named(category_rows),
            payment_method_totals: map_named(payment_rows),
            household_member_totals: map_named(member_rows),
            largest_expense: largest.map(|row| LargestExpense {
                transaction_id: row.get("id"),
                transaction_date: row.get("transaction_date"),
                merchant: row.get("merchant"),
                amount_minor: row.get("reporting_amount_minor"),
                category_name: row.get("category_name"),
            }),
            review_candidates: review_rows
                .iter()
                .map(|row| FinancialReviewCandidate {
                    transaction_id: row.get("transaction_id"),
                    transaction_date: row.get("transaction_date"),
                    merchant: row.get("merchant"),
                    amount_minor: row.get("amount_minor"),
                    flag_type: row.get("flag_type"),
                    severity: row.get("severity"),
                    related_transaction_id: row.get("related_transaction_id"),
                })
                .collect(),
        })
    }

    pub async fn set_review_status(
        &self,
        input: &ReviewCandidateActionInput,
    ) -> Result<ReviewCandidateActionInput, AppError> {
        input.validate()?;
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&input.transaction_id)
        .fetch_one(&self.database)
        .await?;
        if exists == 0 {
            return Err(AppError::not_found("transaction", "交易记录不存在"));
        }
        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            "UPDATE review_flags
             SET status = ?, resolved_at = ?, updated_at = ?
             WHERE transaction_id = ? AND flag_type = ?",
        )
        .bind(&input.status)
        .bind(&now)
        .bind(&now)
        .bind(&input.transaction_id)
        .bind(&input.flag_type)
        .execute(&self.database)
        .await?;
        if updated.rows_affected() == 0 {
            let severity = if input.flag_type == "possible_tax_candidate" {
                "info"
            } else {
                "warning"
            };
            sqlx::query(
                "INSERT INTO review_flags(
                    id, transaction_id, flag_type, severity, detector_version,
                    details_json, status, resolved_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 1, '{\"source\":\"deterministic_report_review\"}', ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&input.transaction_id)
            .bind(&input.flag_type)
            .bind(severity)
            .bind(&input.status)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .execute(&self.database)
            .await?;
        }
        Ok(input.clone())
    }

    pub async fn get_report_note(
        &self,
        input: &ReportNoteQueryInput,
    ) -> Result<Option<ReportNoteRecord>, AppError> {
        input.validate()?;
        let row = sqlx::query(
            "SELECT id, report_type, period_start, period_end_exclusive,
                    note, version, created_at, updated_at
             FROM report_notes
             WHERE report_type = ? AND period_start = ? AND period_end_exclusive = ?",
        )
        .bind(&input.report_type)
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_report_note))
    }

    pub async fn save_report_note(
        &self,
        input: &SaveReportNoteInput,
    ) -> Result<ReportNoteRecord, AppError> {
        input.validate()?;
        let mut transaction = self.database.begin().await?;
        let existing = sqlx::query(
            "SELECT id, report_type, period_start, period_end_exclusive,
                    note, version, created_at, updated_at
             FROM report_notes
             WHERE report_type = ? AND period_start = ? AND period_end_exclusive = ?",
        )
        .bind(&input.report_type)
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .fetch_optional(&mut *transaction)
        .await?;
        let now = Utc::now().to_rfc3339();
        let (id, before_json) = if let Some(row) = existing.as_ref() {
            let current = map_report_note(row);
            if input.expected_version != Some(current.version) {
                return Err(AppError::conflict(
                    "报告说明已在其他窗口修改，请重新载入后再保存",
                ));
            }
            sqlx::query(
                "UPDATE report_notes
                 SET note = ?, version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ?",
            )
            .bind(&input.note)
            .bind(&now)
            .bind(&current.id)
            .bind(current.version)
            .execute(&mut *transaction)
            .await?;
            (
                current.id,
                Some(
                    serde_json::json!({"note": current.note, "version": current.version})
                        .to_string(),
                ),
            )
        } else {
            if input.expected_version.is_some() {
                return Err(AppError::conflict("报告说明不存在，请重新载入后再保存"));
            }
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO report_notes(
                    id, report_type, period_start, period_end_exclusive,
                    note, version, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            )
            .bind(&id)
            .bind(&input.report_type)
            .bind(&input.period_start_date)
            .bind(&input.period_end_date_exclusive)
            .bind(&input.note)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            (id, None)
        };
        let saved_row = sqlx::query(
            "SELECT id, report_type, period_start, period_end_exclusive,
                    note, version, created_at, updated_at
             FROM report_notes WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        let saved = map_report_note(&saved_row);
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id,
                before_json, after_json
             ) VALUES (?, ?, 'user', 'save_report_note', 'report_note', ?, ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&id)
        .bind(before_json)
        .bind(serde_json::json!({"note": &saved.note, "version": saved.version}).to_string())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(saved)
    }

    pub async fn list_export_transactions(
        &self,
        input: &FinancialSummaryInput,
    ) -> Result<Vec<ReportExportTransaction>, AppError> {
        input.validate()?;
        let rows = sqlx::query(
            "SELECT t.transaction_date, t.transaction_type, t.amount_minor, t.currency_code,
                    t.reporting_amount_minor, t.reporting_currency_code,
                    COALESCE(parent.name, c.name) AS category_name,
                    pm.display_name AS payment_method_name,
                    hm.display_name AS household_member_name,
                    t.merchant, t.note, t.origin = 'recurring' AS is_fixed
             FROM v_actual_transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN categories parent ON parent.id = c.parent_id
             LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
             LEFT JOIN household_members hm ON hm.id = t.household_member_id
             WHERE t.transaction_date >= ? AND t.transaction_date < ?
               AND t.reporting_currency_code = ?
             ORDER BY t.transaction_date, t.created_at, t.id",
        )
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_all(&self.database)
        .await?;
        Ok(rows
            .iter()
            .map(|row| ReportExportTransaction {
                transaction_date: row.get("transaction_date"),
                transaction_type: row.get("transaction_type"),
                amount_minor: row.get("amount_minor"),
                currency_code: row.get("currency_code"),
                reporting_amount_minor: row.get("reporting_amount_minor"),
                reporting_currency_code: row.get("reporting_currency_code"),
                category_name: row.get("category_name"),
                payment_method_name: row.get("payment_method_name"),
                household_member_name: row.get("household_member_name"),
                merchant: row.get("merchant"),
                note: row.get("note"),
                is_fixed: row.get("is_fixed"),
            })
            .collect())
    }
}

fn map_report_note(row: &sqlx::sqlite::SqliteRow) -> ReportNoteRecord {
    ReportNoteRecord {
        id: row.get("id"),
        report_type: row.get("report_type"),
        period_start_date: row.get("period_start"),
        period_end_date_exclusive: row.get("period_end_exclusive"),
        note: row.get("note"),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

async fn named_totals(
    database: &SqlitePool,
    table: &str,
    foreign_key: &str,
    name_column: &str,
    fallback: &str,
    input: &FinancialSummaryInput,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, AppError> {
    let sql = format!(
        "SELECT COALESCE(d.id, 'unassigned') AS id,
                COALESCE(d.{name_column}, '{fallback}') AS name,
                SUM(t.reporting_amount_minor) AS amount_minor
         FROM v_actual_transactions t
         LEFT JOIN {table} d ON d.id = t.{foreign_key}
         WHERE t.transaction_type = 'expense'
           AND t.transaction_date >= ? AND t.transaction_date < ?
           AND t.reporting_currency_code = ?
         GROUP BY COALESCE(d.id, 'unassigned'), COALESCE(d.{name_column}, '{fallback}')
         ORDER BY amount_minor DESC, name COLLATE NOCASE"
    );
    Ok(sqlx::query(&sql)
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .bind(&input.reporting_currency_code)
        .fetch_all(database)
        .await?)
}

fn map_named(rows: Vec<sqlx::sqlite::SqliteRow>) -> Vec<NamedFinancialTotal> {
    rows.iter()
        .map(|row| NamedFinancialTotal {
            id: row.get("id"),
            name: row.get("name"),
            amount_minor: row.get("amount_minor"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn summary_uses_only_completed_actuals_and_saved_reporting_currency() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("summary.sqlite3"))
            .await
            .unwrap();
        for (id, date, kind, status, amount, currency, reporting, category) in [
            (
                "income",
                "2026-07-01",
                "income",
                "completed",
                300_000,
                "CAD",
                Some((300_000, "CAD")),
                Some("10000000-0000-7000-8000-000000000301"),
            ),
            (
                "food",
                "2026-07-02",
                "expense",
                "completed",
                12_500,
                "CAD",
                Some((12_500, "CAD")),
                Some("10000000-0000-7000-8000-000000000101"),
            ),
            (
                "rent",
                "2026-07-03",
                "expense",
                "completed",
                20_000,
                "CAD",
                Some((20_000, "CAD")),
                Some("10000000-0000-7000-8000-000000000201"),
            ),
            (
                "food-duplicate",
                "2026-07-02",
                "expense",
                "completed",
                12_500,
                "CAD",
                Some((12_500, "CAD")),
                Some("10000000-0000-7000-8000-000000000101"),
            ),
            (
                "large-uncategorized",
                "2026-07-06",
                "expense",
                "completed",
                150_000,
                "CAD",
                Some((150_000, "CAD")),
                None,
            ),
            (
                "planned",
                "2026-07-04",
                "expense",
                "planned",
                200_000,
                "CAD",
                None,
                Some("10000000-0000-7000-8000-000000000201"),
            ),
            (
                "usd",
                "2026-07-05",
                "expense",
                "completed",
                5_000,
                "USD",
                Some((5_000, "USD")),
                Some("10000000-0000-7000-8000-000000000008"),
            ),
            (
                "august",
                "2026-08-01",
                "expense",
                "completed",
                10_000,
                "CAD",
                Some((10_000, "CAD")),
                Some("10000000-0000-7000-8000-000000000001"),
            ),
        ] {
            sqlx::query(
                "INSERT INTO transactions(
                    id, transaction_date, transaction_type, status, amount_minor, currency_code,
                    reporting_amount_minor, reporting_currency_code, category_id, payment_method_id,
                    household_member_id, merchant, origin, version, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                    '20000000-0000-7000-8000-000000000001',
                    '00000000-0000-7000-8000-000000000001', ?, ?, 1,
                    '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')",
            )
            .bind(id)
            .bind(date)
            .bind(kind)
            .bind(status)
            .bind(amount)
            .bind(currency)
            .bind(reporting.map(|value| value.0))
            .bind(reporting.map(|value| value.1))
            .bind(category)
            .bind(if id == "food-duplicate" { "food" } else { id })
            .bind(if id == "rent" { "recurring" } else { "manual" })
            .execute(&database)
            .await
            .unwrap();
        }

        let repository = FinancialSummaryRepository::new(database);
        let july = repository
            .get(&FinancialSummaryInput {
                period_start_date: "2026-07-01".into(),
                period_end_date_exclusive: "2026-08-01".into(),
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        assert_eq!(
            (july.income_minor, july.expense_minor, july.net_minor),
            (300_000, 195_000, 105_000)
        );
        assert_eq!(
            (july.fixed_expense_minor, july.variable_expense_minor),
            (20_000, 175_000)
        );
        assert_eq!(
            (july.actual_transaction_count, july.excluded_currency_count),
            (5, 1)
        );
        assert!(
            july.category_totals
                .iter()
                .any(|total| total.name == "住房")
        );
        assert_eq!(
            july.largest_expense.as_ref().unwrap().transaction_id,
            "large-uncategorized"
        );
        let flags: std::collections::HashSet<_> = july
            .review_candidates
            .iter()
            .map(|candidate| candidate.flag_type.as_str())
            .collect();
        assert!(flags.contains("possible_duplicate"));
        assert!(flags.contains("unusually_high"));
        assert!(flags.contains("missing_attachment"));
        assert!(flags.contains("uncategorized"));

        repository
            .set_review_status(&ReviewCandidateActionInput {
                transaction_id: "large-uncategorized".into(),
                flag_type: "unusually_high".into(),
                status: "dismissed".into(),
            })
            .await
            .unwrap();
        let reviewed = repository
            .get(&FinancialSummaryInput {
                period_start_date: "2026-07-01".into(),
                period_end_date_exclusive: "2026-08-01".into(),
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        assert!(!reviewed.review_candidates.iter().any(|candidate| {
            candidate.transaction_id == "large-uncategorized"
                && candidate.flag_type == "unusually_high"
        }));

        let note_query = ReportNoteQueryInput {
            report_type: "monthly".into(),
            period_start_date: "2026-07-01".into(),
            period_end_date_exclusive: "2026-08-01".into(),
        };
        assert!(
            repository
                .get_report_note(&note_query)
                .await
                .unwrap()
                .is_none()
        );
        let first_note = repository
            .save_report_note(&SaveReportNoteInput {
                report_type: note_query.report_type.clone(),
                period_start_date: note_query.period_start_date.clone(),
                period_end_date_exclusive: note_query.period_end_date_exclusive.clone(),
                note: "家庭旅行增加了本月支出。".into(),
                expected_version: None,
            })
            .await
            .unwrap();
        assert_eq!(first_note.version, 1);
        let second_note = repository
            .save_report_note(&SaveReportNoteInput {
                report_type: note_query.report_type.clone(),
                period_start_date: note_query.period_start_date.clone(),
                period_end_date_exclusive: note_query.period_end_date_exclusive.clone(),
                note: "用户修订后的说明。".into(),
                expected_version: Some(first_note.version),
            })
            .await
            .unwrap();
        assert_eq!(
            (second_note.version, second_note.note.as_str()),
            (2, "用户修订后的说明。")
        );

        for export_format in ["csv", "xlsx"] {
            let destination = directory
                .path()
                .join(format!("july-report.{export_format}"));
            let result = crate::application::report_export::export_report(
                &repository,
                &crate::domain::financial_summary::ExportFinancialReportInput {
                    report_type: "monthly".into(),
                    period_start_date: "2026-07-01".into(),
                    period_end_date_exclusive: "2026-08-01".into(),
                    reporting_currency_code: "CAD".into(),
                    export_format: export_format.into(),
                    destination_path: destination.to_string_lossy().into_owned(),
                },
            )
            .await
            .unwrap();
            assert_eq!(result.record_count, 5);
            let bytes = std::fs::read(&destination).unwrap();
            assert_eq!(bytes.len(), result.byte_count);
            if export_format == "csv" {
                let csv = String::from_utf8(bytes).unwrap();
                assert!(csv.contains("\"150000\""));
                assert!(csv.contains("\"fixed\""));
            } else {
                assert!(bytes.starts_with(b"PK"));
                assert!(bytes.len() > 5_000);
                if let Ok(qa_path) = std::env::var("HOMELEDGER_EXPORT_QA_PATH") {
                    std::fs::write(qa_path, &bytes).unwrap();
                }
            }
        }

        let august = repository
            .get(&FinancialSummaryInput {
                period_start_date: "2026-08-01".into(),
                period_end_date_exclusive: "2026-09-01".into(),
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        let year = repository
            .get(&FinancialSummaryInput {
                period_start_date: "2026-01-01".into(),
                period_end_date_exclusive: "2027-01-01".into(),
                reporting_currency_code: "CAD".into(),
            })
            .await
            .unwrap();
        assert_eq!(
            year.expense_minor,
            july.expense_minor + august.expense_minor
        );
    }
}
