use crate::domain::local_ai::{
    AiProfileRecord, AiProviderType, AiSuggestionContext, AiSuggestionOption,
    AiSuggestionQueryInput, AiSuggestionRecord, AiSuggestionType, AiSummaryQueryInput,
    AiSummaryRecord, ReviewAiSuggestionInput, SaveAiProfileInput, UpdateAiSummaryInput,
};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct LocalAiRepository {
    database: SqlitePool,
}

pub struct NewAiSuggestion {
    pub suggestion_type: AiSuggestionType,
    pub suggested_value: serde_json::Value,
    pub explanation: Option<String>,
}

impl LocalAiRepository {
    pub fn new(database: SqlitePool) -> Self {
        Self { database }
    }

    pub async fn list_profiles(&self) -> Result<Vec<AiProfileRecord>, AppError> {
        let rows = sqlx::query(
            "SELECT id, display_name, provider_type, base_url, model_name,
                    timeout_ms, max_context_tokens, is_enabled, is_default,
                    created_at, updated_at
             FROM ai_profiles
             ORDER BY is_default DESC, updated_at DESC, display_name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_profile).collect()
    }

    pub async fn save_profile(
        &self,
        input: &SaveAiProfileInput,
    ) -> Result<AiProfileRecord, AppError> {
        let normalized_url = input.validate()?.to_string();
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        sqlx::query("UPDATE ai_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1")
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        let id = if let Some(id) = input.id.as_ref() {
            let updated = sqlx::query(
                "UPDATE ai_profiles
                 SET display_name = ?, provider_type = ?, base_url = ?, model_name = ?,
                     timeout_ms = ?, max_context_tokens = ?, is_enabled = ?,
                     is_default = 1, non_loopback_confirmed = 0, updated_at = ?
                 WHERE id = ?",
            )
            .bind(input.display_name.trim())
            .bind(input.provider_type.as_str())
            .bind(&normalized_url)
            .bind(input.model_name.trim())
            .bind(input.timeout_ms)
            .bind(input.max_context_tokens)
            .bind(input.is_enabled)
            .bind(&now)
            .bind(id)
            .execute(&mut *transaction)
            .await?;
            if updated.rows_affected() == 0 {
                return Err(AppError::not_found("ai_profile", "本地 AI 配置不存在"));
            }
            id.clone()
        } else {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO ai_profiles(
                    id, display_name, provider_type, base_url, model_name,
                    timeout_ms, max_context_tokens, is_enabled, is_default,
                    non_loopback_confirmed, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)",
            )
            .bind(&id)
            .bind(input.display_name.trim())
            .bind(input.provider_type.as_str())
            .bind(&normalized_url)
            .bind(input.model_name.trim())
            .bind(input.timeout_ms)
            .bind(input.max_context_tokens)
            .bind(input.is_enabled)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            id
        };
        let row = sqlx::query(
            "SELECT id, display_name, provider_type, base_url, model_name,
                    timeout_ms, max_context_tokens, is_enabled, is_default,
                    created_at, updated_at
             FROM ai_profiles WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&mut *transaction)
        .await?;
        let profile = map_profile(&row)?;
        transaction.commit().await?;
        Ok(profile)
    }

    pub async fn get_enabled_default_profile(&self) -> Result<AiProfileRecord, AppError> {
        let row = sqlx::query(
            "SELECT id, display_name, provider_type, base_url, model_name,
                    timeout_ms, max_context_tokens, is_enabled, is_default,
                    created_at, updated_at
             FROM ai_profiles WHERE is_default = 1 AND is_enabled = 1",
        )
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::conflict("请先在设置中启用一个本地 AI 配置并确认模型名称"))?;
        map_profile(&row)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_summary(
        &self,
        summary_type: &str,
        period_start: &str,
        period_end_exclusive: &str,
        profile: &AiProfileRecord,
        prompt_version: i64,
        data_scope: &[String],
        input_hash: &str,
        generated_text: &str,
    ) -> Result<AiSummaryRecord, AppError> {
        let id = Uuid::now_v7().to_string();
        let revision_id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let scope_json = serde_json::to_string(data_scope)?;
        let mut transaction = self.database.begin().await?;
        sqlx::query(
            "INSERT INTO ai_summaries(
                id, summary_type, period_start, period_end_exclusive, ai_profile_id,
                model_name_snapshot, prompt_version, data_scope_json, input_hash,
                generated_text, current_text, review_status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
        )
        .bind(&id)
        .bind(summary_type)
        .bind(period_start)
        .bind(period_end_exclusive)
        .bind(&profile.id)
        .bind(&profile.model_name)
        .bind(prompt_version)
        .bind(scope_json)
        .bind(input_hash)
        .bind(generated_text)
        .bind(generated_text)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO ai_summary_revisions(
                id, ai_summary_id, revision_number, text, edited_by, created_at
             ) VALUES (?, ?, 1, ?, 'ai', ?)",
        )
        .bind(revision_id)
        .bind(&id)
        .bind(generated_text)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        let row = summary_row(&mut transaction, &id).await?;
        transaction.commit().await?;
        map_summary(&row)
    }

    pub async fn list_summaries(
        &self,
        input: &AiSummaryQueryInput,
    ) -> Result<Vec<AiSummaryRecord>, AppError> {
        input.validate()?;
        let rows = sqlx::query(
            "SELECT id, summary_type, period_start, period_end_exclusive, ai_profile_id,
                    model_name_snapshot, prompt_version, data_scope_json, input_hash,
                    generated_text, current_text, review_status, created_at, updated_at
             FROM ai_summaries
             WHERE summary_type = ? AND period_start = ? AND period_end_exclusive = ?
               AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC",
        )
        .bind(&input.summary_type)
        .bind(&input.period_start_date)
        .bind(&input.period_end_date_exclusive)
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_summary).collect()
    }

    pub async fn update_summary(
        &self,
        input: &UpdateAiSummaryInput,
    ) -> Result<AiSummaryRecord, AppError> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let next_revision: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(revision_number), 0) + 1
             FROM ai_summary_revisions WHERE ai_summary_id = ?",
        )
        .bind(&input.id)
        .fetch_one(&mut *transaction)
        .await?;
        let updated = sqlx::query(
            "UPDATE ai_summaries SET current_text = ?, review_status = ?, updated_at = ?
             WHERE id = ? AND updated_at = ? AND deleted_at IS NULL",
        )
        .bind(input.current_text.trim())
        .bind(&input.review_status)
        .bind(&now)
        .bind(&input.id)
        .bind(&input.expected_updated_at)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(AppError::conflict(
                "AI 总结已在其他窗口修改或不存在，请刷新后重试",
            ));
        }
        sqlx::query(
            "INSERT INTO ai_summary_revisions(
                id, ai_summary_id, revision_number, text, edited_by, created_at
             ) VALUES (?, ?, ?, ?, 'user', ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&input.id)
        .bind(next_revision)
        .bind(input.current_text.trim())
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        let row = summary_row(&mut transaction, &input.id).await?;
        transaction.commit().await?;
        map_summary(&row)
    }

    pub async fn load_suggestion_context(
        &self,
        transaction_id: &str,
    ) -> Result<AiSuggestionContext, AppError> {
        let row = sqlx::query(
            "SELECT t.id, t.version, t.transaction_date, t.transaction_type, t.status,
                    t.amount_minor, t.currency_code, t.merchant, t.note, t.category_id,
                    c.name AS category_name
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.id = ? AND t.deleted_at IS NULL",
        )
        .bind(transaction_id)
        .fetch_optional(&self.database)
        .await?
        .ok_or_else(|| AppError::not_found("transaction", "交易记录不存在"))?;
        let transaction_type: String = row.get("transaction_type");
        let category_rows = if transaction_type == "transfer" {
            Vec::new()
        } else {
            sqlx::query(
                "SELECT id, name FROM categories
                 WHERE type = ? AND is_active = 1
                 ORDER BY parent_id IS NOT NULL, sort_order, name COLLATE NOCASE",
            )
            .bind(&transaction_type)
            .fetch_all(&self.database)
            .await?
        };
        let tax_rows = sqlx::query(
            "SELECT tt.id, tt.name FROM tax_tags tt
             JOIN tax_profiles tp ON tp.id = tt.tax_profile_id
             WHERE tt.is_active = 1 AND tp.is_active = 1 AND tp.is_default = 1
             ORDER BY tt.sort_order, tt.name COLLATE NOCASE",
        )
        .fetch_all(&self.database)
        .await?;
        let open_review_flags = sqlx::query_scalar::<_, String>(
            "SELECT flag_type FROM review_flags
             WHERE transaction_id = ? AND status = 'open'
             ORDER BY flag_type",
        )
        .bind(transaction_id)
        .fetch_all(&self.database)
        .await?;
        Ok(AiSuggestionContext {
            transaction_id: row.get("id"),
            target_version: row.get("version"),
            transaction_date: row.get("transaction_date"),
            transaction_type,
            status: row.get("status"),
            amount_minor: row.get("amount_minor"),
            currency_code: row.get("currency_code"),
            merchant: row.get("merchant"),
            note: row.get("note"),
            current_category_id: row.get("category_id"),
            current_category_name: row.get("category_name"),
            open_review_flags,
            allowed_categories: category_rows.iter().map(map_suggestion_option).collect(),
            allowed_tax_tags: tax_rows.iter().map(map_suggestion_option).collect(),
        })
    }

    pub async fn create_suggestions(
        &self,
        target_id: &str,
        profile: &AiProfileRecord,
        input_hash: &str,
        requested_types: &[AiSuggestionType],
        suggestions: &[NewAiSuggestion],
    ) -> Result<Vec<AiSuggestionRecord>, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let mut ids = Vec::with_capacity(suggestions.len());
        for suggestion_type in requested_types {
            sqlx::query(
                "UPDATE ai_suggestions SET status = 'expired', reviewed_at = ?, updated_at = ?
                 WHERE target_type = 'transaction' AND target_id = ? AND suggestion_type = ?
                   AND status = 'pending'",
            )
            .bind(&now)
            .bind(&now)
            .bind(target_id)
            .bind(suggestion_type.as_str())
            .execute(&mut *transaction)
            .await?;
        }
        for suggestion in suggestions {
            let id = Uuid::now_v7().to_string();
            sqlx::query(
                "INSERT INTO ai_suggestions(
                    id, suggestion_type, target_type, target_id, ai_profile_id,
                    input_hash, suggested_value_json, explanation, status, created_at, updated_at
                 ) VALUES (?, ?, 'transaction', ?, ?, ?, ?, ?, 'pending', ?, ?)",
            )
            .bind(&id)
            .bind(suggestion.suggestion_type.as_str())
            .bind(target_id)
            .bind(&profile.id)
            .bind(input_hash)
            .bind(suggestion.suggested_value.to_string())
            .bind(suggestion.explanation.as_deref())
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            ids.push(id);
        }
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(map_suggestion(
                &suggestion_row(&mut transaction, &id).await?,
            )?);
        }
        transaction.commit().await?;
        Ok(records)
    }

    pub async fn list_suggestions(
        &self,
        input: &AiSuggestionQueryInput,
    ) -> Result<Vec<AiSuggestionRecord>, AppError> {
        input.validate()?;
        let rows = sqlx::query(
            "SELECT id, suggestion_type, target_id, suggested_value_json, explanation,
                    status, reviewed_at, created_at, updated_at
             FROM ai_suggestions
             WHERE target_type = 'transaction' AND target_id = ?
             ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC",
        )
        .bind(&input.transaction_id)
        .fetch_all(&self.database)
        .await?;
        rows.iter().map(map_suggestion).collect()
    }

    pub async fn review_suggestion(
        &self,
        input: &ReviewAiSuggestionInput,
    ) -> Result<AiSuggestionRecord, AppError> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self.database.begin().await?;
        let row = suggestion_row(&mut transaction, &input.id).await?;
        let suggestion = map_suggestion(&row)?;
        if suggestion.status != "pending" {
            return Err(AppError::conflict("AI 建议已经处理，请刷新后重试"));
        }
        if input.decision == "accepted" {
            apply_accepted_suggestion(&mut transaction, &suggestion, &now).await?;
            if suggestion.suggestion_type != AiSuggestionType::AnomalyExplanation {
                sqlx::query(
                    "UPDATE ai_suggestions SET status = 'expired', reviewed_at = ?, updated_at = ?
                     WHERE target_type = 'transaction' AND target_id = ? AND id <> ? AND status = 'pending'",
                )
                .bind(&now)
                .bind(&now)
                .bind(&suggestion.target_id)
                .bind(&suggestion.id)
                .execute(&mut *transaction)
                .await?;
            }
        }
        sqlx::query(
            "UPDATE ai_suggestions SET status = ?, reviewed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'",
        )
        .bind(&input.decision)
        .bind(&now)
        .bind(&now)
        .bind(&input.id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO audit_events(
                id, occurred_at, actor_type, action, entity_type, entity_id, after_json
             ) VALUES (?, ?, ?, ?, 'ai_suggestion', ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&now)
        .bind(if input.decision == "accepted" {
            "accepted_ai"
        } else {
            "user"
        })
        .bind(if input.decision == "accepted" {
            "accept_ai_suggestion"
        } else {
            "reject_ai_suggestion"
        })
        .bind(&input.id)
        .bind(
            serde_json::json!({
                "targetId": suggestion.target_id,
                "suggestionType": suggestion.suggestion_type.as_str(),
                "status": input.decision,
            })
            .to_string(),
        )
        .execute(&mut *transaction)
        .await?;
        let updated = map_suggestion(&suggestion_row(&mut transaction, &input.id).await?)?;
        transaction.commit().await?;
        Ok(updated)
    }
}

