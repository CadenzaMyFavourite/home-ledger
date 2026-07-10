use crate::domain::filters::{SaveTransactionFilterInput, TransactionSavedFilterRecord};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct FilterRepository {
    database: SqlitePool,
}

impl FilterRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list_transaction_filters(
        &self,
    ) -> Result<Vec<TransactionSavedFilterRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, filter_json, is_pinned, created_at, updated_at
             FROM saved_filters WHERE scope = 'transactions'
             ORDER BY is_pinned DESC, updated_at DESC, name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_filter).collect()
    }

    pub async fn save_transaction_filter(
        &self,
        input: &SaveTransactionFilterInput,
    ) -> Result<TransactionSavedFilterRecord, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let filter_json = serde_json::to_string(&input.data)?;
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM saved_filters
                WHERE scope = 'transactions' AND name = ? COLLATE NOCASE AND id <> ?
             )",
        )
        .bind(input.name.trim())
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("已经存在同名筛选"));
        }

        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE saved_filters
                 SET name = ?, schema_version = 1, filter_json = ?, is_pinned = ?, updated_at = ?
                 WHERE id = ? AND scope = 'transactions'",
            )
            .bind(input.name.trim())
            .bind(&filter_json)
            .bind(input.is_pinned)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found("transaction_filter", "筛选不存在"));
            }
        } else {
            sqlx::query(
                "INSERT INTO saved_filters(
                    id, name, scope, schema_version, filter_json, is_pinned, created_at, updated_at
                 ) VALUES (?, ?, 'transactions', 1, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(&filter_json)
            .bind(input.is_pinned)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_filter_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_transaction_filter(&id).await
    }

    pub async fn delete_transaction_filter(&self, id: &str) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result =
            sqlx::query("DELETE FROM saved_filters WHERE id = ? AND scope = 'transactions'")
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::not_found("transaction_filter", "筛选不存在"));
        }
        insert_filter_audit(&mut transaction, "delete", id, &now).await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn get_transaction_filter(
        &self,
        id: &str,
    ) -> Result<TransactionSavedFilterRecord, AppError> {
        let row = sqlx::query(
            "SELECT id, name, filter_json, is_pinned, created_at, updated_at
             FROM saved_filters WHERE id = ? AND scope = 'transactions'",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("transaction_filter", "筛选不存在"))?;
        map_filter(&row)
    }
}

fn map_filter(row: &sqlx::sqlite::SqliteRow) -> Result<TransactionSavedFilterRecord, AppError> {
    let filter_json: String = row.get("filter_json");
    Ok(TransactionSavedFilterRecord {
        id: row.get("id"),
        name: row.get("name"),
        data: serde_json::from_str(&filter_json)?,
        is_pinned: row.get::<i64, _>("is_pinned") == 1,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn insert_filter_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    filter_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, 'transaction_filter', ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(filter_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::filters::TransactionSavedFilterData;
    use crate::domain::transactions::{TransactionStatus, TransactionType};
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn transaction_filters_round_trip_as_structured_json() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("filters.sqlite3"))
            .await
            .expect("database");
        let repository = FilterRepository::new(database);
        let saved = repository
            .save_transaction_filter(&SaveTransactionFilterInput {
                id: None,
                name: "Medical expenses".into(),
                data: TransactionSavedFilterData {
                    search: "Clinic".into(),
                    transaction_type: Some(TransactionType::Expense),
                    status: Some(TransactionStatus::Completed),
                    date_from: Some("2026-01-01".into()),
                    date_to: Some("2026-12-31".into()),
                    amount_min_minor: Some(10_000),
                    amount_max_minor: None,
                    category_id: Some("medical".into()),
                    payment_method_id: None,
                    household_member_id: None,
                    location_id: None,
                    sort_by: "amount".into(),
                    sort_direction: "desc".into(),
                },
                is_pinned: true,
            })
            .await
            .expect("save filter");

        let listed = repository
            .list_transaction_filters()
            .await
            .expect("list filters");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);
        assert!(listed[0].is_pinned);
        assert_eq!(listed[0].data.amount_min_minor, Some(10_000));

        repository
            .delete_transaction_filter(&saved.id)
            .await
            .expect("delete filter");
        assert!(
            repository
                .list_transaction_filters()
                .await
                .unwrap()
                .is_empty()
        );
    }
}
