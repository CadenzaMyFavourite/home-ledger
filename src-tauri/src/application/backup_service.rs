use crate::domain::backup::{
    BackupIdInput, BackupRecord, BackupVerificationResult, StageRestoreInput, StageRestoreResult,
};
use crate::error::AppError;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

const FORMAT_VERSION: i64 = 1;
const LOGICAL_JSON_VERSION: i64 = 1;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const PENDING_MARKER: &str = "restore-pending.json";
const APPLIED_MARKER: &str = "restore-applied.json";

#[derive(Clone)]
pub struct BackupService {
    database: SqlitePool,
    app_data_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: i64,
    logical_json_schema_version: i64,
    schema_version: i64,
    app_version: String,
    created_at: String,
    backup_id: String,
    files: Vec<ManifestFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    relative_path: String,
    file_size: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreMarker {
    backup_id: String,
    backup_filename: String,
    backup_type: String,
    pre_restore_backup_id: String,
    pre_restore_filename: String,
    stage_directory: String,
    created_at: String,
}

impl BackupService {
    pub fn new(database: SqlitePool, app_data_dir: PathBuf) -> Self {
        Self {
            database,
            app_data_dir,
        }
    }

    pub async fn list(&self) -> Result<Vec<BackupRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT id, backup_type, format_version, schema_version, app_version,
                    relative_path, status, total_size, created_at, verified_at, failure_code
             FROM backup_records ORDER BY created_at DESC, id DESC",
        )
        .fetch_all(&self.database)
        .await?;
        Ok(rows.iter().map(map_backup_record).collect())
    }

    pub async fn create_manual(&self) -> Result<BackupRecord, AppError> {
        self.create("manual").await
    }

    pub async fn run_scheduled_if_due(&self) -> Result<Option<BackupRecord>, AppError> {
        let value: String = sqlx::query_scalar(
            "SELECT value_json FROM app_settings WHERE key = 'auto_backup_policy'",
        )
        .fetch_one(&self.database)
        .await?;
        let policy: crate::domain::settings::AutoBackupPolicy = serde_json::from_str(&value)?;
        if !policy.enabled {
            return Ok(None);
        }
        let latest: Option<String> = sqlx::query_scalar(
            "SELECT created_at FROM backup_records WHERE backup_type = 'scheduled'
             AND status IN ('complete', 'verified') ORDER BY created_at DESC LIMIT 1",
        )
        .fetch_optional(&self.database)
        .await?;
        if latest
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
            .is_some_and(|last| {
                Utc::now()
                    .signed_duration_since(last.with_timezone(&Utc))
                    .num_days()
                    < i64::from(policy.interval_days)
            })
        {
            return Ok(None);
        }
        let record = self.create("scheduled").await?;
        self.prune_scheduled(usize::from(policy.retention_count))
            .await?;
        Ok(Some(record))
    }

    async fn prune_scheduled(&self, keep: usize) -> Result<(), AppError> {
        let rows = sqlx::query(
            "SELECT id, relative_path FROM backup_records WHERE backup_type = 'scheduled'
             AND status IN ('complete', 'verified') ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?",
        ).bind(keep as i64).fetch_all(&self.database).await?;
        for row in rows {
            let id: String = row.get("id");
            let filename: String = row.get("relative_path");
            if Path::new(&filename).file_name().and_then(|v| v.to_str()) != Some(filename.as_str())
            {
                return Err(AppError::backup("备份历史包含不安全的相对路径"));
            }
            let path = self.app_data_dir.join("backups").join(&filename);
            if path.exists() {
                fs::remove_file(&path).map_err(io_backup)?;
            }
            sqlx::query("DELETE FROM backup_records WHERE id = ?")
                .bind(id)
                .execute(&self.database)
                .await?;
        }
        Ok(())
    }

    async fn create(&self, backup_type: &str) -> Result<BackupRecord, AppError> {
        let backup_id = Uuid::now_v7().to_string();
        let created_at = Utc::now().to_rfc3339();
        let backups_dir = self.app_data_dir.join("backups");
        fs::create_dir_all(&backups_dir)
            .map_err(|error| AppError::backup(format!("无法创建备份目录：{error}")))?;
        let filename = format!(
            "HomeLedger-{}-{}.homeledger-backup",
            Utc::now().format("%Y%m%d-%H%M%S"),
            &backup_id[backup_id.len() - 8..]
        );
        let destination = backups_dir.join(&filename);
        let temporary = backups_dir.join(format!(".{backup_id}.tmp"));
        let work_dir = backups_dir.join(format!(".{backup_id}.work"));
        fs::create_dir_all(&work_dir)
            .map_err(|error| AppError::backup(format!("无法创建备份临时目录：{error}")))?;
        let snapshot_path = work_dir.join("home-ledger.sqlite3");
        let result = async {
            self.create_sqlite_snapshot(&snapshot_path).await?;
            let logical_json = self.build_logical_json(&created_at).await?;
            let schema_version = current_schema_version(&self.database).await?;
            let mut files = Vec::new();
            files.push(manifest_entry(
                "database/home-ledger.sqlite3",
                &fs::read(&snapshot_path).map_err(io_backup)?,
            )?);
            files.push(manifest_entry("data/homeledger.json", &logical_json)?);
            let attachments = self.collect_attachment_files().await?;
            for (relative, path) in &attachments {
                files.push(manifest_entry(
                    &format!("attachments/{relative}"),
                    &fs::read(path).map_err(io_backup)?,
                )?);
            }
            files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
            let manifest = BackupManifest {
                format_version: FORMAT_VERSION,
                logical_json_schema_version: LOGICAL_JSON_VERSION,
                schema_version,
                app_version: APP_VERSION.to_owned(),
                created_at: created_at.clone(),
                backup_id: backup_id.clone(),
                files: files.clone(),
            };
            write_backup_zip(
                &temporary,
                &snapshot_path,
                &logical_json,
                &attachments,
                &manifest,
            )?;
            fs::rename(&temporary, &destination)
                .map_err(|error| AppError::backup(format!("无法完成备份文件原子替换：{error}")))?;
            let total_size = fs::metadata(&destination).map_err(io_backup)?.len() as i64;
            let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
            let manifest_hash = sha256(&manifest_bytes);
            let logical_hash = sha256(&logical_json);
            let mut transaction = self.database.begin().await?;
            sqlx::query(
                "INSERT INTO backup_records(
                    id, backup_type, format_version, schema_version, logical_json_schema_version,
                    app_version, relative_path, status, total_size, manifest_sha256,
                    logical_json_sha256, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?)",
            )
            .bind(&backup_id)
            .bind(backup_type)
            .bind(FORMAT_VERSION)
            .bind(schema_version)
            .bind(LOGICAL_JSON_VERSION)
            .bind(APP_VERSION)
            .bind(&filename)
            .bind(total_size)
            .bind(manifest_hash)
            .bind(logical_hash)
            .bind(&created_at)
            .execute(&mut *transaction)
            .await?;
            for file in &files {
                sqlx::query(
                    "INSERT INTO backup_files(backup_record_id, relative_path, file_size, sha256)
                     VALUES (?, ?, ?, ?)",
                )
                .bind(&backup_id)
                .bind(&file.relative_path)
                .bind(file.file_size as i64)
                .bind(&file.sha256)
                .execute(&mut *transaction)
                .await?;
            }
            transaction.commit().await?;
            self.get(&backup_id).await
        }
        .await;
        let _ = fs::remove_dir_all(&work_dir);
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub async fn verify(
        &self,
        input: &BackupIdInput,
    ) -> Result<BackupVerificationResult, AppError> {
        input.validate()?;
        let record = self.get(&input.backup_id).await?;
        let path = self.app_data_dir.join("backups").join(&record.filename);
        let result = verify_backup_file(&path, Some(&input.backup_id))?;
        let checked_at = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE backup_records SET status = 'verified', verified_at = ?, failure_code = NULL WHERE id = ?",
        )
        .bind(&checked_at)
        .bind(&input.backup_id)
        .execute(&self.database)
        .await?;
        Ok(BackupVerificationResult {
            backup_id: input.backup_id.clone(),
            valid: true,
            file_count: result.files.len(),
            total_size: result.files.iter().map(|file| file.file_size).sum(),
            checked_at,
        })
    }

    pub async fn stage_restore(
        &self,
        input: &StageRestoreInput,
    ) -> Result<StageRestoreResult, AppError> {
        input.validate()?;
        let pending_marker = self.app_data_dir.join(PENDING_MARKER);
        if pending_marker.exists() {
            return Err(AppError::conflict(
                "已有等待重启的恢复任务；请先重启应用完成恢复",
            ));
        }
        let record = self.get(&input.backup_id).await?;
        let backup_path = self.app_data_dir.join("backups").join(&record.filename);
        let manifest = verify_backup_file(&backup_path, Some(&input.backup_id))?;
        let current_schema = current_schema_version(&self.database).await?;
        if manifest.schema_version > current_schema {
            return Err(AppError::backup(
                "该备份由更高版本数据库创建，当前应用不能安全恢复",
            ));
        }
        let pre_restore = self.create("pre_restore").await?;
        let stage_dir = self
            .app_data_dir
            .join(format!("restore-staging-{}", Uuid::now_v7()));
        fs::create_dir_all(&stage_dir).map_err(io_backup)?;
        extract_restore_files(&backup_path, &stage_dir, &manifest)?;
        validate_snapshot(&stage_dir.join("home-ledger.sqlite3"), current_schema).await?;
        let marker = RestoreMarker {
            backup_id: input.backup_id.clone(),
            backup_filename: record.filename,
            backup_type: record.backup_type,
            pre_restore_backup_id: pre_restore.id.clone(),
            pre_restore_filename: pre_restore.filename,
            stage_directory: stage_dir.to_string_lossy().into_owned(),
            created_at: Utc::now().to_rfc3339(),
        };
        write_json_atomic(&pending_marker, &marker)?;
        Ok(StageRestoreResult {
            backup_id: input.backup_id.clone(),
            pre_restore_backup_id: pre_restore.id,
            restart_required: true,
        })
    }

    async fn get(&self, id: &str) -> Result<BackupRecord, AppError> {
        let row = sqlx::query(
            "SELECT id, backup_type, format_version, schema_version, app_version,
                    relative_path, status, total_size, created_at, verified_at, failure_code
             FROM backup_records WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("backup", "备份记录不存在"))?;
        Ok(map_backup_record(&row))
    }

    async fn collect_attachment_files(&self) -> Result<Vec<(String, PathBuf)>, AppError> {
        let stored_paths: Vec<String> = sqlx::query_scalar(
            "SELECT relative_path FROM attachments WHERE deleted_at IS NULL ORDER BY relative_path",
        )
        .fetch_all(&self.database)
        .await?;
        if stored_paths.is_empty() {
            return Ok(Vec::new());
        }

        let root = self.app_data_dir.join("attachments");
        let canonical_root = root
            .canonicalize()
            .map_err(|error| AppError::backup(format!("无法读取附件托管目录：{error}")))?;
        let mut result = Vec::with_capacity(stored_paths.len());
        for stored_path in stored_paths {
            let relative_path = Path::new(&stored_path);
            if relative_path.is_absolute()
                || relative_path
                    .components()
                    .any(|component| !matches!(component, std::path::Component::Normal(_)))
                || !stored_path.replace('\\', "/").starts_with("attachments/")
            {
                return Err(AppError::backup("数据库包含不安全的附件相对路径"));
            }
            let source = self.app_data_dir.join(relative_path);
            let canonical = source
                .canonicalize()
                .map_err(|error| AppError::backup(format!("托管附件缺失或无法读取：{error}")))?;
            if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
                return Err(AppError::backup("附件路径超出托管目录或不是普通文件"));
            }
            let archive_relative = canonical
                .strip_prefix(&canonical_root)
                .map_err(|_| AppError::backup("附件相对路径无效"))?
                .to_string_lossy()
                .replace('\\', "/");
            validate_archive_name(&format!("attachments/{archive_relative}"))?;
            result.push((archive_relative, canonical));
        }
        Ok(result)
    }

    async fn create_sqlite_snapshot(&self, destination: &Path) -> Result<(), AppError> {
        if destination.exists() {
            fs::remove_file(destination).map_err(io_backup)?;
        }
        sqlx::query("VACUUM INTO ?")
            .bind(destination.to_string_lossy().as_ref())
            .execute(&self.database)
            .await
            .map_err(|error| AppError::backup(format!("无法创建一致性数据库快照：{error}")))?;
        Ok(())
    }

    async fn build_logical_json(&self, exported_at: &str) -> Result<Vec<u8>, AppError> {
        let table_rows = sqlx::query(
            "SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations'
             ORDER BY name",
        )
        .fetch_all(&self.database)
        .await?;
        let mut tables = serde_json::Map::new();
        for row in table_rows {
            let table: String = row.get("name");
            let columns = sqlx::query(&format!("PRAGMA table_info({})", quote_identifier(&table)))
                .fetch_all(&self.database)
                .await?
                .into_iter()
                .map(|row| row.get::<String, _>("name"))
                .collect::<Vec<_>>();
            let args = columns
                .iter()
                .flat_map(|column| [quote_sql_string(column), quote_identifier(column)])
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT COALESCE(json_group_array(json_object({args})), json('[]')) FROM {}",
                quote_identifier(&table)
            );
            let json: String = sqlx::query_scalar(&sql).fetch_one(&self.database).await?;
            tables.insert(table, serde_json::from_str(&json)?);
        }
        let value = serde_json::json!({
            "formatVersion": LOGICAL_JSON_VERSION,
            "exportedAt": exported_at,
            "schemaVersion": current_schema_version(&self.database).await?,
            "tables": tables,
        });
        Ok(serde_json::to_vec_pretty(&value)?)
    }
}

