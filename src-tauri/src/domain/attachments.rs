use crate::error::AppError;
use serde::{Deserialize, Serialize};

pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_OWNER: i64 = 50;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentOwnerType {
    Transaction,
    Event,
    DailyNote,
}

impl AttachmentOwnerType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Transaction => "transaction",
            Self::Event => "event",
            Self::DailyNote => "daily_note",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentType {
    Receipt,
    Invoice,
    Image,
    Pdf,
    Contract,
    Other,
}

impl AttachmentType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Receipt => "receipt",
            Self::Invoice => "invoice",
            Self::Image => "image",
            Self::Pdf => "pdf",
            Self::Contract => "contract",
            Self::Other => "other",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self, AppError> {
        match value {
            "receipt" => Ok(Self::Receipt),
            "invoice" => Ok(Self::Invoice),
            "image" => Ok(Self::Image),
            "pdf" => Ok(Self::Pdf),
            "contract" => Ok(Self::Contract),
            "other" => Ok(Self::Other),
            _ => Err(AppError::attachment("附件类型数据无效")),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentOwnerInput {
    pub owner_type: AttachmentOwnerType,
    pub owner_id: String,
}

impl AttachmentOwnerInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id("ownerId", &self.owner_id)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PickAttachmentInput {
    pub owner_type: AttachmentOwnerType,
    pub owner_id: String,
    pub attachment_type: AttachmentType,
}

impl PickAttachmentInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id("ownerId", &self.owner_id)
    }

    pub fn owner(&self) -> AttachmentOwnerInput {
        AttachmentOwnerInput {
            owner_type: self.owner_type,
            owner_id: self.owner_id.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentAccessInput {
    pub id: String,
    pub owner_type: AttachmentOwnerType,
    pub owner_id: String,
}

impl AttachmentAccessInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id("id", &self.id)?;
        validate_id("ownerId", &self.owner_id)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecord {
    pub id: String,
    pub owner_type: AttachmentOwnerType,
    pub owner_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256: String,
    pub attachment_type: AttachmentType,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct StoredAttachment {
    pub id: String,
    pub original_filename: String,
    pub stored_filename: String,
    pub relative_path: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256: String,
    pub attachment_type: AttachmentType,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct LinkedStoredAttachment {
    pub record: AttachmentRecord,
    pub relative_path: String,
}

#[derive(Clone, Debug)]
pub struct UnlinkAttachmentResult {
    pub relative_path: String,
    pub delete_managed_file: bool,
}

fn validate_id(field: &'static str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > 100 {
        return Err(AppError::validation(field, "附件关联标识无效"));
    }
    Ok(())
}
