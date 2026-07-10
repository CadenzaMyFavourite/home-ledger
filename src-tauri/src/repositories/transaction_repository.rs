use crate::domain::transactions::{
    BatchCategoryUpdateInput, BatchEditTransactionsInput, BatchEditTransactionsResult,
    BatchTransactionConflict, BatchTransactionItemsInput, BatchTransactionMutationResult,
    CreateTransactionInput, ListTransactionsInput, SortDirection, TransactionMutationResult,
    TransactionPage, TransactionRecord, TransactionSortField, TransactionSuggestion,
    TransactionSuggestionInput, TransactionVersionInput, UndoBatchEditInput,
    UpdateTransactionInput,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use uuid::Uuid;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredNullableId {
    value: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTaxTag {
    tax_tag_id: String,
    selected: bool,
    source: Option<String>,
    confirmed_at: Option<String>,
    created_at: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchEditSnapshot {
    before_version: i64,
    after_version: i64,
    category: Option<StoredNullableId>,
    payment_method: Option<StoredNullableId>,
    household_member: Option<StoredNullableId>,
    status: Option<String>,
    tax_tag: Option<StoredTaxTag>,
    review_flags: Option<Vec<String>>,
}

pub struct TransactionRepository {
    database: SqlitePool,
}

impl TransactionRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list(&self, input: &ListTransactionsInput) -> Result<TransactionPage, AppError> {
        let limit = input.validated_limit()?;
        let offset = input.offset.unwrap_or(0);
        let search = input
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(escape_like);

        let mut list_query = QueryBuilder::<Sqlite>::new(
            "SELECT t.id, t.transaction_date, t.transaction_type, t.status,
                    t.amount_minor, t.currency_code, t.category_id, c.name AS category_name,
                    t.payment_method_id, source.display_name AS payment_method_name,
                    t.transfer_to_payment_method_id, target.display_name AS transfer_to_payment_method_name,
                    t.transfer_to_amount_minor, t.transfer_to_currency_code,
                    t.household_member_id, hm.display_name AS household_member_name,
                    t.location_id, l.name AS location_name,
                    t.merchant, t.note, t.version, t.created_at, t.updated_at,
                    EXISTS(
                        SELECT 1 FROM review_flags rf
                        WHERE rf.transaction_id = t.id
                          AND rf.flag_type = 'possible_tax_candidate'
                          AND rf.status = 'open'
                    ) AS has_possible_tax_hint
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN payment_methods source ON source.id = t.payment_method_id
             LEFT JOIN payment_methods target ON target.id = t.transfer_to_payment_method_id
             LEFT JOIN household_members hm ON hm.id = t.household_member_id
             LEFT JOIN locations l ON l.id = t.location_id ",
        );
        push_transaction_filters(&mut list_query, input, search.as_deref());
        list_query.push(transaction_order_clause(input));
        list_query.push(" LIMIT ").push_bind(limit);
        list_query.push(" OFFSET ").push_bind(offset);
        let rows = list_query.build().fetch_all(&self.database).await?;

        let mut count_query = QueryBuilder::<Sqlite>::new(
            "SELECT COUNT(*)
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN payment_methods source ON source.id = t.payment_method_id ",
        );
        push_transaction_filters(&mut count_query, input, search.as_deref());
        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.database)
            .await?;

        Ok(TransactionPage {
            records: rows.iter().map(map_transaction).collect(),
            total,
        })
    }

    pub async fn suggest(
        &self,
        input: &TransactionSuggestionInput,
    ) -> Result<TransactionSuggestion, AppError> {
        let row = sqlx::query(
            "WITH matching AS (
                SELECT t.transaction_date, t.updated_at, t.amount_minor, t.note,
                       CASE WHEN c.is_active = 1 THEN t.category_id END AS category_id,
                       CASE WHEN pm.is_active = 1 THEN t.payment_method_id END AS payment_method_id,
                       CASE WHEN hm.is_active = 1 THEN t.household_member_id END AS household_member_id,
                       CASE WHEN l.is_active = 1 THEN t.location_id END AS location_id
                FROM transactions t
                LEFT JOIN categories c ON c.id = t.category_id
                LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
                LEFT JOIN household_members hm ON hm.id = t.household_member_id
                LEFT JOIN locations l ON l.id = t.location_id
                WHERE t.deleted_at IS NULL AND t.status = 'completed'
                  AND t.transaction_type = ? AND t.merchant = ? COLLATE NOCASE
             )
             SELECT
                (SELECT COUNT(*) FROM matching) AS matched_count,
                (SELECT category_id FROM matching WHERE category_id IS NOT NULL
                 GROUP BY category_id ORDER BY COUNT(*) DESC, MAX(transaction_date) DESC, MAX(updated_at) DESC LIMIT 1)
                    AS category_id,
                (SELECT payment_method_id FROM matching WHERE payment_method_id IS NOT NULL
                 GROUP BY payment_method_id ORDER BY COUNT(*) DESC, MAX(transaction_date) DESC, MAX(updated_at) DESC LIMIT 1)
                    AS payment_method_id,
                (SELECT household_member_id FROM matching WHERE household_member_id IS NOT NULL
                 GROUP BY household_member_id ORDER BY COUNT(*) DESC, MAX(transaction_date) DESC, MAX(updated_at) DESC LIMIT 1)
                    AS household_member_id,
                (SELECT location_id FROM matching WHERE location_id IS NOT NULL
                 GROUP BY location_id ORDER BY COUNT(*) DESC, MAX(transaction_date) DESC, MAX(updated_at) DESC LIMIT 1)
                    AS location_id,
                (SELECT amount_minor FROM matching
                 GROUP BY amount_minor ORDER BY COUNT(*) DESC, MAX(transaction_date) DESC, MAX(updated_at) DESC LIMIT 1)
                    AS amount_minor,
                (SELECT note FROM matching WHERE note IS NOT NULL AND trim(note) <> ''
                 ORDER BY transaction_date DESC, updated_at DESC LIMIT 1) AS note",
        )
        .bind(input.transaction_type.as_str())
        .bind(input.merchant.trim())
        .fetch_one(&self.database)
        .await?;
        Ok(TransactionSuggestion {
            matched_count: row.get("matched_count"),
            category_id: row.get("category_id"),
            payment_method_id: row.get("payment_method_id"),
            household_member_id: row.get("household_member_id"),
            location_id: row.get("location_id"),
            amount_minor: row.get("amount_minor"),
            note: row.get("note"),
        })
    }

    pub async fn create(
        &self,
        input: &CreateTransactionInput,
        reporting_amount_minor: Option<i64>,
        reporting_currency_code: Option<&str>,
        review_flag_types: &[&str],
    ) -> Result<TransactionRecord, AppError> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;

        sqlx::query(
            "INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, category_id, payment_method_id,
                transfer_to_payment_method_id, transfer_to_amount_minor, transfer_to_currency_code,
                household_member_id, location_id, merchant, note, origin, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?)",
        )
        .bind(&id)
        .bind(&input.transaction_date)
        .bind(input.transaction_type.as_str())
        .bind(input.status.as_str())
        .bind(input.amount_minor)
        .bind(&input.currency_code)
        .bind(reporting_amount_minor)
        .bind(reporting_currency_code)
        .bind(&input.category_id)
        .bind(&input.payment_method_id)
        .bind(&input.transfer_to_payment_method_id)
        .bind(input.transfer_to_amount_minor)
        .bind(&input.transfer_to_currency_code)
        .bind(&input.household_member_id)
        .bind(&input.location_id)
        .bind(input.merchant.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(input.note.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;

        for flag_type in review_flag_types {
            sqlx::query(
                "INSERT INTO review_flags(
                    id, transaction_id, flag_type, severity, detector_version,
                    details_json, status, created_at, updated_at
                 ) VALUES (?, ?, ?, 'info', 1, '{}', 'open', ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&id)
            .bind(flag_type)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }

        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, after_json
             ) VALUES (?, ?, 'user', 'create', 'transaction', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&id)
        .bind(
            serde_json::json!({
                "transactionDate": input.transaction_date,
                "transactionType": input.transaction_type.as_str(),
                "status": input.status.as_str(),
                "amountMinor": input.amount_minor,
                "currencyCode": input.currency_code,
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        self.get_by_id(&id).await
    }

    pub async fn update(
        &self,
        input: &UpdateTransactionInput,
        reporting_amount_minor: Option<i64>,
        reporting_currency_code: Option<&str>,
        review_flag_types: &[&str],
    ) -> Result<TransactionRecord, AppError> {
        let values = &input.transaction;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE transactions SET
                transaction_date = ?, transaction_type = ?, status = ?, amount_minor = ?,
                currency_code = ?, reporting_amount_minor = ?, reporting_currency_code = ?,
                category_id = ?, payment_method_id = ?, transfer_to_payment_method_id = ?,
                transfer_to_amount_minor = ?, transfer_to_currency_code = ?, household_member_id = ?,
                location_id = ?, merchant = ?, note = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(&values.transaction_date)
        .bind(values.transaction_type.as_str())
        .bind(values.status.as_str())
        .bind(values.amount_minor)
        .bind(&values.currency_code)
        .bind(reporting_amount_minor)
        .bind(reporting_currency_code)
        .bind(&values.category_id)
        .bind(&values.payment_method_id)
        .bind(&values.transfer_to_payment_method_id)
        .bind(values.transfer_to_amount_minor)
        .bind(&values.transfer_to_currency_code)
        .bind(&values.household_member_id)
        .bind(&values.location_id)
        .bind(values.merchant.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(values.note.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(&now)
        .bind(&input.id)
        .bind(input.version)
        .execute(&mut *transaction)
        .await?;

        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("这笔记录已被修改或删除，请刷新后重试。"));
        }

        sqlx::query(
            "UPDATE review_flags
             SET status = 'resolved', resolved_at = ?, updated_at = ?
             WHERE transaction_id = ?
               AND flag_type IN ('uncategorized', 'possible_tax_candidate')
               AND status = 'open'",
        )
        .bind(&now)
        .bind(&now)
        .bind(&input.id)
        .execute(&mut *transaction)
        .await?;
        insert_review_flags(&mut transaction, &input.id, review_flag_types, &now).await?;

        insert_audit_event(
            &mut transaction,
            "update",
            &input.id,
            serde_json::json!({
                "version": input.version + 1,
                "transactionDate": values.transaction_date,
                "transactionType": values.transaction_type.as_str(),
                "status": values.status.as_str(),
                "amountMinor": values.amount_minor,
                "currencyCode": values.currency_code,
            }),
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_by_id(&input.id).await
    }

    pub async fn soft_delete(
        &self,
        input: &TransactionVersionInput,
    ) -> Result<TransactionMutationResult, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE transactions
             SET deleted_at = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND version = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(&input.id)
        .bind(input.version)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict("这笔记录已被修改或删除，请刷新后重试。"));
        }

        insert_audit_event(
            &mut transaction,
            "soft_delete",
            &input.id,
            serde_json::json!({ "version": input.version + 1 }),
            &now,
        )
        .await?;
        transaction.commit().await?;
        Ok(TransactionMutationResult {
            id: input.id.clone(),
            version: input.version + 1,
        })
    }

    pub async fn restore(
        &self,
        input: &TransactionVersionInput,
    ) -> Result<TransactionRecord, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let result = sqlx::query(
            "UPDATE transactions
             SET deleted_at = NULL, updated_at = ?, version = version + 1
             WHERE id = ? AND version = ? AND deleted_at IS NOT NULL",
        )
        .bind(&now)
        .bind(&input.id)
        .bind(input.version)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::conflict(
                "这笔记录无法恢复，可能已经恢复或再次修改。",
            ));
        }

        insert_audit_event(
            &mut transaction,
            "restore",
            &input.id,
            serde_json::json!({ "version": input.version + 1 }),
            &now,
        )
        .await?;
        transaction.commit().await?;
        self.get_by_id(&input.id).await
    }

    pub async fn batch_update_category(
        &self,
        input: &BatchCategoryUpdateInput,
        category_type: Option<&str>,
        possible_tax_candidate: bool,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let mut results = Vec::with_capacity(input.items.len());
        for item in &input.items {
            let update_result = if let Some(category_type) = category_type {
                sqlx::query(
                    "UPDATE transactions
                     SET category_id = ?, version = version + 1, updated_at = ?
                     WHERE id = ? AND version = ? AND deleted_at IS NULL AND transaction_type = ?",
                )
                .bind(&input.category_id)
                .bind(&now)
                .bind(&item.id)
                .bind(item.version)
                .bind(category_type)
                .execute(&mut *transaction)
                .await?
            } else {
                sqlx::query(
                    "UPDATE transactions
                     SET category_id = NULL, version = version + 1, updated_at = ?
                     WHERE id = ? AND version = ? AND deleted_at IS NULL AND transaction_type <> 'transfer'",
                )
                .bind(&now)
                .bind(&item.id)
                .bind(item.version)
                .execute(&mut *transaction)
                .await?
            };
            if update_result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::conflict(
                    "批量分类失败：记录已变化，或所选分类与部分交易类型不一致。",
                ));
            }

            sqlx::query(
                "UPDATE review_flags
                 SET status = 'resolved', resolved_at = ?, updated_at = ?
                 WHERE transaction_id = ?
                   AND flag_type IN ('uncategorized', 'possible_tax_candidate')
                   AND status = 'open'",
            )
            .bind(&now)
            .bind(&now)
            .bind(&item.id)
            .execute(&mut *transaction)
            .await?;
            let status: String = sqlx::query_scalar("SELECT status FROM transactions WHERE id = ?")
                .bind(&item.id)
                .fetch_one(&mut *transaction)
                .await?;
            let mut flags = Vec::new();
            if input.category_id.is_none() && status == "completed" {
                flags.push("uncategorized");
            }
            if possible_tax_candidate {
                flags.push("possible_tax_candidate");
            }
            insert_review_flags(&mut transaction, &item.id, &flags, &now).await?;
            insert_audit_event(
                &mut transaction,
                "batch_update_category",
                &item.id,
                serde_json::json!({
                    "version": item.version + 1,
                    "categoryId": input.category_id.as_deref(),
                }),
                &now,
            )
            .await?;
            results.push(TransactionMutationResult {
                id: item.id.clone(),
                version: item.version + 1,
            });
        }
        transaction.commit().await?;
        Ok(BatchTransactionMutationResult { items: results })
    }

    pub async fn batch_edit(
        &self,
        input: &BatchEditTransactionsInput,
        category_type: Option<Option<String>>,
        possible_tax_candidate: bool,
    ) -> Result<BatchEditTransactionsResult, AppError> {
        if let Some(tax_tag) = input.patch.tax_tag.as_ref() {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM tax_tags tt
                 JOIN tax_profiles tp ON tp.id = tt.tax_profile_id
                 WHERE tt.id = ? AND tt.is_active = 1 AND tp.is_active = 1 AND tp.is_default = 1",
            )
            .bind(&tax_tag.tax_tag_id)
            .fetch_one(&self.database)
            .await?;
            if exists == 0 {
                return Err(AppError::not_found("tax_tag", "所选税务标签不存在或已停用"));
            }
        }

        let operation_id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let mut items = Vec::with_capacity(input.items.len());
        let mut conflicts = Vec::new();

        for item in &input.items {
            let row = sqlx::query(
                "SELECT version, transaction_type, status, category_id, payment_method_id,
                        transfer_to_payment_method_id, household_member_id, reporting_amount_minor
                 FROM transactions WHERE id = ? AND deleted_at IS NULL",
            )
            .bind(&item.id)
            .fetch_optional(&mut *transaction)
            .await?;
            let Some(row) = row else {
                conflicts.push(batch_conflict(
                    item,
                    None,
                    "not_found",
                    "记录不存在或已删除",
                ));
                continue;
            };
            let actual_version: i64 = row.get("version");
            if actual_version != item.version {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "version_conflict",
                    "记录已被其他操作修改，请刷新后重试",
                ));
                continue;
            }
            let transaction_type: String = row.get("transaction_type");
            let transfer_target: Option<String> = row.get("transfer_to_payment_method_id");
            if let Some(Some(expected_type)) = category_type.as_ref()
                && transaction_type != *expected_type
            {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "incompatible_category",
                    "所选分类与交易类型不一致",
                ));
                continue;
            }
            if input.patch.category.is_some() && transaction_type == "transfer" {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "transfer_category",
                    "转账不能设置分类",
                ));
                continue;
            }
            if let Some(payment_patch) = input.patch.payment_method.as_ref()
                && transaction_type == "transfer"
                && (payment_patch.value.is_none()
                    || payment_patch.value.as_ref() == transfer_target.as_ref())
            {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "invalid_transfer_account",
                    "转账必须保留不同的转出和转入账户",
                ));
                continue;
            }
            if input.patch.tax_tag.is_some() && transaction_type == "transfer" {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "transfer_tax_tag",
                    "转账不能设置税务标签",
                ));
                continue;
            }
            if input
                .patch
                .status
                .is_some_and(|status| status.as_str() == "completed")
                && transaction_type != "transfer"
                && row
                    .get::<Option<i64>, _>("reporting_amount_minor")
                    .is_none()
            {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "missing_reporting_amount",
                    "该记录缺少本位币金额，不能直接标记为已完成",
                ));
                continue;
            }

            let review_flags = if input.patch.category.is_some()
                || input.patch.status.is_some()
                || input.patch.tax_tag.is_some()
            {
                Some(
                    sqlx::query_scalar::<_, String>(
                        "SELECT flag_type FROM review_flags
                         WHERE transaction_id = ? AND status = 'open'
                           AND flag_type IN ('uncategorized', 'possible_tax_candidate', 'tax_review')
                         ORDER BY flag_type",
                    )
                    .bind(&item.id)
                    .fetch_all(&mut *transaction)
                    .await?,
                )
            } else {
                None
            };
            let tax_tag_before = if let Some(tax_patch) = input.patch.tax_tag.as_ref() {
                let tag_row = sqlx::query(
                    "SELECT source, confirmed_at, created_at FROM transaction_tax_tags
                     WHERE transaction_id = ? AND tax_tag_id = ?",
                )
                .bind(&item.id)
                .bind(&tax_patch.tax_tag_id)
                .fetch_optional(&mut *transaction)
                .await?;
                Some(if let Some(tag_row) = tag_row {
                    StoredTaxTag {
                        tax_tag_id: tax_patch.tax_tag_id.clone(),
                        selected: true,
                        source: Some(tag_row.get("source")),
                        confirmed_at: Some(tag_row.get("confirmed_at")),
                        created_at: Some(tag_row.get("created_at")),
                    }
                } else {
                    StoredTaxTag {
                        tax_tag_id: tax_patch.tax_tag_id.clone(),
                        selected: false,
                        source: None,
                        confirmed_at: None,
                        created_at: None,
                    }
                })
            } else {
                None
            };
            let snapshot =
                BatchEditSnapshot {
                    before_version: actual_version,
                    after_version: actual_version + 1,
                    category: input.patch.category.as_ref().map(|_| StoredNullableId {
                        value: row.get("category_id"),
                    }),
                    payment_method: input
                        .patch
                        .payment_method
                        .as_ref()
                        .map(|_| StoredNullableId {
                            value: row.get("payment_method_id"),
                        }),
                    household_member: input.patch.household_member.as_ref().map(|_| {
                        StoredNullableId {
                            value: row.get("household_member_id"),
                        }
                    }),
                    status: input.patch.status.map(|_| row.get("status")),
                    tax_tag: tax_tag_before,
                    review_flags,
                };

            let result = sqlx::query(
                "UPDATE transactions SET
                    category_id = CASE WHEN ? = 1 THEN ? ELSE category_id END,
                    payment_method_id = CASE WHEN ? = 1 THEN ? ELSE payment_method_id END,
                    household_member_id = CASE WHEN ? = 1 THEN ? ELSE household_member_id END,
                    status = CASE WHEN ? = 1 THEN ? ELSE status END,
                    version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(i64::from(input.patch.category.is_some()))
            .bind(
                input
                    .patch
                    .category
                    .as_ref()
                    .and_then(|patch| patch.value.as_deref()),
            )
            .bind(i64::from(input.patch.payment_method.is_some()))
            .bind(
                input
                    .patch
                    .payment_method
                    .as_ref()
                    .and_then(|patch| patch.value.as_deref()),
            )
            .bind(i64::from(input.patch.household_member.is_some()))
            .bind(
                input
                    .patch
                    .household_member
                    .as_ref()
                    .and_then(|patch| patch.value.as_deref()),
            )
            .bind(i64::from(input.patch.status.is_some()))
            .bind(input.patch.status.map(|status| status.as_str()))
            .bind(&now)
            .bind(&item.id)
            .bind(item.version)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                conflicts.push(batch_conflict(
                    item,
                    Some(actual_version),
                    "version_conflict",
                    "记录在批量操作期间发生变化",
                ));
                continue;
            }

            if let Some(tax_patch) = input.patch.tax_tag.as_ref() {
                if tax_patch.selected {
                    sqlx::query(
                        "INSERT INTO transaction_tax_tags(transaction_id, tax_tag_id, source, confirmed_at, created_at)
                         VALUES (?, ?, 'user', ?, ?)
                         ON CONFLICT(transaction_id, tax_tag_id)
                         DO UPDATE SET source = 'user', confirmed_at = excluded.confirmed_at",
                    )
                    .bind(&item.id)
                    .bind(&tax_patch.tax_tag_id)
                    .bind(&now)
                    .bind(&now)
                    .execute(&mut *transaction)
                    .await?;
                    if tax_patch.tax_tag_id != "00000000-0000-7000-8000-000000000212" {
                        resolve_review_flags(
                            &mut transaction,
                            &item.id,
                            &["possible_tax_candidate", "tax_review"],
                            &now,
                        )
                        .await?;
                    }
                } else {
                    sqlx::query(
                        "DELETE FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
                    )
                    .bind(&item.id)
                    .bind(&tax_patch.tax_tag_id)
                    .execute(&mut *transaction)
                    .await?;
                }
            }

            if input.patch.category.is_some() || input.patch.status.is_some() {
                resolve_review_flags(&mut transaction, &item.id, &["uncategorized"], &now).await?;
                let final_row = sqlx::query(
                    "SELECT status, transaction_type, category_id FROM transactions WHERE id = ?",
                )
                .bind(&item.id)
                .fetch_one(&mut *transaction)
                .await?;
                if final_row.get::<String, _>("status") == "completed"
                    && final_row.get::<String, _>("transaction_type") != "transfer"
                    && final_row.get::<Option<String>, _>("category_id").is_none()
                {
                    insert_review_flags(&mut transaction, &item.id, &["uncategorized"], &now)
                        .await?;
                }
            }
            if input.patch.category.is_some() {
                resolve_review_flags(
                    &mut transaction,
                    &item.id,
                    &["possible_tax_candidate"],
                    &now,
                )
                .await?;
                if possible_tax_candidate {
                    insert_review_flags(
                        &mut transaction,
                        &item.id,
                        &["possible_tax_candidate"],
                        &now,
                    )
                    .await?;
                }
            }

            sqlx::query(
                "INSERT INTO audit_events(
                    id, occurred_at, actor_type, action, entity_type, entity_id,
                    correlation_id, before_json, after_json
                 ) VALUES (?, ?, 'user', 'batch_edit_transaction', 'transaction', ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&now)
            .bind(&item.id)
            .bind(&operation_id)
            .bind(serde_json::to_string(&snapshot)?)
            .bind(
                serde_json::json!({
                    "version": actual_version + 1,
                    "patch": input.patch,
                })
                .to_string(),
            )
            .execute(&mut *transaction)
            .await?;
            items.push(TransactionMutationResult {
                id: item.id.clone(),
                version: actual_version + 1,
            });
        }
        transaction.commit().await?;
        Ok(BatchEditTransactionsResult {
            operation_id,
            items,
            conflicts,
        })
    }

    pub async fn undo_batch_edit(
        &self,
        input: &UndoBatchEditInput,
    ) -> Result<BatchEditTransactionsResult, AppError> {
        let operation_id = input.operation_id.clone();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let already_undone: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events
             WHERE correlation_id = ? AND action = 'undo_batch_edit'",
        )
        .bind(&operation_id)
        .fetch_one(&mut *transaction)
        .await?;
        if already_undone > 0 {
            return Err(AppError::conflict("这次批量编辑已经撤销"));
        }
        let audit_rows = sqlx::query(
            "SELECT entity_id, before_json FROM audit_events
             WHERE correlation_id = ? AND action = 'batch_edit_transaction'
             ORDER BY occurred_at, id",
        )
        .bind(&operation_id)
        .fetch_all(&mut *transaction)
        .await?;
        if audit_rows.is_empty() {
            return Err(AppError::not_found("batch_edit", "批量编辑操作不存在"));
        }
        let mut snapshots = Vec::with_capacity(audit_rows.len());
        let mut conflicts = Vec::new();
        for audit_row in audit_rows {
            let id: String = audit_row.get("entity_id");
            let before_json: String = audit_row.get("before_json");
            let snapshot: BatchEditSnapshot = serde_json::from_str(&before_json)?;
            let actual_version = sqlx::query_scalar::<_, i64>(
                "SELECT version FROM transactions WHERE id = ? AND deleted_at IS NULL",
            )
            .bind(&id)
            .fetch_optional(&mut *transaction)
            .await?;
            if actual_version != Some(snapshot.after_version) {
                conflicts.push(BatchTransactionConflict {
                    id: id.clone(),
                    expected_version: snapshot.after_version,
                    actual_version,
                    code: "undo_conflict".into(),
                    message: "批量编辑后这笔记录又发生了变化，未覆盖新数据".into(),
                });
            }
            snapshots.push((id, snapshot));
        }
        if !conflicts.is_empty() {
            transaction.rollback().await?;
            return Ok(BatchEditTransactionsResult {
                operation_id,
                items: Vec::new(),
                conflicts,
            });
        }

        let mut items = Vec::with_capacity(snapshots.len());
        for (id, snapshot) in snapshots {
            let restored_version = snapshot.after_version + 1;
            let result = sqlx::query(
                "UPDATE transactions SET
                    category_id = CASE WHEN ? = 1 THEN ? ELSE category_id END,
                    payment_method_id = CASE WHEN ? = 1 THEN ? ELSE payment_method_id END,
                    household_member_id = CASE WHEN ? = 1 THEN ? ELSE household_member_id END,
                    status = CASE WHEN ? = 1 THEN ? ELSE status END,
                    version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(i64::from(snapshot.category.is_some()))
            .bind(
                snapshot
                    .category
                    .as_ref()
                    .and_then(|value| value.value.as_deref()),
            )
            .bind(i64::from(snapshot.payment_method.is_some()))
            .bind(
                snapshot
                    .payment_method
                    .as_ref()
                    .and_then(|value| value.value.as_deref()),
            )
            .bind(i64::from(snapshot.household_member.is_some()))
            .bind(
                snapshot
                    .household_member
                    .as_ref()
                    .and_then(|value| value.value.as_deref()),
            )
            .bind(i64::from(snapshot.status.is_some()))
            .bind(snapshot.status.as_deref())
            .bind(&now)
            .bind(&id)
            .bind(snapshot.after_version)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::conflict("撤销期间记录发生变化，未覆盖任何新数据"));
            }
            if let Some(tag) = snapshot.tax_tag.as_ref() {
                if tag.selected {
                    sqlx::query(
                        "INSERT INTO transaction_tax_tags(transaction_id, tax_tag_id, source, confirmed_at, created_at)
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(transaction_id, tax_tag_id) DO UPDATE SET
                            source = excluded.source, confirmed_at = excluded.confirmed_at,
                            created_at = excluded.created_at",
                    )
                    .bind(&id)
                    .bind(&tag.tax_tag_id)
                    .bind(tag.source.as_deref().unwrap_or("user"))
                    .bind(tag.confirmed_at.as_deref().unwrap_or(&now))
                    .bind(tag.created_at.as_deref().unwrap_or(&now))
                    .execute(&mut *transaction)
                    .await?;
                } else {
                    sqlx::query(
                        "DELETE FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
                    )
                    .bind(&id)
                    .bind(&tag.tax_tag_id)
                    .execute(&mut *transaction)
                    .await?;
                }
            }
            if let Some(flags) = snapshot.review_flags.as_ref() {
                resolve_review_flags(
                    &mut transaction,
                    &id,
                    &["uncategorized", "possible_tax_candidate", "tax_review"],
                    &now,
                )
                .await?;
                let flag_refs = flags.iter().map(String::as_str).collect::<Vec<_>>();
                insert_review_flags(&mut transaction, &id, &flag_refs, &now).await?;
            }
            sqlx::query(
                "INSERT INTO audit_events(
                    id, occurred_at, actor_type, action, entity_type, entity_id,
                    correlation_id, before_json, after_json
                 ) VALUES (?, ?, 'user', 'undo_batch_edit_transaction', 'transaction', ?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&now)
            .bind(&id)
            .bind(&operation_id)
            .bind(serde_json::json!({ "version": snapshot.after_version }).to_string())
            .bind(
                serde_json::json!({
                    "version": restored_version,
                    "restoredFromVersion": snapshot.before_version,
                })
                .to_string(),
            )
            .execute(&mut *transaction)
            .await?;
            items.push(TransactionMutationResult {
                id,
                version: restored_version,
            });
        }
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, correlation_id, after_json
             ) VALUES (?, ?, 'user', 'undo_batch_edit', 'batch_edit', ?, ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(&operation_id)
        .bind(&operation_id)
        .bind(serde_json::json!({ "restoredCount": items.len() }).to_string())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(BatchEditTransactionsResult {
            operation_id,
            items,
            conflicts: Vec::new(),
        })
    }

    pub async fn batch_soft_delete(
        &self,
        input: &BatchTransactionItemsInput,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        self.batch_set_deleted(input, true).await
    }

    pub async fn batch_restore(
        &self,
        input: &BatchTransactionItemsInput,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        self.batch_set_deleted(input, false).await
    }

    async fn batch_set_deleted(
        &self,
        input: &BatchTransactionItemsInput,
        deleted: bool,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let mut results = Vec::with_capacity(input.items.len());
        for item in &input.items {
            let result = if deleted {
                sqlx::query(
                    "UPDATE transactions SET deleted_at = ?, updated_at = ?, version = version + 1
                     WHERE id = ? AND version = ? AND deleted_at IS NULL",
                )
                .bind(&now)
                .bind(&now)
                .bind(&item.id)
                .bind(item.version)
                .execute(&mut *transaction)
                .await?
            } else {
                sqlx::query(
                    "UPDATE transactions SET deleted_at = NULL, updated_at = ?, version = version + 1
                     WHERE id = ? AND version = ? AND deleted_at IS NOT NULL",
                )
                .bind(&now)
                .bind(&item.id)
                .bind(item.version)
                .execute(&mut *transaction)
                .await?
            };
            if result.rows_affected() != 1 {
                transaction.rollback().await?;
                return Err(AppError::conflict(if deleted {
                    "批量删除失败：至少一笔记录已被修改或删除。"
                } else {
                    "批量恢复失败：至少一笔记录已恢复或再次修改。"
                }));
            }
            insert_audit_event(
                &mut transaction,
                if deleted {
                    "batch_soft_delete"
                } else {
                    "batch_restore"
                },
                &item.id,
                serde_json::json!({ "version": item.version + 1 }),
                &now,
            )
            .await?;
            results.push(TransactionMutationResult {
                id: item.id.clone(),
                version: item.version + 1,
            });
        }
        transaction.commit().await?;
        Ok(BatchTransactionMutationResult { items: results })
    }

    async fn get_by_id(&self, id: &str) -> Result<TransactionRecord, AppError> {
        let row = sqlx::query(
            "SELECT t.id, t.transaction_date, t.transaction_type, t.status,
                    t.amount_minor, t.currency_code, t.category_id, c.name AS category_name,
                    t.payment_method_id, source.display_name AS payment_method_name,
                    t.transfer_to_payment_method_id, target.display_name AS transfer_to_payment_method_name,
                    t.transfer_to_amount_minor, t.transfer_to_currency_code,
                    t.household_member_id, hm.display_name AS household_member_name,
                    t.location_id, l.name AS location_name,
                    t.merchant, t.note, t.version, t.created_at, t.updated_at,
                    EXISTS(
                        SELECT 1 FROM review_flags rf
                        WHERE rf.transaction_id = t.id
                          AND rf.flag_type = 'possible_tax_candidate'
                          AND rf.status = 'open'
                    ) AS has_possible_tax_hint
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN payment_methods source ON source.id = t.payment_method_id
             LEFT JOIN payment_methods target ON target.id = t.transfer_to_payment_method_id
             LEFT JOIN household_members hm ON hm.id = t.household_member_id
             LEFT JOIN locations l ON l.id = t.location_id
             WHERE t.id = ? AND t.deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("transaction", "交易记录不存在"))?;
        Ok(map_transaction(&row))
    }
}

