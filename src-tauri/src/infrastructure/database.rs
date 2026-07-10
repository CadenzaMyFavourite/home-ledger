use crate::error::AppError;
use sqlx::SqlitePool;
use sqlx::migrate::Migrator;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use std::path::Path;
use std::time::Duration;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn open_database(path: &Path) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(10));

    let pool = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await?;

    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[tokio::test]
    async fn migrations_create_seeded_local_database() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("test.sqlite3"))
            .await
            .expect("migrations should run");

        let setting_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM app_settings")
            .fetch_one(&database)
            .await
            .expect("query settings")
            .get("count");
        let foreign_keys: i64 = sqlx::query("PRAGMA foreign_keys")
            .fetch_one(&database)
            .await
            .expect("query pragma")
            .get(0);

        assert_eq!(setting_count, 9);
        assert_eq!(foreign_keys, 1);
    }
}
