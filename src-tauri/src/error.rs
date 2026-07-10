use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库操作失败")]
    Database(#[from] sqlx::Error),
    #[error("数据库迁移失败")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("{message}")]
    Validation {
        field: &'static str,
        message: String,
    },
    #[error("{message}")]
    NotFound {
        entity: &'static str,
        message: String,
    },
    #[error("{message}")]
    Conflict { message: String },
    #[error("设置数据格式无效")]
    InvalidSetting(#[from] serde_json::Error),
    #[error("{message}")]
    Export { message: String },
    #[error("{message}")]
    Import { message: String },
    #[error("{message}")]
    Backup { message: String },
    #[error("{message}")]
    Attachment { message: String },
    #[error("Excel 文件生成失败")]
    Spreadsheet(#[from] rust_xlsxwriter::XlsxError),
}

impl AppError {
    pub fn validation(field: &'static str, message: impl Into<String>) -> Self {
        Self::Validation {
            field,
            message: message.into(),
        }
    }

    pub fn not_found(entity: &'static str, message: impl Into<String>) -> Self {
        Self::NotFound {
            entity,
            message: message.into(),
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict {
            message: message.into(),
        }
    }

    pub fn export(message: impl Into<String>) -> Self {
        Self::Export {
            message: message.into(),
        }
    }

    pub fn import(message: impl Into<String>) -> Self {
        Self::Import {
            message: message.into(),
        }
    }

    pub fn backup(message: impl Into<String>) -> Self {
        Self::Backup {
            message: message.into(),
        }
    }

    pub fn attachment(message: impl Into<String>) -> Self {
        Self::Attachment {
            message: message.into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: &'static str,
    message: String,
    field: Option<&'static str>,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        tracing::error!(error = %error, "command failed");
        match error {
            AppError::Validation { field, message } => Self {
                code: "validation_error",
                message,
                field: Some(field),
            },
            AppError::NotFound { message, .. } => Self {
                code: "not_found",
                message,
                field: None,
            },
            AppError::Conflict { message } => Self {
                code: "conflict",
                message,
                field: None,
            },
            AppError::Export { message } => Self {
                code: "export_error",
                message,
                field: None,
            },
            AppError::Import { message } => Self {
                code: "import_error",
                message,
                field: None,
            },
            AppError::Backup { message } => Self {
                code: "backup_error",
                message,
                field: None,
            },
            AppError::Attachment { message } => Self {
                code: "attachment_error",
                message,
                field: None,
            },
            AppError::Spreadsheet(_) => Self {
                code: "export_error",
                message: "Excel 文件生成失败，请重试。".to_owned(),
                field: None,
            },
            AppError::Database(_) | AppError::Migration(_) | AppError::InvalidSetting(_) => Self {
                code: "storage_error",
                message: "本地数据操作失败，请重试。".to_owned(),
                field: None,
            },
        }
    }
}
