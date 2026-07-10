use crate::AppState;
use crate::error::CommandError;
use serde::Serialize;
use sqlx::Row;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    app_version: &'static str,
    database_ready: bool,
    schema_version: i64,
    storage_mode: &'static str,
}

#[tauri::command]
pub async fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, CommandError> {
    let row = sqlx::query("SELECT COALESCE(MAX(version), 0) AS version FROM _sqlx_migrations")
        .fetch_one(&state.database)
        .await
        .map_err(crate::error::AppError::from)?;

    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION"),
        database_ready: true,
        schema_version: row.get("version"),
        storage_mode: "local_only",
    })
}
