use crate::AppState;
use crate::domain::global_search::{GlobalSearchInput, GlobalSearchPage};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn global_search(
    input: GlobalSearchInput,
    state: State<'_, AppState>,
) -> Result<GlobalSearchPage, CommandError> {
    state
        .global_search_service
        .search(input)
        .await
        .map_err(Into::into)
}
