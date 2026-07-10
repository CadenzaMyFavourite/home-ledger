use crate::AppState;
use crate::domain::settings::{AppSettings, UpdateSettingsInput};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, CommandError> {
    state.settings_service.get().await.map_err(Into::into)
}

#[tauri::command]
pub async fn update_settings(
    input: UpdateSettingsInput,
    state: State<'_, AppState>,
) -> Result<AppSettings, CommandError> {
    state
        .settings_service
        .update(input)
        .await
        .map_err(Into::into)
}