pub fn apply_pending_restore(app_data_dir: &Path) -> Result<bool, AppError> {
    let pending_path = app_data_dir.join(PENDING_MARKER);
    if !pending_path.exists() {
        return Ok(false);
    }
    let marker: RestoreMarker =
        serde_json::from_slice(&fs::read(&pending_path).map_err(io_backup)?)?;
    let stage_dir = PathBuf::from(&marker.stage_directory);
    ensure_child_path(app_data_dir, &stage_dir)?;
    let staged_database = stage_dir.join("home-ledger.sqlite3");
    if !staged_database.is_file() {
        return Err(AppError::backup("恢复暂存数据库不存在"));
    }
    let database = app_data_dir.join("home-ledger.sqlite3");
    let rollback_database = app_data_dir.join("restore-rollback.sqlite3");
    let database_sidecars = sqlite_sidecars(&database);
    let rollback_database_sidecars = sqlite_sidecars(&rollback_database);
    let attachments = app_data_dir.join("attachments");
    let rollback_attachments = app_data_dir.join("restore-rollback-attachments");
    if rollback_database.exists()
        || rollback_database_sidecars.iter().any(|path| path.exists())
        || rollback_attachments.exists()
    {
        return Err(AppError::backup("检测到未清理的恢复回滚文件，已停止覆盖"));
    }
    if database.exists() {
        fs::rename(&database, &rollback_database).map_err(io_backup)?;
    }
    for (sidecar, rollback_sidecar) in database_sidecars
        .iter()
        .zip(rollback_database_sidecars.iter())
    {
        if sidecar.exists() {
            fs::rename(sidecar, rollback_sidecar).map_err(io_backup)?;
        }
    }
    if attachments.exists() {
        fs::rename(&attachments, &rollback_attachments).map_err(io_backup)?;
    }
    let staged_attachments = stage_dir.join("attachments");
    let swap = (|| -> Result<(), AppError> {
        fs::rename(&staged_database, &database).map_err(io_backup)?;
        if staged_attachments.exists() {
            fs::rename(&staged_attachments, &attachments).map_err(io_backup)?;
        } else {
            fs::create_dir_all(&attachments).map_err(io_backup)?;
        }
        write_json_atomic(&app_data_dir.join(APPLIED_MARKER), &marker)?;
        fs::remove_file(&pending_path).map_err(io_backup)?;
        Ok(())
    })();
    if let Err(error) = swap {
        let _ = fs::remove_file(&database);
        for sidecar in &database_sidecars {
            let _ = fs::remove_file(sidecar);
        }
        let _ = fs::remove_dir_all(&attachments);
        if rollback_database.exists() {
            let _ = fs::rename(&rollback_database, &database);
        }
        for (rollback_sidecar, sidecar) in rollback_database_sidecars
            .iter()
            .zip(database_sidecars.iter())
        {
            if rollback_sidecar.exists() {
                let _ = fs::rename(rollback_sidecar, sidecar);
            }
        }
        if rollback_attachments.exists() {
            let _ = fs::rename(&rollback_attachments, &attachments);
        }
        return Err(error);
    }
    Ok(true)
}