async fn insert_review_flags(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    transaction_id: &str,
    review_flag_types: &[&str],
    now: &str,
) -> Result<(), AppError> {
    for flag_type in review_flag_types {
        sqlx::query(
            "INSERT INTO review_flags(
                id, transaction_id, flag_type, severity, detector_version,
                details_json, status, created_at, updated_at
             ) VALUES (?, ?, ?, 'info', 1, '{}', 'open', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(transaction_id)
        .bind(flag_type)
        .bind(now)
        .bind(now)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn resolve_review_flags(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    transaction_id: &str,
    review_flag_types: &[&str],
    now: &str,
) -> Result<(), AppError> {
    for flag_type in review_flag_types {
        sqlx::query(
            "UPDATE review_flags SET status = 'resolved', resolved_at = ?, updated_at = ?
             WHERE transaction_id = ? AND flag_type = ? AND status = 'open'",
        )
        .bind(now)
        .bind(now)
        .bind(transaction_id)
        .bind(flag_type)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

fn batch_conflict(
    item: &TransactionVersionInput,
    actual_version: Option<i64>,
    code: &str,
    message: &str,
) -> BatchTransactionConflict {
    BatchTransactionConflict {
        id: item.id.clone(),
        expected_version: item.version,
        actual_version,
        code: code.into(),
        message: message.into(),
    }
}

async fn insert_audit_event(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    entity_id: &str,
    after: serde_json::Value,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(
            id, occurred_at, actor_type, action, entity_type, entity_id, after_json
         ) VALUES (?, ?, 'user', ?, 'transaction', ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(entity_id)
    .bind(after.to_string())
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn push_transaction_filters<'a>(
    query: &mut QueryBuilder<'a, Sqlite>,
    input: &'a ListTransactionsInput,
    search: Option<&str>,
) {
    query.push(" WHERE t.deleted_at IS NULL");
    if let Some(id) = input.id.as_deref() {
        query.push(" AND t.id = ").push_bind(id);
    }
    if let Some(transaction_type) = input.transaction_type.as_ref() {
        query
            .push(" AND t.transaction_type = ")
            .push_bind(transaction_type.as_str());
    }
    if let Some(status) = input.status.as_ref() {
        query.push(" AND t.status = ").push_bind(status.as_str());
    }
    if let Some(date_from) = input.date_from.as_deref() {
        query
            .push(" AND t.transaction_date >= ")
            .push_bind(date_from);
    }
    if let Some(date_to) = input.date_to.as_deref() {
        query.push(" AND t.transaction_date <= ").push_bind(date_to);
    }
    if let Some(amount_min_minor) = input.amount_min_minor {
        query
            .push(" AND t.amount_minor >= ")
            .push_bind(amount_min_minor);
    }
    if let Some(amount_max_minor) = input.amount_max_minor {
        query
            .push(" AND t.amount_minor <= ")
            .push_bind(amount_max_minor);
    }
    if let Some(category_id) = input.category_id.as_deref() {
        query
            .push(" AND (t.category_id = ")
            .push_bind(category_id)
            .push(" OR c.parent_id = ")
            .push_bind(category_id)
            .push(")");
    }
    if let Some(payment_method_id) = input.payment_method_id.as_deref() {
        query
            .push(" AND t.payment_method_id = ")
            .push_bind(payment_method_id);
    }
    if let Some(household_member_id) = input.household_member_id.as_deref() {
        query
            .push(" AND t.household_member_id = ")
            .push_bind(household_member_id);
    }
    if let Some(location_id) = input.location_id.as_deref() {
        query.push(" AND t.location_id = ").push_bind(location_id);
    }
    push_boolean_filter(
        query,
        input.has_attachment,
        "EXISTS(SELECT 1 FROM transaction_attachments ta WHERE ta.transaction_id = t.id)",
    );
    push_boolean_filter(
        query,
        input.is_linked_to_event,
        "EXISTS(SELECT 1 FROM event_transactions et WHERE et.transaction_id = t.id)",
    );
    if let Some(value) = input.is_possible_tax_candidate {
        query.push(if value {
            " AND (EXISTS(SELECT 1 FROM transaction_tax_tags ttt WHERE ttt.transaction_id = t.id)
                 OR EXISTS(SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                    AND rf.flag_type = 'possible_tax_candidate' AND rf.status = 'open'))"
        } else {
            " AND NOT EXISTS(SELECT 1 FROM transaction_tax_tags ttt WHERE ttt.transaction_id = t.id)
                 AND NOT EXISTS(SELECT 1 FROM review_flags rf WHERE rf.transaction_id = t.id
                    AND rf.flag_type = 'possible_tax_candidate' AND rf.status = 'open')"
        });
    }
    push_boolean_filter(
        query,
        input.is_recurring,
        "t.recurring_occurrence_id IS NOT NULL",
    );
    push_boolean_filter(
        query,
        input.is_uncategorized,
        "t.category_id IS NULL AND t.transaction_type <> 'transfer'",
    );
    if let Some(search) = search {
        let pattern = format!("%{search}%");
        query
            .push(" AND (COALESCE(t.merchant, '') LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR COALESCE(t.note, '') LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR COALESCE(c.name, '') LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR COALESCE(source.display_name, '') LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR EXISTS(SELECT 1 FROM locations l WHERE l.id = t.location_id AND l.name LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\') OR EXISTS(SELECT 1 FROM household_members hm WHERE hm.id = t.household_member_id AND hm.display_name LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\') OR EXISTS(SELECT 1 FROM transaction_tags tt JOIN tags tag ON tag.id = tt.tag_id WHERE tt.transaction_id = t.id AND tag.name LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\') OR EXISTS(SELECT 1 FROM transaction_attachments ta JOIN attachments a ON a.id = ta.attachment_id WHERE ta.transaction_id = t.id AND a.deleted_at IS NULL AND a.original_filename LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\') OR EXISTS(SELECT 1 FROM event_transactions et JOIN calendar_events e ON e.id = et.event_id WHERE et.transaction_id = t.id AND e.deleted_at IS NULL AND e.title LIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\'))");
    }
}

fn push_boolean_filter<'a>(
    query: &mut QueryBuilder<'a, Sqlite>,
    value: Option<bool>,
    expression: &str,
) {
    if let Some(value) = value {
        if value {
            query.push(" AND (").push(expression).push(")");
        } else {
            query.push(" AND NOT (").push(expression).push(")");
        }
    }
}

fn transaction_order_clause(input: &ListTransactionsInput) -> &'static str {
    match (
        input
            .sort_by
            .unwrap_or(TransactionSortField::TransactionDate),
        input.sort_direction.unwrap_or(SortDirection::Desc),
    ) {
        (TransactionSortField::TransactionDate, SortDirection::Asc) => {
            " ORDER BY t.transaction_date ASC, t.created_at ASC, t.id ASC"
        }
        (TransactionSortField::TransactionDate, SortDirection::Desc) => {
            " ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC"
        }
        (TransactionSortField::Amount, SortDirection::Asc) => {
            " ORDER BY t.amount_minor ASC, t.transaction_date DESC, t.id DESC"
        }
        (TransactionSortField::Amount, SortDirection::Desc) => {
            " ORDER BY t.amount_minor DESC, t.transaction_date DESC, t.id DESC"
        }
        (TransactionSortField::Merchant, SortDirection::Asc) => {
            " ORDER BY COALESCE(t.merchant, '') COLLATE NOCASE ASC, t.transaction_date DESC, t.id DESC"
        }
        (TransactionSortField::Merchant, SortDirection::Desc) => {
            " ORDER BY COALESCE(t.merchant, '') COLLATE NOCASE DESC, t.transaction_date DESC, t.id DESC"
        }
        (TransactionSortField::CreatedAt, SortDirection::Asc) => {
            " ORDER BY t.created_at ASC, t.id ASC"
        }
        (TransactionSortField::CreatedAt, SortDirection::Desc) => {
            " ORDER BY t.created_at DESC, t.id DESC"
        }
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn map_transaction(row: &sqlx::sqlite::SqliteRow) -> TransactionRecord {
    TransactionRecord {
        id: row.get("id"),
        transaction_date: row.get("transaction_date"),
        transaction_type: row.get("transaction_type"),
        status: row.get("status"),
        amount_minor: row.get("amount_minor"),
        currency_code: row.get("currency_code"),
        category_id: row.get("category_id"),
        category_name: row.get("category_name"),
        payment_method_id: row.get("payment_method_id"),
        payment_method_name: row.get("payment_method_name"),
        transfer_to_payment_method_id: row.get("transfer_to_payment_method_id"),
        transfer_to_payment_method_name: row.get("transfer_to_payment_method_name"),
        transfer_to_amount_minor: row.get("transfer_to_amount_minor"),
        transfer_to_currency_code: row.get("transfer_to_currency_code"),
        household_member_id: row.get("household_member_id"),
        household_member_name: row.get("household_member_name"),
        location_id: row.get("location_id"),
        location_name: row.get("location_name"),
        merchant: row.get("merchant"),
        note: row.get("note"),
        version: row.get("version"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        has_possible_tax_hint: row.get::<i64, _>("has_possible_tax_hint") == 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::transactions::{
        BatchEditTransactionsInput, BatchTaxTagPatch, BatchTransactionPatch, NullableIdPatch,
        TransactionStatus, TransactionType, TransactionVersionInput, UndoBatchEditInput,
    };
    use crate::infrastructure::database::open_database;

    fn history_input(category_id: &str, amount_minor: i64, note: &str) -> CreateTransactionInput {
        CreateTransactionInput {
            transaction_date: "2026-07-03".into(),
            transaction_type: TransactionType::Expense,
            status: TransactionStatus::Completed,
            amount_minor,
            currency_code: "CAD".into(),
            category_id: Some(category_id.into()),
            payment_method_id: Some("20000000-0000-7000-8000-000000000001".into()),
            transfer_to_payment_method_id: None,
            transfer_to_amount_minor: None,
            transfer_to_currency_code: None,
            household_member_id: Some("00000000-0000-7000-8000-000000000001".into()),
            location_id: None,
            merchant: Some("History Clinic".into()),
            note: Some(note.into()),
        }
    }

    #[tokio::test]
    async fn merchant_suggestions_choose_frequency_then_recency() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("suggestions.sqlite3"))
            .await
            .expect("database");
        let repository = TransactionRepository::new(database);
        let medical = "10000000-0000-7000-8000-000000000006";
        let grocery = "10000000-0000-7000-8000-000000000101";
        repository
            .create(
                &history_input(medical, 5_000, "First"),
                Some(5_000),
                Some("CAD"),
                &[],
            )
            .await
            .unwrap();
        repository
            .create(
                &history_input(grocery, 1_000, "Unusual"),
                Some(1_000),
                Some("CAD"),
                &[],
            )
            .await
            .unwrap();
        repository
            .create(
                &history_input(medical, 5_000, "Most recent"),
                Some(5_000),
                Some("CAD"),
                &[],
            )
            .await
            .unwrap();

        let suggestion = repository
            .suggest(&TransactionSuggestionInput {
                merchant: "history clinic".into(),
                transaction_type: TransactionType::Expense,
            })
            .await
            .expect("suggestion");
        assert_eq!(suggestion.matched_count, 3);
        assert_eq!(suggestion.category_id.as_deref(), Some(medical));
        assert_eq!(suggestion.amount_minor, Some(5_000));
        assert_eq!(suggestion.note.as_deref(), Some("Most recent"));
    }

    #[tokio::test]
    async fn batch_edit_reports_each_conflict_and_can_be_undone_without_changing_amounts() {
        let directory = tempfile::tempdir().expect("temp directory");
        let database = open_database(&directory.path().join("batch-edit.sqlite3"))
            .await
            .expect("database");
        let repository = TransactionRepository::new(database.clone());
        let medical = "10000000-0000-7000-8000-000000000006";
        let grocery = "10000000-0000-7000-8000-000000000101";
        let first = repository
            .create(
                &history_input(medical, 12_345, "Batch one"),
                Some(12_345),
                Some("CAD"),
                &["possible_tax_candidate"],
            )
            .await
            .unwrap();
        let second = repository
            .create(
                &history_input(medical, 6_789, "Batch two"),
                Some(6_789),
                Some("CAD"),
                &[],
            )
            .await
            .unwrap();

        let result = repository
            .batch_edit(
                &BatchEditTransactionsInput {
                    items: vec![
                        TransactionVersionInput {
                            id: first.id.clone(),
                            version: first.version,
                        },
                        TransactionVersionInput {
                            id: second.id.clone(),
                            version: second.version + 10,
                        },
                    ],
                    patch: BatchTransactionPatch {
                        category: Some(NullableIdPatch {
                            value: Some(grocery.into()),
                        }),
                        payment_method: Some(NullableIdPatch { value: None }),
                        household_member: Some(NullableIdPatch { value: None }),
                        status: Some(TransactionStatus::Pending),
                        tax_tag: Some(BatchTaxTagPatch {
                            tax_tag_id: "00000000-0000-7000-8000-000000000207".into(),
                            selected: true,
                        }),
                    },
                },
                Some(Some("expense".into())),
                false,
            )
            .await
            .unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].id, second.id);
        assert_eq!(result.conflicts[0].code, "version_conflict");
        let changed: (i64, String, Option<String>, Option<String>, String, i64) = sqlx::query_as(
            "SELECT amount_minor, status, category_id, payment_method_id, id, version
             FROM transactions WHERE id = ?",
        )
        .bind(&first.id)
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(changed.0, 12_345);
        assert_eq!(changed.1, "pending");
        assert_eq!(changed.2.as_deref(), Some(grocery));
        assert_eq!(changed.3, None);
        assert_eq!(changed.5, first.version + 1);
        let tag_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
        )
        .bind(&first.id)
        .bind("00000000-0000-7000-8000-000000000207")
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(tag_count, 1);

        let undone = repository
            .undo_batch_edit(&UndoBatchEditInput {
                operation_id: result.operation_id.clone(),
            })
            .await
            .unwrap();
        assert_eq!(undone.items.len(), 1);
        assert!(undone.conflicts.is_empty());
        let restored: (
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            i64,
        ) = sqlx::query_as(
            "SELECT amount_minor, status, category_id, payment_method_id,
                        household_member_id, version
                 FROM transactions WHERE id = ?",
        )
        .bind(&first.id)
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(restored.0, 12_345);
        assert_eq!(restored.1, "completed");
        assert_eq!(restored.2.as_deref(), Some(medical));
        assert_eq!(
            restored.3.as_deref(),
            Some("20000000-0000-7000-8000-000000000001")
        );
        assert_eq!(
            restored.4.as_deref(),
            Some("00000000-0000-7000-8000-000000000001")
        );
        assert_eq!(restored.5, first.version + 2);
        let remaining_tag_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
        )
        .bind(&first.id)
        .bind("00000000-0000-7000-8000-000000000207")
        .fetch_one(&database)
        .await
        .unwrap();
        assert_eq!(remaining_tag_count, 0);
        let audit_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_events WHERE correlation_id = ?")
                .bind(&result.operation_id)
                .fetch_one(&database)
                .await
                .unwrap();
        assert_eq!(audit_count, 3);

        let second_edit = repository
            .batch_edit(
                &BatchEditTransactionsInput {
                    items: vec![TransactionVersionInput {
                        id: first.id.clone(),
                        version: first.version + 2,
                    }],
                    patch: BatchTransactionPatch {
                        category: None,
                        payment_method: None,
                        household_member: None,
                        status: Some(TransactionStatus::Pending),
                        tax_tag: None,
                    },
                },
                None,
                false,
            )
            .await
            .unwrap();
        sqlx::query(
            "UPDATE transactions SET status = 'cancelled', version = version + 1 WHERE id = ?",
        )
        .bind(&first.id)
        .execute(&database)
        .await
        .unwrap();
        let refused_undo = repository
            .undo_batch_edit(&UndoBatchEditInput {
                operation_id: second_edit.operation_id,
            })
            .await
            .unwrap();
        assert!(refused_undo.items.is_empty());
        assert_eq!(refused_undo.conflicts[0].code, "undo_conflict");
        let final_status: String =
            sqlx::query_scalar("SELECT status FROM transactions WHERE id = ?")
                .bind(&first.id)
                .fetch_one(&database)
                .await
                .unwrap();
        assert_eq!(final_status, "cancelled");
    }
}