fn map_suggestion_option(row: &sqlx::sqlite::SqliteRow) -> AiSuggestionOption {
    AiSuggestionOption {
        id: row.get("id"),
        name: row.get("name"),
    }
}

async fn suggestion_row(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<sqlx::sqlite::SqliteRow, AppError> {
    sqlx::query(
        "SELECT id, suggestion_type, target_id, suggested_value_json, explanation,
                status, reviewed_at, created_at, updated_at
         FROM ai_suggestions WHERE id = ? AND target_type = 'transaction'",
    )
    .bind(id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::not_found("ai_suggestion", "AI 建议不存在"))
}

fn map_suggestion(row: &sqlx::sqlite::SqliteRow) -> Result<AiSuggestionRecord, AppError> {
    let suggestion_type = match row.get::<String, _>("suggestion_type").as_str() {
        "category" => AiSuggestionType::Category,
        "tax_tag" => AiSuggestionType::TaxTag,
        "anomaly_explanation" => AiSuggestionType::AnomalyExplanation,
        _ => return Err(AppError::conflict("AI 建议包含未知类型")),
    };
    Ok(AiSuggestionRecord {
        id: row.get("id"),
        suggestion_type,
        target_id: row.get("target_id"),
        suggested_value: serde_json::from_str(&row.get::<String, _>("suggested_value_json"))?,
        explanation: row.get("explanation"),
        status: row.get("status"),
        reviewed_at: row.get("reviewed_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

async fn apply_accepted_suggestion(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    suggestion: &AiSuggestionRecord,
    now: &str,
) -> Result<(), AppError> {
    let target_version = suggestion
        .suggested_value
        .get("targetVersion")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| AppError::conflict("AI 建议缺少目标版本，不能安全应用"))?;
    match suggestion.suggestion_type {
        AiSuggestionType::Category => {
            let category_id = required_suggested_id(&suggestion.suggested_value, "categoryId")?;
            let transaction_type: String = sqlx::query_scalar(
                "SELECT transaction_type FROM transactions
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(&suggestion.target_id)
            .bind(target_version)
            .fetch_optional(&mut **transaction)
            .await?
            .ok_or_else(|| AppError::conflict("交易已修改，请重新生成 AI 建议"))?;
            if transaction_type == "transfer" {
                return Err(AppError::conflict("转账不能应用收支分类建议"));
            }
            let category_exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM categories WHERE id = ? AND type = ? AND is_active = 1",
            )
            .bind(category_id)
            .bind(&transaction_type)
            .fetch_one(&mut **transaction)
            .await?;
            if category_exists != 1 {
                return Err(AppError::conflict("建议分类已停用或不适用于该交易类型"));
            }
            let updated = sqlx::query(
                "UPDATE transactions SET category_id = ?, version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(category_id)
            .bind(now)
            .bind(&suggestion.target_id)
            .bind(target_version)
            .execute(&mut **transaction)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(AppError::conflict("交易已修改，请重新生成 AI 建议"));
            }
            sqlx::query(
                "UPDATE review_flags SET status = 'resolved', resolved_at = ?, updated_at = ?
                 WHERE transaction_id = ? AND flag_type = 'uncategorized' AND status = 'open'",
            )
            .bind(now)
            .bind(now)
            .bind(&suggestion.target_id)
            .execute(&mut **transaction)
            .await?;
            insert_accepted_ai_transaction_audit(
                transaction,
                "accept_ai_category_suggestion",
                &suggestion.target_id,
                serde_json::json!({ "categoryId": category_id, "version": target_version + 1 }),
                now,
            )
            .await?;
        }
        AiSuggestionType::TaxTag => {
            let tax_tag_id = required_suggested_id(&suggestion.suggested_value, "taxTagId")?;
            let transaction_exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM transactions
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(&suggestion.target_id)
            .bind(target_version)
            .fetch_one(&mut **transaction)
            .await?;
            if transaction_exists != 1 {
                return Err(AppError::conflict("交易已修改，请重新生成 AI 建议"));
            }
            let tag_exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM tax_tags tt
                 JOIN tax_profiles tp ON tp.id = tt.tax_profile_id
                 WHERE tt.id = ? AND tt.is_active = 1 AND tp.is_active = 1",
            )
            .bind(tax_tag_id)
            .fetch_one(&mut **transaction)
            .await?;
            if tag_exists != 1 {
                return Err(AppError::conflict("建议税务标签已停用或不存在"));
            }
            let already_tagged: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM transaction_tax_tags WHERE transaction_id = ? AND tax_tag_id = ?",
            )
            .bind(&suggestion.target_id)
            .bind(tax_tag_id)
            .fetch_one(&mut **transaction)
            .await?;
            if already_tagged != 0 {
                return Err(AppError::conflict("该交易已经使用建议的税务标签"));
            }
            sqlx::query(
                "INSERT INTO transaction_tax_tags(
                    transaction_id, tax_tag_id, source, confirmed_at, created_at
                 ) VALUES (?, ?, 'accepted_ai', ?, ?)",
            )
            .bind(&suggestion.target_id)
            .bind(tax_tag_id)
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await?;
            sqlx::query(
                "UPDATE transactions SET version = version + 1, updated_at = ?
                 WHERE id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(now)
            .bind(&suggestion.target_id)
            .bind(target_version)
            .execute(&mut **transaction)
            .await?;
            insert_accepted_ai_transaction_audit(
                transaction,
                "accept_ai_tax_tag_suggestion",
                &suggestion.target_id,
                serde_json::json!({ "taxTagId": tax_tag_id, "version": target_version + 1 }),
                now,
            )
            .await?;
        }
        AiSuggestionType::AnomalyExplanation => {}
    }
    Ok(())
}

fn required_suggested_id<'a>(
    value: &'a serde_json::Value,
    field: &'static str,
) -> Result<&'a str, AppError> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| AppError::conflict(format!("AI 建议缺少 {field}")))
}

