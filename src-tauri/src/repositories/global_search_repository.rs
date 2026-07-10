use crate::domain::global_search::{
    GlobalSearchInput, GlobalSearchKind, GlobalSearchPage, GlobalSearchResult,
};
use crate::error::AppError;
use sqlx::{Row, SqlitePool};

const SEARCH_ROWS: &str = r#"
SELECT 'transaction' AS kind, t.id, 'transaction' AS owner_type, t.id AS owner_id,
       COALESCE(NULLIF(t.merchant, ''), NULLIF(t.note, ''), t.transaction_date) AS title,
       trim(COALESCE(c.name, '') || CASE WHEN c.name IS NOT NULL AND pm.display_name IS NOT NULL THEN ' · ' ELSE '' END || COALESCE(pm.display_name, '')) AS subtitle,
       t.transaction_date AS occurred_on
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
LEFT JOIN household_members hm ON hm.id = t.household_member_id
LEFT JOIN locations l ON l.id = t.location_id
WHERE t.deleted_at IS NULL AND (
    t.merchant LIKE :pattern ESCAPE '\' OR t.note LIKE :pattern ESCAPE '\' OR
    c.name LIKE :pattern ESCAPE '\' OR pm.display_name LIKE :pattern ESCAPE '\' OR
    pm.institution LIKE :pattern ESCAPE '\' OR hm.display_name LIKE :pattern ESCAPE '\' OR
    l.name LIKE :pattern ESCAPE '\' OR l.city LIKE :pattern ESCAPE '\' OR
    EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tag ON tag.id = tt.tag_id WHERE tt.transaction_id = t.id AND tag.name LIKE :pattern ESCAPE '\') OR
    EXISTS (SELECT 1 FROM transaction_tax_tags ttt JOIN tax_tags tax ON tax.id = ttt.tax_tag_id WHERE ttt.transaction_id = t.id AND tax.name LIKE :pattern ESCAPE '\') OR
    EXISTS (SELECT 1 FROM transaction_attachments ta JOIN attachments a ON a.id = ta.attachment_id WHERE ta.transaction_id = t.id AND a.deleted_at IS NULL AND a.original_filename LIKE :pattern ESCAPE '\')
)
UNION ALL
SELECT 'event' AS kind, e.id, 'event' AS owner_type, e.id AS owner_id,
       e.title, trim(e.event_type || CASE WHEN l.name IS NOT NULL THEN ' · ' || l.name ELSE '' END) AS subtitle,
       COALESCE(e.start_date, substr(e.start_at_utc, 1, 10)) AS occurred_on
FROM calendar_events e
LEFT JOIN household_members hm ON hm.id = e.household_member_id
LEFT JOIN locations l ON l.id = e.location_id
WHERE e.deleted_at IS NULL AND (
    e.title LIKE :pattern ESCAPE '\' OR e.description LIKE :pattern ESCAPE '\' OR
    hm.display_name LIKE :pattern ESCAPE '\' OR l.name LIKE :pattern ESCAPE '\' OR
    l.city LIKE :pattern ESCAPE '\' OR
    EXISTS (SELECT 1 FROM event_tags et JOIN tags tag ON tag.id = et.tag_id WHERE et.event_id = e.id AND tag.name LIKE :pattern ESCAPE '\') OR
    EXISTS (SELECT 1 FROM event_attachments ea JOIN attachments a ON a.id = ea.attachment_id WHERE ea.event_id = e.id AND a.deleted_at IS NULL AND a.original_filename LIKE :pattern ESCAPE '\')
)
UNION ALL
SELECT 'attachment' AS kind, a.id, 'transaction' AS owner_type, ta.transaction_id AS owner_id,
       a.original_filename, COALESCE(NULLIF(t.merchant, ''), NULLIF(t.note, ''), t.transaction_date) AS subtitle,
       t.transaction_date AS occurred_on
FROM attachments a
JOIN transaction_attachments ta ON ta.attachment_id = a.id
JOIN transactions t ON t.id = ta.transaction_id AND t.deleted_at IS NULL
WHERE a.deleted_at IS NULL AND a.original_filename LIKE :pattern ESCAPE '\'
UNION ALL
SELECT 'attachment' AS kind, a.id, 'event' AS owner_type, ea.event_id AS owner_id,
       a.original_filename, e.title AS subtitle,
       COALESCE(e.start_date, substr(e.start_at_utc, 1, 10)) AS occurred_on
FROM attachments a
JOIN event_attachments ea ON ea.attachment_id = a.id
JOIN calendar_events e ON e.id = ea.event_id AND e.deleted_at IS NULL
WHERE a.deleted_at IS NULL AND a.original_filename LIKE :pattern ESCAPE '\'
"#;

#[derive(Clone)]
pub struct GlobalSearchRepository {
    database: SqlitePool,
}

impl GlobalSearchRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn search(&self, input: &GlobalSearchInput) -> Result<GlobalSearchPage, AppError> {
        let (pattern, limit, offset) = input.validated()?;
        let pattern_binding_count = SEARCH_ROWS.matches(":pattern").count();
        let search_rows = SEARCH_ROWS.replace(":pattern", "?");
        let count_sql = format!("SELECT COUNT(*) FROM ({search_rows}) results");
        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
        for _ in 0..pattern_binding_count {
            count_query = count_query.bind(&pattern);
        }
        let total = count_query.fetch_one(&self.database).await?;
        let page_sql = format!(
            "SELECT kind, id, owner_type, owner_id, title, NULLIF(subtitle, '') AS subtitle, occurred_on
             FROM ({search_rows}) results
             ORDER BY occurred_on DESC, kind, title, id LIMIT ? OFFSET ?"
        );
        let mut page_query = sqlx::query(&page_sql);
        for _ in 0..pattern_binding_count {
            page_query = page_query.bind(&pattern);
        }
        let rows = page_query
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.database)
            .await?;
        let records = rows
            .into_iter()
            .map(|row| {
                let kind: String = row.get("kind");
                Ok(GlobalSearchResult {
                    kind: match kind.as_str() {
                        "transaction" => GlobalSearchKind::Transaction,
                        "event" => GlobalSearchKind::Event,
                        "attachment" => GlobalSearchKind::Attachment,
                        _ => return Err(AppError::conflict("全局搜索返回了未知结果类型")),
                    },
                    id: row.get("id"),
                    owner_type: row.get("owner_type"),
                    owner_id: row.get("owner_id"),
                    title: row.get("title"),
                    subtitle: row.get("subtitle"),
                    occurred_on: row.get("occurred_on"),
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(GlobalSearchPage { records, total })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn search_groups_transactions_events_tags_and_attachments_without_wildcard_injection() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("global-search.sqlite3"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, merchant, note, origin,
                version, created_at, updated_at
             ) VALUES ('tx-search', '2026-07-01', 'expense', 'completed', 1234, 'CAD',
                       1234, 'CAD', 'Costco Richmond Hill', 'weekly groceries', 'manual', 1,
                       '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO calendar_events(
                id, title, description, event_type, is_all_day, start_date, end_date_exclusive,
                timezone_id, priority, is_completed, version, created_at, updated_at
             ) VALUES ('event-search', 'Vancouver family trip', 'Summer travel', 'travel', 1,
                       '2026-07-10', '2026-07-15', 'America/Toronto', 'important', 0, 1,
                       '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO tags(id, name, is_active, created_at, updated_at)
             VALUES ('tag-school', 'School', 1, '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_tags(transaction_id, tag_id, created_at)
             VALUES ('tx-search', 'tag-school', '2026-07-01T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO attachments(
                id, original_filename, stored_filename, relative_path, mime_type, file_size,
                sha256, attachment_type, created_at
             ) VALUES ('attachment-search', 'costco-receipt.pdf', 'managed.pdf',
                       'attachments/2026/07/managed.pdf', 'application/pdf', 10, ?, 'receipt',
                       '2026-07-01T12:00:00Z')",
        )
        .bind("0".repeat(64))
        .execute(&database)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_attachments(transaction_id, attachment_id, created_at)
             VALUES ('tx-search', 'attachment-search', '2026-07-01T12:00:00Z')",
        )
        .execute(&database)
        .await
        .unwrap();

        let repository = GlobalSearchRepository::new(database);
        for (query, expected_kind) in [
            ("Richmond", GlobalSearchKind::Transaction),
            ("Vancouver", GlobalSearchKind::Event),
            ("School", GlobalSearchKind::Transaction),
        ] {
            let page = repository
                .search(&GlobalSearchInput {
                    query: query.into(),
                    limit: None,
                    offset: None,
                })
                .await
                .unwrap();
            assert!(page.records.iter().any(|item| item.kind == expected_kind));
        }
        let attachments = repository
            .search(&GlobalSearchInput {
                query: "costco-receipt".into(),
                limit: None,
                offset: None,
            })
            .await
            .unwrap();
        assert!(
            attachments
                .records
                .iter()
                .any(|item| item.kind == GlobalSearchKind::Attachment)
        );
        assert!(
            attachments
                .records
                .iter()
                .any(|item| item.kind == GlobalSearchKind::Transaction)
        );
        let wildcard = repository
            .search(&GlobalSearchInput {
                query: "%%".into(),
                limit: None,
                offset: None,
            })
            .await
            .unwrap();
        assert_eq!(wildcard.total, 0);
    }
}
