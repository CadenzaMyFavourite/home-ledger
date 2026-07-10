use crate::AppState;
use crate::domain::backup::{
    BackupIdInput, BackupRecord, BackupVerificationResult, StageRestoreInput, StageRestoreResult,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupRecord>, CommandError> {
    state.backup_service.list().await.map_err(Into::into)
}

#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>) -> Result<BackupRecord, CommandError> {
    state
        .backup_service
        .create_manual()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn verify_backup(
    input: BackupIdInput,
    state: State<'_, AppState>,
) -> Result<BackupVerificationResult, CommandError> {
    state
        .backup_service
        .verify(&input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn stage_backup_restore(
    input: StageRestoreInput,
    state: State<'_, AppState>,
) -> Result<StageRestoreResult, CommandError> {
    state
        .backup_service
        .stage_restore(&input)
        .await
        .map_err(Into::into)
}
