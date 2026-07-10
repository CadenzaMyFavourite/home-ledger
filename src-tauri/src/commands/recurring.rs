use crate::AppState;
use crate::domain::recurring::{
    MaterializeRecurringInput, MaterializeRecurringResult, RecurringEventRecord,
    RecurringTransactionRecord, SaveRecurringEventInput, SaveRecurringTransactionInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_recurring_transactions(
    state: State<'_, AppState>,
) -> Result<Vec<RecurringTransactionRecord>, CommandError> {
    state.recurring_service.list().await.map_err(Into::into)
}

#[tauri::command]
pub async fn list_recurring_events(
    state: State<'_, AppState>,
) -> Result<Vec<RecurringEventRecord>, CommandError> {
    state
        .recurring_service
        .list_events()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_recurring_event(
    input: SaveRecurringEventInput,
    state: State<'_, AppState>,
) -> Result<RecurringEventRecord, CommandError> {
    state
        .recurring_service
        .save_event(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_recurring_transaction(
    input: SaveRecurringTransactionInput,
    state: State<'_, AppState>,
) -> Result<RecurringTransactionRecord, CommandError> {
    state
        .recurring_service
        .save(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn materialize_recurring_transactions(
    input: MaterializeRecurringInput,
    state: State<'_, AppState>,
) -> Result<MaterializeRecurringResult, CommandError> {
    state
        .recurring_service
        .materialize(input)
        .await
        .map_err(Into::into)
}
