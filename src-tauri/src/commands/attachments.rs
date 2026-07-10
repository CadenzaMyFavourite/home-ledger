use crate::AppState;
use crate::domain::attachments::{
    AttachmentAccessInput, AttachmentOwnerInput, AttachmentRecord, PickAttachmentInput,
};
use crate::error::{AppError, CommandError};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const ALLOWED_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "txt", "rtf", "csv",
    "json", "doc", "docx", "xls", "xlsx", "odt", "ods",
];

#[tauri::command]
pub async fn list_attachments(
    input: AttachmentOwnerInput,
    state: State<'_, AppState>,
) -> Result<Vec<AttachmentRecord>, CommandError> {
    state
        .attachment_service
        .list(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn pick_attachment(
    input: PickAttachmentInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<AttachmentRecord>, CommandError> {
    state
        .attachment_service
        .ensure_owner_can_accept(&input)
        .await?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择要保存到 HomeLedger 的附件")
        .add_filter("支持的文档与图片", ALLOWED_EXTENSIONS)
        .pick_file(move |selected| {
            let _ = sender.send(selected);
        });
    let selected = receiver
        .await
        .map_err(|error| AppError::attachment(format!("附件选择器未能返回结果：{error}")))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| AppError::attachment(format!("所选附件路径无效：{error}")))?;
    state
        .attachment_service
        .add_from_path(input, &path)
        .await
        .map(Some)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn open_attachment(
    input: AttachmentAccessInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let path = state.attachment_service.resolve_open_path(input).await?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::attachment(format!("无法使用系统程序打开附件：{error}")))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_attachment(
    input: AttachmentAccessInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .attachment_service
        .unlink(input)
        .await
        .map_err(Into::into)
}
