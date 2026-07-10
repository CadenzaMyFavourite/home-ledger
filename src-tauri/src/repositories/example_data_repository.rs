use crate::domain::example_data::ExampleDataStatus;
use crate::error::AppError;
use chrono::{Datelike, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

const EXAMPLE_MAPPING: &str = r#"{"kind":"home_ledger_example_data","version":1}"#;
const DEFAULT_MEMBER_ID: &str = "00000000-0000-7000-8000-000000000001";
const CASH_METHOD_ID: &str = "20000000-0000-7000-8000-000000000001";

pub struct ExampleDataRepository {
    database: SqlitePool,
}

struct Fixture {
    month_offset: i32,
    day: u32,
    transaction_type: &'static str,
    status: &'static str,
    amount_minor: i64,
    currency_code: &'static str,
    reporting_amount_minor: Option<i64>,
    category_id: &'static str,
    merchant: &'static str,
    note: &'static str,
    possible_tax_hint: bool,
    anomaly_hint: bool,
}

impl ExampleDataRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn status(&self) -> Result<ExampleDataStatus, AppError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions t
             JOIN import_batches b ON b.id = t.import_batch_id
             WHERE b.mapping_json = ? AND b.status = 'completed' AND t.deleted_at IS NULL",
        )
        .bind(EXAMPLE_MAPPING)
        .fetch_one(&self.database)
        .await?;
        Ok(ExampleDataStatus {
            loaded: count > 0,
            transaction_count: count,
        })
    }

    pub async fn load(&self) -> Result<ExampleDataStatus, AppError> {
        if self.status().await?.loaded {
            return Err(AppError::conflict("示例数据已经加载"));
        }
        let now = Utc::now();
        let created_at = now.to_rfc3339();
        let batch_id = Uuid::now_v7().to_string();
        let fixtures = example_fixtures();
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "UPDATE import_batches SET status = 'undone', undone_at = ?
             WHERE mapping_json = ? AND status = 'completed'",
        )
        .bind(&created_at)
        .bind(EXAMPLE_MAPPING)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO import_batches(
                id, source_filename, source_sha256, parser_version, mapping_schema_version,
                mapping_json, status, total_rows, success_rows, failed_rows,
                created_at, committed_at
             ) VALUES (?, 'HomeLedger example data', ?, 1, 1, ?, 'completed', ?, ?, 0, ?, ?)",
        )
        .bind(&batch_id)
        .bind("0".repeat(64))
        .bind(EXAMPLE_MAPPING)
        .bind(fixtures.len() as i64)
        .bind(fixtures.len() as i64)
        .bind(&created_at)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await?;

        for fixture in fixtures {
            let id = Uuid::now_v7().to_string();
            let date = shifted_date(now.year(), now.month(), fixture.month_offset, fixture.day);
            sqlx::query(
                "INSERT INTO transactions(
                    id, transaction_date, transaction_type, status, amount_minor, currency_code,
                    reporting_amount_minor, reporting_currency_code, fx_rate_numerator, fx_rate_denominator,
                    category_id, payment_method_id, household_member_id, merchant, note, origin,
                    import_batch_id, version, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, 1, ?, ?)",
            )
            .bind(&id)
            .bind(date)
            .bind(fixture.transaction_type)
            .bind(fixture.status)
            .bind(fixture.amount_minor)
            .bind(fixture.currency_code)
            .bind(fixture.reporting_amount_minor)
            .bind(fixture.reporting_amount_minor.map(|_| "CAD"))
            .bind((fixture.currency_code == "USD").then_some(136_i64))
            .bind((fixture.currency_code == "USD").then_some(100_i64))
            .bind(fixture.category_id)
            .bind(CASH_METHOD_ID)
            .bind(DEFAULT_MEMBER_ID)
            .bind(fixture.merchant)
            .bind(fixture.note)
            .bind(&batch_id)
            .bind(&created_at)
            .bind(&created_at)
            .execute(&mut *transaction)
            .await?;
            for flag_type in [
                fixture
                    .possible_tax_hint
                    .then_some("possible_tax_candidate"),
                fixture.anomaly_hint.then_some("unusually_high"),
            ]
            .into_iter()
            .flatten()
            {
                sqlx::query(
                    "INSERT INTO review_flags(
                        id, transaction_id, flag_type, severity, detector_version,
                        details_json, status, created_at, updated_at
                     ) VALUES (?, ?, ?, 'warning', 1, '{\"source\":\"example_data\"}', 'open', ?, ?)",
                )
                .bind(Uuid::now_v7().to_string())
                .bind(&id)
                .bind(flag_type)
                .bind(&created_at)
                .bind(&created_at)
                .execute(&mut *transaction)
                .await?;
            }
        }
        insert_audit(&mut transaction, "load", &batch_id, &created_at).await?;
        transaction.commit().await?;
        self.status().await
    }

    pub async fn remove(&self) -> Result<ExampleDataStatus, AppError> {
        let now = Utc::now().to_rfc3339();
        let batch_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM import_batches
             WHERE mapping_json = ? AND status = 'completed'
             ORDER BY committed_at DESC LIMIT 1",
        )
        .bind(EXAMPLE_MAPPING)
        .fetch_optional(&self.database)
        .await?;
        let batch_id = batch_id.ok_or_else(|| AppError::conflict("没有可移除的示例数据"))?;
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "UPDATE transactions SET deleted_at = ?, updated_at = ?, version = version + 1
             WHERE import_batch_id = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(&batch_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("UPDATE import_batches SET status = 'undone', undone_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&batch_id)
            .execute(&mut *transaction)
            .await?;
        insert_audit(&mut transaction, "remove", &batch_id, &now).await?;
        transaction.commit().await?;
        self.status().await
    }
}