pub fn rollback_applied_restore(app_data_dir: &Path) -> Result<(), AppError> {
    let database = app_data_dir.join("home-ledger.sqlite3");
    let rollback_database = app_data_dir.join("restore-rollback.sqlite3");
    let database_sidecars = sqlite_sidecars(&database);
    let rollback_database_sidecars = sqlite_sidecars(&rollback_database);
    let attachments = app_data_dir.join("attachments");
    let rollback_attachments = app_data_dir.join("restore-rollback-attachments");
    for sidecar in &database_sidecars {
        let _ = fs::remove_file(sidecar);
    }
    if rollback_database.exists() {
        let _ = fs::remove_file(&database);
        fs::rename(&rollback_database, &database).map_err(io_backup)?;
    }
    for (rollback_sidecar, sidecar) in rollback_database_sidecars
        .iter()
        .zip(database_sidecars.iter())
    {
        if rollback_sidecar.exists() {
            let _ = fs::remove_file(sidecar);
            fs::rename(rollback_sidecar, sidecar).map_err(io_backup)?;
        }
    }
    if rollback_attachments.exists() {
        let _ = fs::remove_dir_all(&attachments);
        fs::rename(&rollback_attachments, &attachments).map_err(io_backup)?;
    }
    let _ = fs::remove_file(app_data_dir.join(APPLIED_MARKER));
    Ok(())
}