async fn insert_accepted_ai_transaction_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    action: &str,
    transaction_id: &str,
    after: serde_json::Value,
    now: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_events(
            id, occurred_at, actor_type, action, entity_type, entity_id, after_json
         ) VALUES (?, ?, 'accepted_ai', ?, 'transaction', ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .bind(action)
    .bind(transaction_id)
    .bind(after.to_string())
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn summary_row(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<sqlx::sqlite::SqliteRow, AppError> {
    Ok(sqlx::query(
        "SELECT id, summary_type, period_start, period_end_exclusive, ai_profile_id,
                model_name_snapshot, prompt_version, data_scope_json, input_hash,
                generated_text, current_text, review_status, created_at, updated_at
         FROM ai_summaries WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut **transaction)
    .await?)
}

fn map_summary(row: &sqlx::sqlite::SqliteRow) -> Result<AiSummaryRecord, AppError> {
    Ok(AiSummaryRecord {
        id: row.get("id"),
        summary_type: row.get("summary_type"),
        period_start_date: row.get("period_start"),
        period_end_date_exclusive: row.get("period_end_exclusive"),
        ai_profile_id: row.get("ai_profile_id"),
        model_name_snapshot: row.get("model_name_snapshot"),
        prompt_version: row.get("prompt_version"),
        data_scope: serde_json::from_str(&row.get::<String, _>("data_scope_json"))?,
        input_hash: row.get("input_hash"),
        generated_text: row.get("generated_text"),
        current_text: row.get("current_text"),
        review_status: row.get("review_status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn map_profile(row: &sqlx::sqlite::SqliteRow) -> Result<AiProfileRecord, AppError> {
    let provider = match row.get::<String, _>("provider_type").as_str() {
        "ollama" => AiProviderType::Ollama,
        "openai_compatible" => AiProviderType::OpenaiCompatible,
        _ => return Err(AppError::conflict("本地 AI 配置包含未知服务类型")),
    };
    Ok(AiProfileRecord {
        id: row.get("id"),
        display_name: row.get("display_name"),
        provider_type: provider,
        base_url: row.get("base_url"),
        model_name: row.get("model_name"),
        timeout_ms: row.get("timeout_ms"),
        max_context_tokens: row.get("max_context_tokens"),
        is_enabled: row.get::<i64, _>("is_enabled") == 1,
        is_default: row.get::<i64, _>("is_default") == 1,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::open_database;

    #[tokio::test]
    async fn profile_round_trip_normalizes_loopback_url_and_keeps_one_default() {
        let directory = tempfile::tempdir().unwrap();
        let database = open_database(&directory.path().join("ai.sqlite3"))
            .await
            .unwrap();
        let repository = LocalAiRepository::new(database);
        let first = repository
            .save_profile(&SaveAiProfileInput {
                id: None,
                display_name: "Ollama".into(),
                provider_type: AiProviderType::Ollama,
                base_url: "http://127.0.0.1:11434".into(),
                model_name: "qwen3:8b".into(),
                timeout_ms: 30_000,
                max_context_tokens: 8_192,
                is_enabled: false,
            })
            .await
            .unwrap();
        assert_eq!(first.base_url, "http://127.0.0.1:11434/");
        let second = repository
            .save_profile(&SaveAiProfileInput {
                id: None,
                display_name: "LM Studio".into(),
                provider_type: AiProviderType::OpenaiCompatible,
                base_url: "http://localhost:1234/v1".into(),
                model_name: "local-model".into(),
                timeout_ms: 10_000,
                max_context_tokens: 4_096,
                is_enabled: true,
            })
            .await
            .unwrap();
        assert_eq!(second.base_url, "http://localhost:1234/v1/");
        let profiles = repository.list_profiles().await.unwrap();
        assert_eq!(
            profiles.iter().filter(|profile| profile.is_default).count(),
            1
        );
        assert_eq!(profiles[0].id, second.id);
    }
}
