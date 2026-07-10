use crate::domain::attachments::{
    AttachmentAccessInput, AttachmentOwnerInput, AttachmentRecord, MAX_ATTACHMENT_BYTES,
    PickAttachmentInput, StoredAttachment,
};
use crate::error::AppError;
use crate::repositories::attachment_repository::AttachmentRepository;
use chrono::{Datelike, Utc};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct AttachmentService {
    repository: Arc<AttachmentRepository>,
    app_data_dir: PathBuf,
}

impl AttachmentService {
    pub fn new(repository: Arc<AttachmentRepository>, app_data_dir: PathBuf) -> Self {
        Self {
            repository,
            app_data_dir,
        }
    }

    pub async fn ensure_owner_can_accept(
        &self,
        input: &PickAttachmentInput,
    ) -> Result<(), AppError> {
        input.validate()?;
        self.repository
            .ensure_owner_can_accept(&input.owner())
            .await
    }

    pub async fn list(
        &self,
        input: AttachmentOwnerInput,
    ) -> Result<Vec<AttachmentRecord>, AppError> {
        input.validate()?;
        self.repository.list(&input).await
    }

    pub async fn add_from_path(
        &self,
        input: PickAttachmentInput,
        source_path: &Path,
    ) -> Result<AttachmentRecord, AppError> {
        self.ensure_owner_can_accept(&input).await?;
        let source_path = source_path.to_path_buf();
        let app_data_dir = self.app_data_dir.clone();
        let attachment_type = input.attachment_type;
        let (stored, destination) = tokio::task::spawn_blocking(move || {
            prepare_managed_copy(&app_data_dir, &source_path, attachment_type)
        })
        .await
        .map_err(|error| AppError::attachment(format!("附件复制任务失败：{error}")))??;

        match self.repository.create_and_link(&input, &stored).await {
            Ok(record) => Ok(record),
            Err(error) => {
                let _ = fs::remove_file(destination);
                Err(error)
            }
        }
    }

    pub async fn resolve_open_path(
        &self,
        input: AttachmentAccessInput,
    ) -> Result<PathBuf, AppError> {
        input.validate()?;
        let linked = self.repository.get_linked(&input).await?;
        resolve_existing_managed_path(&self.app_data_dir, &linked.relative_path)
    }

    pub async fn unlink(&self, input: AttachmentAccessInput) -> Result<(), AppError> {
        input.validate()?;
        let result = self.repository.unlink(&input).await?;
        if result.delete_managed_file {
            match resolve_existing_managed_path(&self.app_data_dir, &result.relative_path) {
                Ok(path) => {
                    if let Err(error) = fs::remove_file(&path) {
                        tracing::warn!(%error, path = %path.display(), "detached attachment file could not be removed");
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "detached attachment metadata referenced an unavailable managed file");
                }
            }
        }
        Ok(())
    }
}

