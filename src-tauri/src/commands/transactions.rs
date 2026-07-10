use crate::AppState;
use crate::domain::transactions::{
    BatchCategoryUpdateInput, BatchEditTransactionsInput, BatchEditTransactionsResult,
    BatchTransactionItemsInput, BatchTransactionMutationResult, CreateTransactionInput,
    ListTransactionsInput, TransactionMutationResult, TransactionPage, TransactionRecord,
    TransactionSuggestion, TransactionSuggestionInput, TransactionVersionInput, UndoBatchEditInput,
    UpdateTransactionInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_transactions(
    input: ListTransactionsInput,
    state: State<'_, AppState>,
) -> Result<TransactionPage, CommandError> {
    state
        .transaction_service
        .list(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn suggest_transaction(
    input: TransactionSuggestionInput,
    state: State<'_, AppState>,
) -> Result<TransactionSuggestion, CommandError> {
    state
        .transaction_service
        .suggest(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn create_transaction(
    input: CreateTransactionInput,
    state: State<'_, AppState>,
) -> Result<TransactionRecord, CommandError> {
    state
        .transaction_service
        .create(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn update_transaction(
    input: UpdateTransactionInput,
    state: State<'_, AppState>,
) -> Result<TransactionRecord, CommandError> {
    state
        .transaction_service
        .update(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_transaction(
    input: TransactionVersionInput,
    state: State<'_, AppState>,
) -> Result<TransactionMutationResult, CommandError> {
    state
        .transaction_service
        .soft_delete(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn restore_transaction(
    input: TransactionVersionInput,
    state: State<'_, AppState>,
) -> Result<TransactionRecord, CommandError> {
    state
        .transaction_service
        .restore(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn batch_update_transaction_category(
    input: BatchCategoryUpdateInput,
    state: State<'_, AppState>,
) -> Result<BatchTransactionMutationResult, CommandError> {
    state
        .transaction_service
        .batch_update_category(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn batch_delete_transactions(
    input: BatchTransactionItemsInput,
    state: State<'_, AppState>,
) -> Result<BatchTransactionMutationResult, CommandError> {
    state
        .transaction_service
        .batch_soft_delete(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn batch_restore_transactions(
    input: BatchTransactionItemsInput,
    state: State<'_, AppState>,
) -> Result<BatchTransactionMutationResult, CommandError> {
    state
        .transaction_service
        .batch_restore(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn batch_edit_transactions(
    input: BatchEditTransactionsInput,
    state: State<'_, AppState>,
) -> Result<BatchEditTransactionsResult, CommandError> {
    state
        .transaction_service
        .batch_edit(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn undo_batch_edit_transactions(
    input: UndoBatchEditInput,
    state: State<'_, AppState>,
) -> Result<BatchEditTransactionsResult, CommandError> {
    state
        .transaction_service
        .undo_batch_edit(input)
        .await
        .map_err(Into::into)
}
