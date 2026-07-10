use crate::AppState;
use crate::domain::templates::{
    SaveTransactionTemplateInput, TransactionTemplateIdInput, TransactionTemplateRecord,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_transaction_templates(
    include_inactive: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<TransactionTemplateRecord>, CommandError> {
    state
        .template_service
        .list_transaction_templates(include_inactive.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_transaction_template(
    input: SaveTransactionTemplateInput,
    state: State<'_, AppState>,
) -> Result<TransactionTemplateRecord, CommandError> {
    state
        .template_service
        .save_transaction_template(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn use_transaction_template(
    input: TransactionTemplateIdInput,
    state: State<'_, AppState>,
) -> Result<TransactionTemplateRecord, CommandError> {
    state
        .template_service
        .use_transaction_template(input)
        .await
        .map_err(Into::into)
}