fn shifted_date(year: i32, month: u32, offset: i32, day: u32) -> String {
    let total = year * 12 + month as i32 - 1 + offset;
    let shifted_year = total.div_euclid(12);
    let shifted_month = total.rem_euclid(12) + 1;
    format!("{shifted_year:04}-{shifted_month:02}-{day:02}")
}

fn example_fixtures() -> Vec<Fixture> {
    vec![
        Fixture {
            month_offset: 0,
            day: 1,
            transaction_type: "income",
            status: "completed",
            amount_minor: 420_000,
            currency_code: "CAD",
            reporting_amount_minor: Some(420_000),
            category_id: "10000000-0000-7000-8000-000000000301",
            merchant: "示例雇主",
            note: "月度工资示例",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: 0,
            day: 2,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 18_650,
            currency_code: "CAD",
            reporting_amount_minor: Some(18_650),
            category_id: "10000000-0000-7000-8000-000000000101",
            merchant: "Costco",
            note: "家庭食品采购",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: 0,
            day: 6,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 7_850,
            currency_code: "CAD",
            reporting_amount_minor: Some(7_850),
            category_id: "10000000-0000-7000-8000-000000000102",
            merchant: "家庭餐厅",
            note: "周末聚餐",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: 0,
            day: 10,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 12_000,
            currency_code: "CAD",
            reporting_amount_minor: Some(12_000),
            category_id: "10000000-0000-7000-8000-000000000006",
            merchant: "社区诊所",
            note: "医疗候选记录；是否符合税务条件需专业确认",
            possible_tax_hint: true,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: 0,
            day: 15,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 289_900,
            currency_code: "CAD",
            reporting_amount_minor: Some(289_900),
            category_id: "10000000-0000-7000-8000-000000000005",
            merchant: "家电商店",
            note: "异常高额示例",
            possible_tax_hint: false,
            anomaly_hint: true,
        },
        Fixture {
            month_offset: 0,
            day: 28,
            transaction_type: "expense",
            status: "planned",
            amount_minor: 210_000,
            currency_code: "CAD",
            reporting_amount_minor: None,
            category_id: "10000000-0000-7000-8000-000000000201",
            merchant: "房东",
            note: "计划房租，不计入实际支出",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: -1,
            day: 8,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 68_000,
            currency_code: "CAD",
            reporting_amount_minor: Some(68_000),
            category_id: "10000000-0000-7000-8000-000000000008",
            merchant: "Vancouver Hotel",
            note: "温哥华旅行酒店",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: -1,
            day: 9,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 25_000,
            currency_code: "USD",
            reporting_amount_minor: Some(34_000),
            category_id: "10000000-0000-7000-8000-000000000008",
            merchant: "Airline USD",
            note: "外币示例，汇率由程序保存",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: -1,
            day: 10,
            transaction_type: "expense",
            status: "completed",
            amount_minor: 9_450,
            currency_code: "CAD",
            reporting_amount_minor: Some(9_450),
            category_id: "10000000-0000-7000-8000-000000000102",
            merchant: "Vancouver Restaurant",
            note: "旅行餐饮",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
        Fixture {
            month_offset: -2,
            day: 5,
            transaction_type: "income",
            status: "completed",
            amount_minor: 35_000,
            currency_code: "CAD",
            reporting_amount_minor: Some(35_000),
            category_id: "10000000-0000-7000-8000-000000000304",
            merchant: "Insurance Refund",
            note: "退款示例",
            possible_tax_hint: false,
            anomaly_hint: false,
        },
    ]
}

async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    batch_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, 'example_data_batch', ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(batch_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn example_batch_is_idempotent_and_removal_is_scoped() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("examples.sqlite3"))
            .await
            .expect("database");
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, category_id, payment_method_id,
                household_member_id, merchant, origin, version, created_at, updated_at
             ) VALUES (
                'personal-record', '2026-07-03', 'expense', 'completed', 1234, 'CAD',
                1234, 'CAD', '10000000-0000-7000-8000-000000000101',
                '20000000-0000-7000-8000-000000000001',
                '00000000-0000-7000-8000-000000000001', 'Personal record', 'manual', 1, ?, ?
             )",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .execute(&database)
        .await
        .expect("personal record");
        let repository = ExampleDataRepository::new(database.clone());

        assert!(!repository.status().await.unwrap().loaded);
        let loaded = repository.load().await.expect("load examples");
        assert_eq!(loaded.transaction_count, 10);
        assert!(repository.load().await.is_err());
        let usd_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE import_batch_id IS NOT NULL AND currency_code = 'USD'",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        let planned_reporting_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions
             WHERE import_batch_id IS NOT NULL AND status = 'planned' AND reporting_amount_minor IS NULL",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        let tax_flag_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_flags WHERE flag_type = 'possible_tax_candidate'",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(
            (usd_count, planned_reporting_count, tax_flag_count),
            (1, 1, 1)
        );

        let removed = repository.remove().await.expect("remove examples");
        assert!(!removed.loaded);
        let personal_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE id = 'personal-record' AND deleted_at IS NULL",
        )
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(personal_count, 1);
    }
}