fn prepare_managed_copy(
    app_data_dir: &Path,
    source_path: &Path,
    attachment_type: crate::domain::attachments::AttachmentType,
) -> Result<(StoredAttachment, PathBuf), AppError> {
    let metadata = fs::metadata(source_path)
        .map_err(|error| AppError::attachment(format!("无法读取所选附件：{error}")))?;
    if !metadata.is_file() {
        return Err(AppError::validation("attachment", "只能添加普通文件"));
    }
    if metadata.len() == 0 {
        return Err(AppError::validation("attachment", "不能添加空文件"));
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::validation("attachment", "附件不能超过 25 MiB"));
    }
    let original_filename = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("attachment", "附件文件名无效"))?
        .to_owned();
    if original_filename.chars().count() > 255 || original_filename.chars().any(char::is_control) {
        return Err(AppError::validation(
            "attachment",
            "附件文件名过长或包含控制字符",
        ));
    }
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AppError::validation("attachment", "附件必须具有受支持的文件扩展名"))?;
    let mime_type = allowed_mime_type(&extension)
        .ok_or_else(|| AppError::validation("attachment", "该附件类型不受支持"))?;

    let id = Uuid::now_v7().to_string();
    let now = Utc::now();
    let stored_filename = format!("{id}.{extension}");
    let relative_path = format!(
        "attachments/{:04}/{:02}/{stored_filename}",
        now.year(),
        now.month()
    );
    let destination = app_data_dir
        .join("attachments")
        .join(format!("{:04}", now.year()))
        .join(format!("{:02}", now.month()))
        .join(&stored_filename);
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::attachment("无法确定附件存储目录"))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::attachment(format!("无法创建附件存储目录：{error}")))?;
    let temporary = parent.join(format!(".{id}.tmp"));
    let copy_result = copy_with_hash(source_path, &temporary);
    let (file_size, sha256) = match copy_result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if destination.exists() {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::conflict("附件存储文件名冲突，请重试"));
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| AppError::attachment(format!("无法完成附件原子写入：{error}")))?;

    Ok((
        StoredAttachment {
            id,
            original_filename,
            stored_filename,
            relative_path,
            mime_type: mime_type.to_owned(),
            file_size: file_size as i64,
            sha256,
            attachment_type,
            created_at: now.to_rfc3339(),
        },
        destination,
    ))
}

fn copy_with_hash(source_path: &Path, temporary: &Path) -> Result<(u64, String), AppError> {
    let mut source = File::open(source_path)
        .map_err(|error| AppError::attachment(format!("无法打开所选附件：{error}")))?;
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary)
        .map_err(|error| AppError::attachment(format!("无法创建附件临时文件：{error}")))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| AppError::attachment(format!("读取附件失败：{error}")))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > MAX_ATTACHMENT_BYTES {
            return Err(AppError::validation("attachment", "附件不能超过 25 MiB"));
        }
        hasher.update(&buffer[..read]);
        destination
            .write_all(&buffer[..read])
            .map_err(|error| AppError::attachment(format!("写入附件失败：{error}")))?;
    }
    destination
        .sync_all()
        .map_err(|error| AppError::attachment(format!("同步附件文件失败：{error}")))?;
    Ok((total, format!("{:x}", hasher.finalize())))
}

fn resolve_existing_managed_path(
    app_data_dir: &Path,
    relative_path: &str,
) -> Result<PathBuf, AppError> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || relative
            .components()
            .next()
            .and_then(|component| match component {
                Component::Normal(value) => value.to_str(),
                _ => None,
            })
            != Some("attachments")
    {
        return Err(AppError::attachment("附件元数据包含不安全的相对路径"));
    }
    let root = app_data_dir.join("attachments");
    let candidate = app_data_dir.join(relative);
    if !candidate.is_file() {
        return Err(AppError::not_found("attachment_file", "附件文件缺失"));
    }
    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| AppError::attachment(format!("无法验证附件目录：{error}")))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| AppError::attachment(format!("无法验证附件文件：{error}")))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::attachment("附件路径超出托管目录"));
    }
    Ok(canonical_candidate)
}

