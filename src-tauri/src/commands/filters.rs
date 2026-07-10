use crate::AppState;
use crate::domain::filters::{
    SaveTransactionFilterInput, TransactionFilterIdInput, TransactionSavedFilterRecord,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_transaction_filters(
    state: State<'_, AppState>,
) -> Result<Vec<TransactionSavedFilterRecord>, CommandError> {
    state
        .filter_service
        .list_transaction_filters()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_transaction_filter(
    input: SaveTransactionFilterInput,
    state: State<'_, AppState>,
) -> Result<TransactionSavedFilterRecord, CommandError> {
    state
        .filter_service
        .save_transaction_filter(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_transaction_filter(
    input: TransactionFilterIdInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .filter_service
        .delete_transaction_filter(input)
        .await
        .map_err(Into::into)
}
