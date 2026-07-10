use crate::domain::reference_data::{
    Category, HouseholdMember, Location, PaymentMethod, SaveCategoryInput,
    SaveHouseholdMemberInput, SaveLocationInput, SavePaymentMethodInput, TransactionReferenceData,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct ReferenceDataRepository {
    database: SqlitePool,
}

impl ReferenceDataRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list_transaction_reference_data(
        &self,
    ) -> Result<TransactionReferenceData, AppError> {
        let category_rows = sqlx::query(
            "SELECT c.id, c.name, c.type, c.parent_id, p.name AS parent_name,
                    c.icon, c.color, c.is_active
             FROM categories c
             LEFT JOIN categories p ON p.id = c.parent_id
             ORDER BY c.type, COALESCE(p.sort_order, c.sort_order), c.parent_id IS NOT NULL, c.sort_order, c.name",
        )
        .fetch_all(&self.database)
        .await?;
        let payment_rows = sqlx::query(
            "SELECT id, display_name, method_type, institution, last_four,
                    default_currency_code, icon, color, is_active
             FROM payment_methods
             ORDER BY is_active DESC, display_name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        let member_rows = sqlx::query(
            "SELECT id, display_name, relationship, avatar_relative_path, color, is_default, is_active
             FROM household_members
             ORDER BY is_active DESC, is_default DESC, display_name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        let location_rows = sqlx::query(
            "SELECT id, name, address_line, city, province, country_code, postal_code,
                    is_favorite, is_active
             FROM locations
             ORDER BY is_active DESC, is_favorite DESC, name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;

        Ok(TransactionReferenceData {
            categories: category_rows.iter().map(map_category).collect(),
            payment_methods: payment_rows.iter().map(map_payment_method).collect(),
            household_members: member_rows.iter().map(map_household_member).collect(),
            locations: location_rows.iter().map(map_location).collect(),
        })
    }

    pub async fn get_category(&self, id: &str) -> Result<Option<Category>, AppError> {
        let row = sqlx::query(
            "SELECT c.id, c.name, c.type, c.parent_id, p.name AS parent_name,
                    c.icon, c.color, c.is_active
             FROM categories c
             LEFT JOIN categories p ON p.id = c.parent_id
             WHERE c.id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_category))
    }

    pub async fn category_has_children(&self, id: &str) -> Result<bool, AppError> {
        let value: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id = ?)")
                .bind(id)
                .fetch_one(&self.database)
                .await?;
        Ok(value == 1)
    }

    pub async fn payment_method_is_active(&self, id: &str) -> Result<bool, AppError> {
        let value: Option<i64> =
            sqlx::query_scalar("SELECT is_active FROM payment_methods WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.database)
                .await?;
        Ok(value == Some(1))
    }

    pub async fn save_category(&self, input: &SaveCategoryInput) -> Result<Category, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM categories
                WHERE type = ? AND COALESCE(parent_id, '') = COALESCE(?, '')
                  AND name = ? COLLATE NOCASE AND id <> ?
             )",
        )
        .bind(&input.category_type)
        .bind(&input.parent_id)
        .bind(input.name.trim())
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("同一层级已经存在同名分类"));
        }

        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE categories
                 SET name = ?, type = ?, parent_id = ?, icon = ?, color = ?, is_active = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.name.trim())
            .bind(&input.category_type)
            .bind(&input.parent_id)
            .bind(trimmed(&input.icon))
            .bind(trimmed(&input.color))
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found("category", "分类不存在"));
            }
        } else {
            let sort_order: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE COALESCE(parent_id, '') = COALESCE(?, '')",
            )
            .bind(&input.parent_id)
            .fetch_one(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO categories(
                    id, name, type, parent_id, icon, color, sort_order, is_default, is_active, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(&input.category_type)
            .bind(&input.parent_id)
            .bind(trimmed(&input.icon))
            .bind(trimmed(&input.color))
            .bind(sort_order)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_reference_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "category",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_category(&id)
            .await?
            .ok_or_else(|| AppError::not_found("category", "分类不存在"))
    }

    pub async fn save_payment_method(
        &self,
        input: &SavePaymentMethodInput,
    ) -> Result<PaymentMethod, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM payment_methods
                WHERE display_name = ? COLLATE NOCASE AND id <> ?
             )",
        )
        .bind(input.display_name.trim())
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("已经存在同名支付方式"));
        }

        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE payment_methods
                 SET display_name = ?, method_type = ?, institution = ?, last_four = ?,
                     default_currency_code = ?, icon = ?, color = ?, is_active = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.display_name.trim())
            .bind(&input.method_type)
            .bind(trimmed(&input.institution))
            .bind(trimmed(&input.last_four))
            .bind(&input.default_currency_code)
            .bind(trimmed(&input.icon))
            .bind(trimmed(&input.color))
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found("payment_method", "支付方式不存在"));
            }
        } else {
            sqlx::query(
                "INSERT INTO payment_methods(
                    id, display_name, method_type, institution, last_four, default_currency_code,
                    icon, color, is_active, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.display_name.trim())
            .bind(&input.method_type)
            .bind(trimmed(&input.institution))
            .bind(trimmed(&input.last_four))
            .bind(&input.default_currency_code)
            .bind(trimmed(&input.icon))
            .bind(trimmed(&input.color))
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_reference_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "payment_method",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_payment_method(&id)
            .await?
            .ok_or_else(|| AppError::not_found("payment_method", "支付方式不存在"))
    }

    pub async fn get_payment_method(&self, id: &str) -> Result<Option<PaymentMethod>, AppError> {
        let row = sqlx::query(
            "SELECT id, display_name, method_type, institution, last_four,
                    default_currency_code, icon, color, is_active
             FROM payment_methods WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_payment_method))
    }

    pub async fn save_household_member(
        &self,
        input: &SaveHouseholdMemberInput,
    ) -> Result<HouseholdMember, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM household_members
                WHERE display_name = ? COLLATE NOCASE AND id <> ?
             )",
        )
        .bind(input.display_name.trim())
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("已经存在同名家庭成员"));
        }
        if input.is_default {
            sqlx::query(
                "UPDATE household_members SET is_default = 0, updated_at = ? WHERE id <> ?",
            )
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
        }
        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE household_members
                 SET display_name = ?, relationship = ?, color = ?, is_default = ?,
                     is_active = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.display_name.trim())
            .bind(trimmed(&input.relationship))
            .bind(trimmed(&input.color))
            .bind(input.is_default)
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found("household_member", "家庭成员不存在"));
            }
        } else {
            sqlx::query(
                "INSERT INTO household_members(
                    id, display_name, relationship, color, is_default, is_active, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.display_name.trim())
            .bind(trimmed(&input.relationship))
            .bind(trimmed(&input.color))
            .bind(input.is_default)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        let active_default_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM household_members WHERE is_default = 1 AND is_active = 1",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if active_default_count != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("必须保留一个已启用的默认家庭成员"));
        }
        insert_reference_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "household_member",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_household_member(&id)
            .await?
            .ok_or_else(|| AppError::not_found("household_member", "家庭成员不存在"))
    }

    pub async fn get_household_member(
        &self,
        id: &str,
    ) -> Result<Option<HouseholdMember>, AppError> {
        let row = sqlx::query(
            "SELECT id, display_name, relationship, avatar_relative_path, color, is_default, is_active
             FROM household_members WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_household_member))
    }

    pub async fn household_member_is_active(&self, id: &str) -> Result<bool, AppError> {
        let value: Option<i64> =
            sqlx::query_scalar("SELECT is_active FROM household_members WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.database)
                .await?;
        Ok(value == Some(1))
    }

    pub async fn save_location(&self, input: &SaveLocationInput) -> Result<Location, AppError> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let duplicate: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM locations
                WHERE name = ? COLLATE NOCASE
                  AND COALESCE(city, '') = COALESCE(?, '') COLLATE NOCASE
                  AND id <> ?
             )",
        )
        .bind(input.name.trim())
        .bind(trimmed(&input.city))
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        if duplicate == 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("同一城市已经存在同名地点"));
        }
        if input.id.is_some() {
            let result = sqlx::query(
                "UPDATE locations
                 SET name = ?, address_line = ?, city = ?, province = ?, country_code = ?,
                     postal_code = ?, is_favorite = ?, is_active = ?, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.name.trim())
            .bind(trimmed(&input.address_line))
            .bind(trimmed(&input.city))
            .bind(trimmed(&input.province))
            .bind(trimmed(&input.country_code))
            .bind(trimmed(&input.postal_code))
            .bind(input.is_favorite)
            .bind(input.is_active)
            .bind(&now)
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::not_found("location", "地点不存在"));
            }
        } else {
            sqlx::query(
                "INSERT INTO locations(
                    id, name, address_line, city, province, country_code, postal_code,
                    is_favorite, is_active, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(input.name.trim())
            .bind(trimmed(&input.address_line))
            .bind(trimmed(&input.city))
            .bind(trimmed(&input.province))
            .bind(trimmed(&input.country_code))
            .bind(trimmed(&input.postal_code))
            .bind(input.is_favorite)
            .bind(input.is_active)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        insert_reference_audit(
            &mut transaction,
            if input.id.is_some() {
                "update"
            } else {
                "create"
            },
            "location",
            &id,
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_location(&id)
            .await?
            .ok_or_else(|| AppError::not_found("location", "地点不存在"))
    }

    pub async fn get_location(&self, id: &str) -> Result<Option<Location>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, address_line, city, province, country_code, postal_code,
                    is_favorite, is_active
             FROM locations WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?;
        Ok(row.as_ref().map(map_location))
    }

    pub async fn location_is_active(&self, id: &str) -> Result<bool, AppError> {
        let value: Option<i64> = sqlx::query_scalar("SELECT is_active FROM locations WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.database)
            .await?;
        Ok(value == Some(1))
    }

    pub async fn reporting_currency_code(&self) -> Result<String, AppError> {
        let value_json: String = sqlx::query_scalar(
            "SELECT value_json FROM app_settings WHERE key = 'reporting_currency_code'",
        )
        .fetch_one(&self.database)
        .await?;
        Ok(serde_json::from_str(&value_json)?)
    }

    pub async fn default_household_member_id(&self) -> Result<String, AppError> {
        sqlx::query_scalar(
            "SELECT id FROM household_members WHERE is_default = 1 AND is_active = 1 LIMIT 1",
        )
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("household_member", "没有可用的默认家庭成员"))
    }
}

