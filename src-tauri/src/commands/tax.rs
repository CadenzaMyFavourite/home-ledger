use crate::AppState;
use crate::domain::tax::{
    ExportTaxPackageInput, ExportTaxPackageResult, SaveTaxTagInput, SetTransactionTaxTagInput,
    TaxOrganizer, TaxTagMutationResult, TaxTagRecord, TaxYearInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn get_tax_organizer(
    input: TaxYearInput,
    state: State<'_, AppState>,
) -> Result<TaxOrganizer, CommandError> {
    state
        .tax_service
        .get_organizer(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_transaction_tax_tag(
    input: SetTransactionTaxTagInput,
    state: State<'_, AppState>,
) -> Result<TaxTagMutationResult, CommandError> {
    state
        .tax_service
        .set_transaction_tag(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_tax_tag(
    input: SaveTaxTagInput,
    state: State<'_, AppState>,
) -> Result<TaxTagRecord, CommandError> {
    state.tax_service.save_tag(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn export_tax_package(
    input: ExportTaxPackageInput,
    state: State<'_, AppState>,
) -> Result<ExportTaxPackageResult, CommandError> {
    state
        .tax_service
        .export_package(input)
        .await
        .map_err(Into::into)
}