pub fn finalize_applied_restore(app_data_dir: &Path) -> Result<(), AppError> {
    let applied_path = app_data_dir.join(APPLIED_MARKER);
    if !applied_path.exists() {
        return Ok(());
    }
    let marker: RestoreMarker =
        serde_json::from_slice(&fs::read(&applied_path).map_err(io_backup)?)?;
    let stage_dir = PathBuf::from(marker.stage_directory);
    ensure_child_path(app_data_dir, &stage_dir)?;
    let _ = fs::remove_file(app_data_dir.join("restore-rollback.sqlite3"));
    let _ = fs::remove_file(app_data_dir.join("restore-rollback.sqlite3-wal"));
    let _ = fs::remove_file(app_data_dir.join("restore-rollback.sqlite3-shm"));
    let _ = fs::remove_dir_all(app_data_dir.join("restore-rollback-attachments"));
    let _ = fs::remove_dir_all(stage_dir);
    fs::remove_file(applied_path).map_err(io_backup)?;
    Ok(())
}

pub async fn reconcile_applied_restore(
    database: &SqlitePool,
    app_data_dir: &Path,
) -> Result<(), AppError> {
    let applied_path = app_data_dir.join(APPLIED_MARKER);
    if !applied_path.exists() {
        return Ok(());
    }
    let marker: RestoreMarker =
        serde_json::from_slice(&fs::read(&applied_path).map_err(io_backup)?)?;
    for (id, filename, backup_type) in [
        (
            &marker.backup_id,
            &marker.backup_filename,
            marker.backup_type.as_str(),
        ),
        (
            &marker.pre_restore_backup_id,
            &marker.pre_restore_filename,
            "pre_restore",
        ),
    ] {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM backup_records WHERE id = ?")
            .bind(id)
            .fetch_one(database)
            .await?;
        if exists != 0 {
            continue;
        }
        let path = app_data_dir.join("backups").join(filename);
        let manifest = verify_backup_file(&path, Some(id))?;
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
        let logical_file = manifest
            .files
            .iter()
            .find(|file| file.relative_path == "data/homeledger.json")
            .ok_or_else(|| AppError::backup("备份缺少完整 JSON 记录"))?;
        let total_size = fs::metadata(&path).map_err(io_backup)?.len() as i64;
        let mut transaction = database.begin().await?;
        sqlx::query(
            "INSERT INTO backup_records(
                id, backup_type, format_version, schema_version, logical_json_schema_version,
                app_version, relative_path, status, total_size, manifest_sha256,
                logical_json_sha256, created_at, verified_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(backup_type)
        .bind(manifest.format_version)
        .bind(manifest.schema_version)
        .bind(manifest.logical_json_schema_version)
        .bind(&manifest.app_version)
        .bind(filename)
        .bind(total_size)
        .bind(sha256(&manifest_bytes))
        .bind(&logical_file.sha256)
        .bind(&manifest.created_at)
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        for file in &manifest.files {
            sqlx::query(
                "INSERT INTO backup_files(backup_record_id, relative_path, file_size, sha256)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(id)
            .bind(&file.relative_path)
            .bind(file.file_size as i64)
            .bind(&file.sha256)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
    }
    Ok(())
}

async fn current_schema_version(database: &SqlitePool) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
            .fetch_one(database)
            .await?,
    )
}

async fn validate_snapshot(path: &Path, current_schema: i64) -> Result<(), AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await?;
    if integrity != "ok" {
        return Err(AppError::backup(format!(
            "备份数据库完整性检查失败：{integrity}"
        )));
    }
    let foreign_key_issues: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await?;
    if foreign_key_issues != 0 {
        return Err(AppError::backup("备份数据库存在外键错误"));
    }
    let schema = current_schema_version(&pool).await?;
    if schema > current_schema {
        return Err(AppError::backup("备份数据库版本高于当前应用"));
    }
    pool.close().await;
    Ok(())
}

