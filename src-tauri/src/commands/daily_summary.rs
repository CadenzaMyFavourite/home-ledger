use crate::AppState;
use crate::domain::daily_summary::{DailyFinancialSummary, DailyFinancialSummaryInput};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_daily_financial_summaries(
    input: DailyFinancialSummaryInput,
    state: State<'_, AppState>,
) -> Result<Vec<DailyFinancialSummary>, CommandError> {
    state
        .daily_summary_service
        .list(input)
        .await
        .map_err(Into::into)
}
