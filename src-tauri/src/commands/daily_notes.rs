use crate::AppState;
use crate::domain::daily_notes::{
    DailyNoteRecord, DeleteDailyNoteInput, GetDailyNoteInput, SaveDailyNoteInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn get_daily_note(
    input: GetDailyNoteInput,
    state: State<'_, AppState>,
) -> Result<Option<DailyNoteRecord>, CommandError> {
    state
        .daily_note_service
        .get(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_daily_note(
    input: SaveDailyNoteInput,
    state: State<'_, AppState>,
) -> Result<DailyNoteRecord, CommandError> {
    state
        .daily_note_service
        .save(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_daily_note(
    input: DeleteDailyNoteInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .daily_note_service
        .delete(input)
        .await
        .map_err(Into::into)
}