fn verify_backup_file(path: &Path, expected_id: Option<&str>) -> Result<BackupManifest, AppError> {
    let file =
        File::open(path).map_err(|error| AppError::backup(format!("无法打开备份文件：{error}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| AppError::backup(format!("备份归档格式无效：{error}")))?;
    let manifest: BackupManifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| AppError::backup("备份缺少 manifest.json"))?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(io_backup)?;
        serde_json::from_slice(&bytes)?
    };
    if manifest.format_version != FORMAT_VERSION
        || manifest.logical_json_schema_version != LOGICAL_JSON_VERSION
    {
        return Err(AppError::backup("备份格式版本不受支持"));
    }
    if expected_id.is_some_and(|id| id != manifest.backup_id) {
        return Err(AppError::backup("备份 ID 与历史记录不一致"));
    }
    if !manifest
        .files
        .iter()
        .any(|file| file.relative_path == "database/home-ledger.sqlite3")
        || !manifest
            .files
            .iter()
            .any(|file| file.relative_path == "data/homeledger.json")
    {
        return Err(AppError::backup("备份缺少数据库或完整 JSON"));
    }
    for expected in &manifest.files {
        validate_archive_name(&expected.relative_path)?;
        let mut entry = archive
            .by_name(&expected.relative_path)
            .map_err(|_| AppError::backup(format!("备份缺少文件：{}", expected.relative_path)))?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(io_backup)?;
        if bytes.len() as u64 != expected.file_size || sha256(&bytes) != expected.sha256 {
            return Err(AppError::backup(format!(
                "备份文件校验失败：{}",
                expected.relative_path
            )));
        }
    }
    Ok(manifest)
}

fn write_backup_zip(
    path: &Path,
    snapshot: &Path,
    logical_json: &[u8],
    attachments: &[(String, PathBuf)],
    manifest: &BackupManifest,
) -> Result<(), AppError> {
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(io_backup)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", options)
        .map_err(zip_backup)?;
    zip.write_all(&serde_json::to_vec_pretty(manifest)?)
        .map_err(io_backup)?;
    zip.start_file("database/home-ledger.sqlite3", options)
        .map_err(zip_backup)?;
    zip.write_all(&fs::read(snapshot).map_err(io_backup)?)
        .map_err(io_backup)?;
    zip.start_file("data/homeledger.json", options)
        .map_err(zip_backup)?;
    zip.write_all(logical_json).map_err(io_backup)?;
    for (relative, source) in attachments {
        zip.start_file(format!("attachments/{relative}"), options)
            .map_err(zip_backup)?;
        zip.write_all(&fs::read(source).map_err(io_backup)?)
            .map_err(io_backup)?;
    }
    zip.finish()
        .map_err(zip_backup)?
        .sync_all()
        .map_err(io_backup)?;
    Ok(())
}

fn extract_restore_files(
    backup_path: &Path,
    stage_dir: &Path,
    manifest: &BackupManifest,
) -> Result<(), AppError> {
    let file = File::open(backup_path).map_err(io_backup)?;
    let mut archive = ZipArchive::new(file).map_err(zip_backup)?;
    for expected in &manifest.files {
        if expected.relative_path == "data/homeledger.json" {
            continue;
        }
        validate_archive_name(&expected.relative_path)?;
        let destination = if expected.relative_path == "database/home-ledger.sqlite3" {
            stage_dir.join("home-ledger.sqlite3")
        } else if let Some(relative) = expected.relative_path.strip_prefix("attachments/") {
            stage_dir.join("attachments").join(relative)
        } else {
            continue;
        };
        ensure_child_path(stage_dir, &destination)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(io_backup)?;
        }
        let mut entry = archive
            .by_name(&expected.relative_path)
            .map_err(zip_backup)?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination)
            .map_err(io_backup)?;
        std::io::copy(&mut entry, &mut output).map_err(io_backup)?;
        output.sync_all().map_err(io_backup)?;
    }
    Ok(())
}

