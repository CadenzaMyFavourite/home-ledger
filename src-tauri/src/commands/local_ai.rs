use crate::AppState;
use crate::domain::financial_summary::FinancialSummaryInput;
use crate::domain::local_ai::{
    AiConnectionTestResult, AiProfileRecord, AiSuggestionQueryInput, AiSuggestionRecord,
    AiSummaryQueryInput, AiSummaryRecord, GenerateAiSuggestionsInput, GenerateAiSummaryInput,
    ReviewAiSuggestionInput, SaveAiProfileInput, UpdateAiSummaryInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_ai_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<AiProfileRecord>, CommandError> {
    state
        .local_ai_service
        .list_profiles()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_ai_profile(
    input: SaveAiProfileInput,
    state: State<'_, AppState>,
) -> Result<AiProfileRecord, CommandError> {
    state
        .local_ai_service
        .save_profile(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn test_ai_connection(
    input: SaveAiProfileInput,
    state: State<'_, AppState>,
) -> Result<AiConnectionTestResult, CommandError> {
    state
        .local_ai_service
        .test_connection(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_ai_summaries(
    input: AiSummaryQueryInput,
    state: State<'_, AppState>,
) -> Result<Vec<AiSummaryRecord>, CommandError> {
    state
        .local_ai_service
        .list_summaries(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn generate_ai_summary(
    input: GenerateAiSummaryInput,
    state: State<'_, AppState>,
) -> Result<AiSummaryRecord, CommandError> {
    input.validate().map_err(CommandError::from)?;
    let current = state
        .financial_summary_service
        .get(FinancialSummaryInput {
            period_start_date: input.period_start_date.clone(),
            period_end_date_exclusive: input.period_end_date_exclusive.clone(),
            reporting_currency_code: input.reporting_currency_code.clone(),
        })
        .await
        .map_err(CommandError::from)?;
    let previous = state
        .financial_summary_service
        .get(FinancialSummaryInput {
            period_start_date: input.previous_period_start_date.clone(),
            period_end_date_exclusive: input.period_start_date.clone(),
            reporting_currency_code: input.reporting_currency_code.clone(),
        })
        .await
        .map_err(CommandError::from)?;
    state
        .local_ai_service
        .generate_summary(input, &current, &previous)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn update_ai_summary(
    input: UpdateAiSummaryInput,
    state: State<'_, AppState>,
) -> Result<AiSummaryRecord, CommandError> {
    state
        .local_ai_service
        .update_summary(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_ai_suggestions(
    input: AiSuggestionQueryInput,
    state: State<'_, AppState>,
) -> Result<Vec<AiSuggestionRecord>, CommandError> {
    state
        .local_ai_service
        .list_suggestions(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn generate_ai_suggestions(
    input: GenerateAiSuggestionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<AiSuggestionRecord>, CommandError> {
    state
        .local_ai_service
        .generate_suggestions(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn review_ai_suggestion(
    input: ReviewAiSuggestionInput,
    state: State<'_, AppState>,
) -> Result<AiSuggestionRecord, CommandError> {
    state
        .local_ai_service
        .review_suggestion(input)
        .await
        .map_err(Into::into)
}
