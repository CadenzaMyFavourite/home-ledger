use crate::domain::templates::{SaveTransactionTemplateInput, TransactionTemplateRecord};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct TemplateRepository {
    database: SqlitePool,
}

impl TemplateRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list_transaction_templates(
        &self,
        include_inactive: bool,
    ) -> Result<Vec<TransactionTemplateRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, template_json, usage_count, last_used_at, is_active, created_at, updated_at
             FROM saved_templates
             WHERE template_type = 'transaction' AND (? = 1 OR is_active = 1)
             ORDER BY is_active DESC, usage_count DESC, COALESCE(last_used_at, created_at) DESC, name COLLATE NOCASE",
        )
        .bind(include_inactive)
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_template).collect()
    }

    pub async fn save_transaction_template(
        &self,
        input: &SaveTransactionTemplateInput,
    ) -> Result<TransactionTemplateRecord, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let template_json = serde_json::to_string(&input.data)?;
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM saved_templates
                WHERE template_type = 'transaction' AND name = ? COLLATE NOCASE AND id <> ?
             )",
        )
        .bind(input.name.trim())
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("已经存在同名交易模板"));
        }

        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE saved_templates
                 SET name = ?, schema_version = 1, template_json = ?, is_active = ?, updated_at = ?
                 WHERE id = ? AND template_type = 'transaction'",
            )
            .bind(input.name.trim())
            .bind(&template_json)
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found(
                    "transaction_template",
                    "交易模板不存在",
                ));
            }
        } else {
            sqlx::query(
                "INSERT INTO saved_templates(
                    id, name, template_type, schema_version, template_json, usage_count,
                    is_active, created_at, updated_at
                 ) VALUES (?, ?, 'transaction', 1, ?, 0, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(&template_json)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_template_audit(
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
        self.get_transaction_template(&id).await
    }

    pub async fn use_transaction_template(
        &self,
        id: &str,
    ) -> Result<TransactionTemplateRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE saved_templates
             SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ?
             WHERE id = ? AND template_type = 'transaction' AND is_active = 1",
        )
        .bind(&now)
        .bind(&now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::not_found(
                "transaction_template",
                "交易模板不存在或已停用",
            ));
        }
        insert_template_audit(&mut transaction, "use", id, &now).await?;
        transaction.commit().await?;
        self.get_transaction_template(id).await
    }

    async fn get_transaction_template(
        &self,
        id: &str,
    ) -> Result<TransactionTemplateRecord, AppError> {
        let row = sqlx::query(
            "SELECT id, name, template_json, usage_count, last_used_at, is_active, created_at, updated_at
             FROM saved_templates WHERE id = ? AND template_type = 'transaction'",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("transaction_template", "交易模板不存在"))?;
        map_template(&row)
    }
}

fn map_template(row: &sqlx::sqlite::SqliteRow) -> Result<TransactionTemplateRecord, AppError> {
    let template_json: String = row.get("template_json");
    Ok(TransactionTemplateRecord {
        id: row.get("id"),
        name: row.get("name"),
        data: serde_json::from_str(&template_json)?,
        usage_count: row.get("usage_count"),
        last_used_at: row.get("last_used_at"),
        is_active: row.get::<i64, _>("is_active") == 1,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn insert_template_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    template_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, 'transaction_template', ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(template_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