fn manifest_entry(relative_path: &str, bytes: &[u8]) -> Result<ManifestFile, AppError> {
    validate_archive_name(relative_path)?;
    Ok(ManifestFile {
        relative_path: relative_path.to_owned(),
        file_size: bytes.len() as u64,
        sha256: sha256(bytes),
    })
}

fn validate_archive_name(value: &str) -> Result<(), AppError> {
    let path = Path::new(value);
    if value.contains('\\')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(AppError::backup("备份包含不安全的文件路径"));
    }
    Ok(())
}

fn ensure_child_path(root: &Path, candidate: &Path) -> Result<(), AppError> {
    let root = root
        .canonicalize()
        .map_err(|error| AppError::backup(format!("应用数据目录无效：{error}")))?;
    let absolute = if candidate.exists() {
        candidate.canonicalize().map_err(io_backup)?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| AppError::backup("恢复目标路径无效"))?;
        let parent = if parent.exists() {
            parent.canonicalize().map_err(io_backup)?
        } else {
            root.clone()
        };
        parent.join(
            candidate
                .file_name()
                .ok_or_else(|| AppError::backup("恢复文件名无效"))?,
        )
    };
    if !absolute.starts_with(root) {
        return Err(AppError::backup("恢复路径超出应用数据目录"));
    }
    Ok(())
}

