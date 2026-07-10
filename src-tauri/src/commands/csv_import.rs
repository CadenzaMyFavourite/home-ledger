use crate::AppState;
use crate::domain::csv_import::{
    AnalyzeCsvImportInput, CommitCsvImportInput, CsvImportAnalysis, CsvImportBatchInput,
    CsvImportCommitResult, CsvImportPreview, CsvImportUndoResult, PreviewCsvImportInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn preview_csv_import(
    input: PreviewCsvImportInput,
    state: State<'_, AppState>,
) -> Result<CsvImportPreview, CommandError> {
    state
        .csv_import_service
        .preview(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn analyze_csv_import(
    input: AnalyzeCsvImportInput,
    state: State<'_, AppState>,
) -> Result<CsvImportAnalysis, CommandError> {
    state
        .csv_import_service
        .analyze(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn commit_csv_import(
    input: CommitCsvImportInput,
    state: State<'_, AppState>,
) -> Result<CsvImportCommitResult, CommandError> {
    state
        .csv_import_service
        .commit(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn undo_csv_import(
    input: CsvImportBatchInput,
    state: State<'_, AppState>,
) -> Result<CsvImportUndoResult, CommandError> {
    state
        .csv_import_service
        .undo(input)
        .await
        .map_err(Into::into)
}
