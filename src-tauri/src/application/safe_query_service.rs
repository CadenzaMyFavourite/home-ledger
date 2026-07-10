use crate::domain::safe_query::{SafeQueryAllowlist, SafeQueryPlan};
use crate::domain::transactions::ListTransactionsInput;
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashSet;

#[derive(Clone)]
pub struct SafeQueryService {
    database: SqlitePool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedSafeQuery {
    pub plan: SafeQueryPlan,
    pub filters: ListTransactionsInput,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeQueryPromptContext {
    pub current_date: String,
    pub timezone_id: String,
    pub categories: Vec<SafeQueryOption>,
    pub payment_methods: Vec<SafeQueryOption>,
    pub household_members: Vec<SafeQueryOption>,
    pub locations: Vec<SafeQueryOption>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeQueryOption {
    pub id: String,
    pub name: String,
}

impl SafeQueryService {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn validate_plan(&self, plan: SafeQueryPlan) -> Result<ValidatedSafeQuery, AppError> {
        let allowlist = SafeQueryAllowlist {
            category_ids: active_ids(&self.database, "categories").await?,
            payment_method_ids: active_ids(&self.database, "payment_methods").await?,
            household_member_ids: active_ids(&self.database, "household_members").await?,
            location_ids: active_ids(&self.database, "locations").await?,
        };
        let filters = plan.clone().compile(&allowlist)?;
        Ok(ValidatedSafeQuery { plan, filters })
    }

    pub async fn prompt_context(
        &self,
        current_date: String,
        timezone_id: String,
    ) -> Result<SafeQueryPromptContext, AppError> {
        let (categories, payment_methods, household_members, locations) = tokio::try_join!(
            active_options(&self.database, "categories"),
            active_options(&self.database, "payment_methods"),
            active_options(&self.database, "household_members"),
            active_options(&self.database, "locations"),
        )?;
        Ok(SafeQueryPromptContext {
            current_date,
            timezone_id,
            categories,
            payment_methods,
            household_members,
            locations,
        })
    }
}

async fn active_ids(database: &SqlitePool, table: &str) -> Result<HashSet<String>, AppError> {
    let sql = match table {
        "categories" => "SELECT id FROM categories WHERE is_active = 1",
        "payment_methods" => "SELECT id FROM payment_methods WHERE is_active = 1",
        "household_members" => "SELECT id FROM household_members WHERE is_active = 1",
        "locations" => "SELECT id FROM locations WHERE is_active = 1",
        _ => return Err(AppError::validation("table", "安全查询选项表不受支持")),
    };
    Ok(sqlx::query_scalar::<_, String>(sql)
        .fetch_all(database)
        .await?
        .into_iter()
        .collect())
}

async fn active_options(
    database: &SqlitePool,
    table: &str,
) -> Result<Vec<SafeQueryOption>, AppError> {
    let sql = match table {
        "categories" => {
            "SELECT id, name FROM categories WHERE is_active = 1 ORDER BY sort_order, name"
        }
        "payment_methods" => {
            "SELECT id, display_name AS name FROM payment_methods WHERE is_active = 1 ORDER BY display_name"
        }
        "household_members" => {
            "SELECT id, display_name AS name FROM household_members WHERE is_active = 1 ORDER BY display_name"
        }
        "locations" => "SELECT id, name FROM locations WHERE is_active = 1 ORDER BY name",
        _ => return Err(AppError::validation("table", "安全查询选项表不受支持")),
    };
    Ok(sqlx::query(sql)
        .fetch_all(database)
        .await?
        .into_iter()
        .map(|row| SafeQueryOption {
            id: sqlx::Row::get(&row, "id"),
            name: sqlx::Row::get(&row, "name"),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::safe_query::SafeQueryPlan;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn database_allowlist_accepts_seeded_ids_and_rejects_hallucinated_ids() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("safe-query-service.sqlite3"))
            .await
            .unwrap();
        let service = SafeQueryService::new(database);
        let category_id = "10000000-0000-7000-8000-000000000006";
        let plan = |id: &str| -> SafeQueryPlan {
            serde_json::from_value(serde_json::json!({
                "schemaVersion": 1,
                "intent": "list_transactions",
                "filters": { "categoryId": id },
                "sort": null,
                "limit": 100,
                "explanation": "Filter by an allowed category for user review."
            }))
            .unwrap()
        };
        let validated = service.validate_plan(plan(category_id)).await.unwrap();
        assert_eq!(validated.filters.category_id.as_deref(), Some(category_id));
        assert!(
            service
                .validate_plan(plan("invented-category"))
                .await
                .is_err()
        );

        let context = service
            .prompt_context("2026-07-04".into(), "America/Toronto".into())
            .await
            .unwrap();
        assert!(context.categories.iter().any(|item| item.id == category_id));
    }
}