fn write_json_atomic<T: Serialize>(destination: &Path, value: &T) -> Result<(), AppError> {
    let temporary = destination.with_extension(format!("{}.tmp", Uuid::now_v7()));
    let bytes = serde_json::to_vec_pretty(value)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(io_backup)?;
    file.write_all(&bytes).map_err(io_backup)?;
    file.sync_all().map_err(io_backup)?;
    fs::rename(&temporary, destination).map_err(io_backup)?;
    Ok(())
}

fn map_backup_record(row: &sqlx::sqlite::SqliteRow) -> BackupRecord {
    BackupRecord {
        id: row.get("id"),
        backup_type: row.get("backup_type"),
        format_version: row.get("format_version"),
        schema_version: row.get("schema_version"),
        app_version: row.get("app_version"),
        filename: row.get("relative_path"),
        status: row.get("status"),
        total_size: row.get("total_size"),
        created_at: row.get("created_at"),
        verified_at: row.get("verified_at"),
        failure_code: row.get("failure_code"),
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn io_backup(error: std::io::Error) -> AppError {
    AppError::backup(format!("备份文件操作失败：{error}"))
}

fn zip_backup(error: zip::result::ZipError) -> AppError {
    AppError::backup(format!("备份归档操作失败：{error}"))
}

fn sqlite_sidecars(database: &Path) -> [PathBuf; 2] {
    [
        path_with_suffix(database, "-wal"),
        path_with_suffix(database, "-shm"),
    ]
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    async fn insert_expense(database: &SqlitePool, id: &str, amount: i64) {
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, merchant, origin,
                version, created_at, updated_at
             ) VALUES (?, '2026-06-01', 'expense', 'completed', ?, 'CAD', ?, 'CAD',
                       'Backup test', 'manual', 1, '2026-06-01T12:00:00Z', '2026-06-01T12:00:00Z')",
        )
        .bind(id)
        .bind(amount)
        .bind(amount)
        .execute(database)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn backup_verifies_and_restore_replaces_database_after_restart_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(app_data.join("attachments/receipts")).unwrap();
        fs::write(
            app_data.join("attachments/receipts/example.txt"),
            b"receipt contents",
        )
        .unwrap();
        fs::write(
            app_data.join("attachments/receipts/.copy-in-progress.tmp"),
            b"partial file that must not be backed up",
        )
        .unwrap();
        let database_path = app_data.join("home-ledger.sqlite3");
        let database = open_database(&database_path).await.unwrap();
        sqlx::query(
            "INSERT INTO attachments(
                id, original_filename, stored_filename, relative_path, mime_type,
                file_size, sha256, attachment_type, created_at
             ) VALUES (
                'attachment-1', 'example.txt', 'example.txt', 'attachments/receipts/example.txt',
                'text/plain', ?, ?, 'receipt', '2026-06-01T12:00:00Z'
             )",
        )
        .bind(b"receipt contents".len() as i64)
        .bind(sha256(b"receipt contents"))
        .execute(&database)
        .await
        .unwrap();
        insert_expense(&database, "original", 12_345).await;
        let service = BackupService::new(database.clone(), app_data.clone());
        let backup = service.create_manual().await.unwrap();
        let verification = service
            .verify(&BackupIdInput {
                backup_id: backup.id.clone(),
            })
            .await
            .unwrap();
        assert!(verification.valid);
        assert_eq!(verification.file_count, 3);

        insert_expense(&database, "later", 99_999).await;
        let staged = service
            .stage_restore(&StageRestoreInput {
                backup_id: backup.id.clone(),
                confirmation_text: "RESTORE".into(),
            })
            .await
            .unwrap();
        assert!(staged.restart_required);
        drop(service);
        database.close().await;
        fs::write(
            app_data.join("home-ledger.sqlite3-wal"),
            b"stale wal frames",
        )
        .unwrap();
        fs::write(app_data.join("home-ledger.sqlite3-shm"), b"stale shm state").unwrap();

        assert!(apply_pending_restore(&app_data).unwrap());
        assert!(!app_data.join("home-ledger.sqlite3-wal").exists());
        assert!(!app_data.join("home-ledger.sqlite3-shm").exists());
        assert!(app_data.join("restore-rollback.sqlite3-wal").exists());
        assert!(app_data.join("restore-rollback.sqlite3-shm").exists());
        let restored = open_database(&database_path).await.unwrap();
        reconcile_applied_restore(&restored, &app_data)
            .await
            .unwrap();
        finalize_applied_restore(&app_data).unwrap();
        assert!(!app_data.join("restore-rollback.sqlite3-wal").exists());
        assert!(!app_data.join("restore-rollback.sqlite3-shm").exists());
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM transactions WHERE deleted_at IS NULL ORDER BY id")
                .fetch_all(&restored)
                .await
                .unwrap();
        assert_eq!(ids, ["original"]);
        assert_eq!(
            fs::read(app_data.join("attachments/receipts/example.txt")).unwrap(),
            b"receipt contents"
        );
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM backup_records WHERE id IN (?, ?)")
                .bind(&backup.id)
                .bind(&staged.pre_restore_backup_id)
                .fetch_one(&restored)
                .await
                .unwrap();
        assert_eq!(history_count, 2);
    }

    #[tokio::test]
    async fn truncated_backup_is_rejected_without_staging_restore() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let database = open_database(&app_data.join("home-ledger.sqlite3"))
            .await
            .unwrap();
        let service = BackupService::new(database, app_data.clone());
        let backup = service.create_manual().await.unwrap();
        let path = app_data.join("backups").join(&backup.filename);
        let mut bytes = fs::read(&path).unwrap();
        bytes.truncate(bytes.len() / 2);
        fs::write(&path, bytes).unwrap();
        assert!(
            service
                .verify(&BackupIdInput {
                    backup_id: backup.id,
                })
                .await
                .is_err()
        );
        assert!(!app_data.join(PENDING_MARKER).exists());
    }

    #[tokio::test]
    async fn scheduled_backup_respects_interval_and_only_prunes_scheduled_history() {
        let directory = tempfile::tempdir().unwrap();
        let app_data = directory.path().join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        let database = open_database(&app_data.join("home-ledger.sqlite3"))
            .await
            .unwrap();
        let service = BackupService::new(database.clone(), app_data.clone());
        let manual = service.create_manual().await.unwrap();
        sqlx::query("UPDATE app_settings SET value_json = ? WHERE key = 'auto_backup_policy'")
            .bind(r#"{"enabled":true,"intervalDays":7,"retentionCount":1}"#)
            .execute(&database)
            .await
            .unwrap();

        let first = service.run_scheduled_if_due().await.unwrap().unwrap();
        assert!(service.run_scheduled_if_due().await.unwrap().is_none());
        sqlx::query("UPDATE backup_records SET created_at = '2020-01-01T00:00:00Z' WHERE id = ?")
            .bind(&first.id)
            .execute(&database)
            .await
            .unwrap();

        let second = service.run_scheduled_if_due().await.unwrap().unwrap();
        let scheduled_ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM backup_records WHERE backup_type = 'scheduled' ORDER BY created_at DESC",
        )
        .fetch_all(&database)
        .await
        .unwrap();
        assert_eq!(scheduled_ids, [second.id]);
        assert!(!app_data.join("backups").join(first.filename).exists());
        assert!(app_data.join("backups").join(manual.filename).exists());
        let manual_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM backup_records WHERE id = ? AND backup_type = 'manual'",
        )
        .bind(manual.id)
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(manual_count, 1);
    }
}
