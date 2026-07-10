use crate::domain::daily_summary::{DailyFinancialSummary, DailyFinancialSummaryInput};
use crate::error::AppError;
use sqlx::{Row, SqlitePool};

pub struct DailySummaryRepository {
    database: SqlitePool,
}

impl DailySummaryRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list(
        &self,
        input: &DailyFinancialSummaryInput,
    ) -> Result<Vec<DailyFinancialSummary>, AppError> {
        input.validate()?;
        let rows = sqlx::query(
            "SELECT transaction_date AS summary_date,
                    reporting_currency_code,
                    SUM(CASE WHEN transaction_type = 'income' THEN reporting_amount_minor ELSE 0 END) AS income_minor,
                    SUM(CASE WHEN transaction_type = 'expense' THEN reporting_amount_minor ELSE 0 END) AS expense_minor,
                    0 AS planned_count, 0 AS pending_count
             FROM transactions
             WHERE deleted_at IS NULL AND status = 'completed'
               AND transaction_type IN ('income', 'expense')
               AND transaction_date >= ? AND transaction_date < ?
             GROUP BY transaction_date, reporting_currency_code
             UNION ALL
             SELECT transaction_date AS summary_date, NULL AS reporting_currency_code,
                    0 AS income_minor, 0 AS expense_minor,
                    SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) AS planned_count,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
             FROM transactions
             WHERE deleted_at IS NULL AND status IN ('planned', 'pending')
               AND transaction_type IN ('income', 'expense')
               AND transaction_date >= ? AND transaction_date < ?
             GROUP BY transaction_date
             ORDER BY summary_date, reporting_currency_code",
        )
        .bind(&input.range_start_date)
        .bind(&input.range_end_date_exclusive)
        .bind(&input.range_start_date)
        .bind(&input.range_end_date_exclusive)
        .fetch_all(&self.database)
        .await?;
        Ok(rows
            .iter()
            .map(|row| DailyFinancialSummary {
                summary_date: row.get("summary_date"),
                reporting_currency_code: row.get("reporting_currency_code"),
                income_minor: row.get("income_minor"),
                expense_minor: row.get("expense_minor"),
                planned_count: row.get("planned_count"),
                pending_count: row.get("pending_count"),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn actual_totals_and_planned_counts_are_separate() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("daily.sqlite3"))
            .await
            .unwrap();
        for (id, transaction_type, status, amount, reporting) in [
            ("income", "income", "completed", 300_000, Some(300_000)),
            ("expense", "expense", "completed", 12_500, Some(12_500)),
            ("rent", "expense", "planned", 200_000, None),
            ("cancelled", "expense", "cancelled", 99_000, None),
        ] {
            sqlx::query(
                "INSERT INTO transactions(
                    id, transaction_date, transaction_type, status, amount_minor, currency_code,
                    reporting_amount_minor, reporting_currency_code, payment_method_id,
                    origin, version, created_at, updated_at
                 ) VALUES (?, '2026-07-12', ?, ?, ?, 'CAD', ?, ?,
                           '20000000-0000-7000-8000-000000000001', 'manual', 1,
                           '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')",
            )
            .bind(id)
            .bind(transaction_type)
            .bind(status)
            .bind(amount)
            .bind(reporting)
            .bind(reporting.map(|_| "CAD"))
            .execute(&database)
            .await
            .unwrap();
        }
        let summaries = DailySummaryRepository::new(database)
            .list(&DailyFinancialSummaryInput {
                range_start_date: "2026-07-01".into(),
                range_end_date_exclusive: "2026-08-01".into(),
            })
            .await
            .unwrap();
        let actual = summaries
            .iter()
            .find(|item| item.reporting_currency_code.as_deref() == Some("CAD"))
            .unwrap();
        assert_eq!(
            (actual.income_minor, actual.expense_minor),
            (300_000, 12_500)
        );
        let planned = summaries
            .iter()
            .find(|item| item.reporting_currency_code.is_none())
            .unwrap();
        assert_eq!((planned.planned_count, planned.pending_count), (1, 0));
    }
}