fn allowed_mime_type(extension: &str) -> Option<&'static str> {
    Some(match extension {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "txt" => "text/plain",
        "rtf" => "application/rtf",
        "csv" => "text/csv",
        "json" => "application/json",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::attachments::{AttachmentOwnerType, AttachmentType, PickAttachmentInput};
    use crate::infrastructure::database::open_database;

    async fn insert_transaction(database: &sqlx::SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, origin, version, created_at, updated_at
             ) VALUES (?, '2026-07-04', 'expense', 'completed', 1250, 'CAD', 1250, 'CAD',
                       'manual', 1, '2026-07-04T12:00:00Z', '2026-07-04T12:00:00Z')",
        )
        .bind(id)
        .execute(database)
        .await
        .unwrap();
    }

    fn pick_input(owner_id: &str) -> PickAttachmentInput {
        PickAttachmentInput {
            owner_type: AttachmentOwnerType::Transaction,
            owner_id: owner_id.to_owned(),
            attachment_type: AttachmentType::Receipt,
        }
    }

    #[tokio::test]
    async fn attachment_is_copied_hashed_linked_audited_and_removed() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let database = open_database(&app_data.join("home-ledger.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "transaction-1").await;
        let source = directory.path().join("receipt.pdf");
        fs::write(&source, b"%PDF-1.7 receipt contents").unwrap();
        let repository = Arc::new(AttachmentRepository::new(database.clone()));
        let service = AttachmentService::new(repository, app_data.clone());

        let record = service
            .add_from_path(pick_input("transaction-1"), &source)
            .await
            .unwrap();
        assert_eq!(record.original_filename, "receipt.pdf");
        assert_eq!(record.file_size, 25);
        assert_eq!(record.sha256.len(), 64);
        let access = AttachmentAccessInput {
            id: record.id.clone(),
            owner_type: AttachmentOwnerType::Transaction,
            owner_id: "transaction-1".into(),
        };
        let managed_path = service.resolve_open_path(access.clone()).await.unwrap();
        assert_eq!(
            fs::read(&managed_path).unwrap(),
            b"%PDF-1.7 receipt contents"
        );
        assert_eq!(
            service
                .list(AttachmentOwnerInput {
                    owner_type: AttachmentOwnerType::Transaction,
                    owner_id: "transaction-1".into(),
                })
                .await
                .unwrap()
                .len(),
            1
        );
        let version_after_attach: i64 =
            sqlx::query_scalar("SELECT version FROM transactions WHERE id = 'transaction-1'")
                .fetch_one(&database)
                .await
                .unwrap();
        assert_eq!(version_after_attach, 1);

        service.unlink(access).await.unwrap();
        assert!(!managed_path.exists());
        let deleted_at: Option<String> =
            sqlx::query_scalar("SELECT deleted_at FROM attachments WHERE id = ?")
                .bind(&record.id)
                .fetch_one(&database)
                .await
                .unwrap();
        assert!(deleted_at.is_some());
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE entity_type = 'attachment' AND entity_id = ?",
        )
        .bind(&record.id)
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(audit_count, 2);
    }

    #[tokio::test]
    async fn unsupported_or_missing_source_is_rejected_without_database_rows() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let database = open_database(&app_data.join("home-ledger.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "transaction-1").await;
        let service = AttachmentService::new(
            Arc::new(AttachmentRepository::new(database.clone())),
            app_data,
        );
        let executable = directory.path().join("payload.exe");
        fs::write(&executable, b"not executable but forbidden").unwrap();
        assert!(
            service
                .add_from_path(pick_input("transaction-1"), &executable)
                .await
                .is_err()
        );
        assert!(
            service
                .add_from_path(
                    pick_input("transaction-1"),
                    &directory.path().join("missing.pdf")
                )
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM attachments")
            .fetch_one(&database)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn unsafe_stored_relative_path_is_never_opened() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let database = open_database(&app_data.join("home-ledger.sqlite3"))
            .await
            .unwrap();
        insert_transaction(&database, "transaction-1").await;
        sqlx::query(
            "INSERT INTO attachments(
                id, original_filename, stored_filename, relative_path, mime_type,
                file_size, sha256, attachment_type, created_at
             ) VALUES ('unsafe', 'escape.pdf', 'escape.pdf', '../escape.pdf', 'application/pdf',
                       1, ?, 'pdf', '2026-07-04T12:00:00Z')",
        )
        .bind("0".repeat(64))
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_attachments(transaction_id, attachment_id, created_at)
             VALUES ('transaction-1', 'unsafe', '2026-07-04T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        fs::write(directory.path().join("escape.pdf"), b"x").unwrap();
        let service =
            AttachmentService::new(Arc::new(AttachmentRepository::new(database)), app_data);
        assert!(
            service
                .resolve_open_path(AttachmentAccessInput {
                    id: "unsafe".into(),
                    owner_type: AttachmentOwnerType::Transaction,
                    owner_id: "transaction-1".into(),
                })
                .await
                .is_err()
        );
    }
}
