use crate::domain::settings::{AppSettings, UpdateSettingsInput};
use crate::error::AppError;
use chrono::Utc;
use serde::Serialize;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

pub struct SettingsRepository {
    database: SqlitePool,
}

impl SettingsRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn get(&self) -> Result<AppSettings, AppError> {
        let rows = sqlx::query("SELECT key, value_json FROM app_settings")
            .fetch_all(&self.database)
            .await?;
        let mut settings = AppSettings::default();

        for row in rows {
            let key: String = row.get("key");
            let value_json: String = row.get("value_json");
            match key.as_str() {
                "locale" => settings.locale = serde_json::from_str(&value_json)?,
                "timezone_id" => settings.timezone_id = serde_json::from_str(&value_json)?,
                "reporting_currency_code" => {
                    settings.reporting_currency_code = serde_json::from_str(&value_json)?
                }
                "country_code" => settings.country_code = serde_json::from_str(&value_json)?,
                "region_code" => settings.region_code = serde_json::from_str(&value_json)?,
                "theme" => settings.theme = serde_json::from_str(&value_json)?,
                "auto_backup_policy" => {
                    settings.auto_backup_policy = serde_json::from_str(&value_json)?
                }
                "calendar_color_overrides" => {
                    settings.calendar_color_overrides = serde_json::from_str(&value_json)?
                }
                _ => {}
            }
        }

        Ok(settings)
    }

    pub async fn update(&self, input: UpdateSettingsInput) -> Result<AppSettings, AppError> {
        let mut transaction = self.database.begin().await?;
        let updated_at = Utc::now().to_rfc3339();

        upsert(&mut transaction, "locale", &input.locale, &updated_at).await?;
        upsert(
            &mut transaction,
            "timezone_id",
            &input.timezone_id,
            &updated_at,
        )
        .await?;
        upsert(
            &mut transaction,
            "reporting_currency_code",
            &input.reporting_currency_code,
            &updated_at,
        )
        .await?;
        upsert(
            &mut transaction,
            "country_code",
            &input.country_code,
            &updated_at,
        )
        .await?;
        upsert(
            &mut transaction,
            "region_code",
            &input.region_code,
            &updated_at,
        )
        .await?;
        upsert(&mut transaction, "theme", &input.theme, &updated_at).await?;
        upsert(
            &mut transaction,
            "auto_backup_policy",
            &input.auto_backup_policy,
            &updated_at,
        )
        .await?;
        upsert(
            &mut transaction,
            "calendar_color_overrides",
            &input.calendar_color_overrides,
            &updated_at,
        )
        .await?;
        transaction.commit().await?;

        self.get().await
    }
}

async fn upsert<T: Serialize>(
    transaction: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: &T,
    updated_at: &str,
) -> Result<(), AppError> {
    let value_json = serde_json::to_string(value)?;
    sqlx::query(
        "INSERT INTO app_settings(key, value_json, schema_version, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value_json)
    .bind(updated_at)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::settings::{CalendarColorOverrides, ThemePreference};
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn settings_round_trip_preserves_typed_values() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("settings.sqlite3"))
            .await
            .expect("database");
        let repository = SettingsRepository::new(database);

        let updated = repository
            .update(UpdateSettingsInput {
                locale: "en-CA".into(),
                timezone_id: "America/Vancouver".into(),
                reporting_currency_code: "CAD".into(),
                country_code: "CA".into(),
                region_code: "BC".into(),
                theme: ThemePreference::Dark,
                auto_backup_policy: crate::domain::settings::AutoBackupPolicy {
                    enabled: true,
                    interval_days: 3,
                    retention_count: 5,
                },
                calendar_color_overrides: CalendarColorOverrides {
                    travel: "#123456".into(),
                    ..CalendarColorOverrides::default()
                },
            })
            .await
            .expect("update settings");

        assert_eq!(updated.locale, "en-CA");
        assert_eq!(updated.timezone_id, "America/Vancouver");
        assert_eq!(updated.theme, ThemePreference::Dark);
        assert_eq!(updated.auto_backup_policy.retention_count, 5);
        assert_eq!(updated.calendar_color_overrides.travel, "#123456");
    }
}
