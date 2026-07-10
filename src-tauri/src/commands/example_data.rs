use crate::AppState;
use crate::domain::example_data::ExampleDataStatus;
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn get_example_data_status(
    state: State<'_, AppState>,
) -> Result<ExampleDataStatus, CommandError> {
    state
        .example_data_service
        .status()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn load_example_data(
    state: State<'_, AppState>,
) -> Result<ExampleDataStatus, CommandError> {
    state.example_data_service.load().await.map_err(Into::into)
}

#[tauri::command]
pub async fn remove_example_data(
    state: State<'_, AppState>,
) -> Result<ExampleDataStatus, CommandError> {
    state
        .example_data_service
        .remove()
        .await
        .map_err(Into::into)
}
