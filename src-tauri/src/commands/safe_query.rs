use crate::AppState;
use crate::application::safe_query_service::ValidatedSafeQuery;
use crate::domain::safe_query::{NaturalLanguageQueryInput, SafeQueryPlan};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn validate_safe_query_plan(
    plan: SafeQueryPlan,
    state: State<'_, AppState>,
) -> Result<ValidatedSafeQuery, CommandError> {
    state
        .safe_query_service
        .validate_plan(plan)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn translate_safe_query(
    input: NaturalLanguageQueryInput,
    state: State<'_, AppState>,
) -> Result<ValidatedSafeQuery, CommandError> {
    input.validate()?;
    let settings = state.settings_service.get().await?;
    let timezone = settings
        .timezone_id
        .parse::<chrono_tz::Tz>()
        .map_err(|_| crate::error::AppError::validation("timezoneId", "设置中的时区无效"))?;
    let current_date = chrono::Utc::now()
        .with_timezone(&timezone)
        .date_naive()
        .to_string();
    let context = state
        .safe_query_service
        .prompt_context(current_date, settings.timezone_id)
        .await?;
    let plan = state
        .local_ai_service
        .translate_safe_query(input, &context)
        .await?;
    state
        .safe_query_service
        .validate_plan(plan)
        .await
        .map_err(Into::into)
}