fn trimmed(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

async fn insert_reference_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(id, occurred_at, actor_type, action, entity_type, entity_id)
         VALUES (?, ?, 'user', ?, ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn map_category(row: &sqlx::sqlite::SqliteRow) -> Category {
    Category {
        id: row.get("id"),
        name: row.get("name"),
        category_type: row.get("type"),
        parent_id: row.get("parent_id"),
        parent_name: row.get("parent_name"),
        icon: row.get("icon"),
        color: row.get("color"),
        is_active: row.get::<i64, _>("is_active") == 1,
    }
}

fn map_payment_method(row: &sqlx::sqlite::SqliteRow) -> PaymentMethod {
    PaymentMethod {
        id: row.get("id"),
        display_name: row.get("display_name"),
        method_type: row.get("method_type"),
        institution: row.get("institution"),
        last_four: row.get("last_four"),
        default_currency_code: row.get("default_currency_code"),
        icon: row.get("icon"),
        color: row.get("color"),
        is_active: row.get::<i64, _>("is_active") == 1,
    }
}

fn map_household_member(row: &sqlx::sqlite::SqliteRow) -> HouseholdMember {
    HouseholdMember {
        id: row.get("id"),
        display_name: row.get("display_name"),
        relationship: row.get("relationship"),
        avatar_relative_path: row.get("avatar_relative_path"),
        color: row.get("color"),
        is_default: row.get::<i64, _>("is_default") == 1,
        is_active: row.get::<i64, _>("is_active") == 1,
    }
}

fn map_location(row: &sqlx::sqlite::SqliteRow) -> Location {
    Location {
        id: row.get("id"),
        name: row.get("name"),
        address_line: row.get("address_line"),
        city: row.get("city"),
        province: row.get("province"),
        country_code: row.get("country_code"),
        postal_code: row.get("postal_code"),
        is_favorite: row.get::<i64, _>("is_favorite") == 1,
        is_active: row.get::<i64, _>("is_active") == 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn member_default_and_location_status_round_trip() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("references.sqlite3"))
            .await
            .expect("database");
        let repository = ReferenceDataRepository::new(database);

        let member = repository
            .save_household_member(&SaveHouseholdMemberInput {
                id: None,
                display_name: "Alex".into(),
                relationship: Some("Spouse".into()),
                color: None,
                is_default: true,
                is_active: true,
            })
            .await
            .expect("save member");
        assert!(member.is_default);
        assert_eq!(
            repository.default_household_member_id().await.unwrap(),
            member.id
        );

        let rejected = repository
            .save_household_member(&SaveHouseholdMemberInput {
                id: Some(member.id.clone()),
                display_name: member.display_name.clone(),
                relationship: member.relationship.clone(),
                color: member.color.clone(),
                is_default: false,
                is_active: true,
            })
            .await;
        assert!(rejected.is_err());
        assert_eq!(
            repository.default_household_member_id().await.unwrap(),
            member.id
        );

        let location = repository
            .save_location(&SaveLocationInput {
                id: None,
                name: "Costco Richmond Hill".into(),
                address_line: Some("35 John Birchall Road".into()),
                city: Some("Richmond Hill".into()),
                province: Some("Ontario".into()),
                country_code: Some("CA".into()),
                postal_code: Some("L4S 0B2".into()),
                is_favorite: true,
                is_active: true,
            })
            .await
            .expect("save location");
        assert!(repository.location_is_active(&location.id).await.unwrap());

        let disabled = repository
            .save_location(&SaveLocationInput {
                id: Some(location.id.clone()),
                name: location.name.clone(),
                address_line: location.address_line.clone(),
                city: location.city.clone(),
                province: location.province.clone(),
                country_code: location.country_code.clone(),
                postal_code: location.postal_code.clone(),
                is_favorite: location.is_favorite,
                is_active: false,
            })
            .await
            .expect("disable location");
        assert!(!disabled.is_active);
        assert!(!repository.location_is_active(&location.id).await.unwrap());
        assert!(
            repository
                .get_location(&location.id)
                .await
                .unwrap()
                .is_some()
        );
    }
}
