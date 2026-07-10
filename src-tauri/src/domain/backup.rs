use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub backup_type: String,
    pub format_version: i64,
    pub schema_version: i64,
    pub app_version: String,
    pub filename: String,
    pub status: String,
    pub total_size: i64,
    pub created_at: String,
    pub verified_at: Option<String>,
    pub failure_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupIdInput {
    pub backup_id: String,
}

impl BackupIdInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.backup_id.trim().is_empty() {
            return Err(AppError::validation("backupId", "备份 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerificationResult {
    pub backup_id: String,
    pub valid: bool,
    pub file_count: usize,
    pub total_size: u64,
    pub checked_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageRestoreInput {
    pub backup_id: String,
    pub confirmation_text: String,
}

impl StageRestoreInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.backup_id.trim().is_empty() {
            return Err(AppError::validation("backupId", "备份 ID 无效"));
        }
        if self.confirmation_text != "RESTORE" {
            return Err(AppError::validation(
                "confirmationText",
                "请输入 RESTORE 以确认恢复",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRestoreResult {
    pub backup_id: String,
    pub pre_restore_backup_id: String,
    pub restart_required: bool,
}
