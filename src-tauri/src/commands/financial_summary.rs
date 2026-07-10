use crate::AppState;
use crate::domain::financial_summary::{
    ExportFinancialReportInput, ExportFinancialReportResult, FinancialSummary,
    FinancialSummaryInput, ReportNoteQueryInput, ReportNoteRecord, ReviewCandidateActionInput,
    SaveReportNoteInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn get_financial_summary(
    input: FinancialSummaryInput,
    state: State<'_, AppState>,
) -> Result<FinancialSummary, CommandError> {
    state
        .financial_summary_service
        .get(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_financial_review_candidate_status(
    input: ReviewCandidateActionInput,
    state: State<'_, AppState>,
) -> Result<ReviewCandidateActionInput, CommandError> {
    state
        .financial_summary_service
        .set_review_status(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_report_note(
    input: ReportNoteQueryInput,
    state: State<'_, AppState>,
) -> Result<Option<ReportNoteRecord>, CommandError> {
    state
        .financial_summary_service
        .get_report_note(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_report_note(
    input: SaveReportNoteInput,
    state: State<'_, AppState>,
) -> Result<ReportNoteRecord, CommandError> {
    state
        .financial_summary_service
        .save_report_note(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn export_financial_report(
    input: ExportFinancialReportInput,
    state: State<'_, AppState>,
) -> Result<ExportFinancialReportResult, CommandError> {
    state
        .financial_summary_service
        .export_report(input)
        .await
        .map_err(Into::into)
}
