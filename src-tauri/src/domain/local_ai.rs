use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use url::Url;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderType {
    Ollama,
    OpenaiCompatible,
}

impl AiProviderType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::OpenaiCompatible => "openai_compatible",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveAiProfileInput {
    pub id: Option<String>,
    pub display_name: String,
    pub provider_type: AiProviderType,
    pub base_url: String,
    pub model_name: String,
    pub timeout_ms: i64,
    pub max_context_tokens: i64,
    pub is_enabled: bool,
}

impl SaveAiProfileInput {
    pub fn validate(&self) -> Result<Url, AppError> {
        if self
            .id
            .as_ref()
            .is_some_and(|value| value.trim().is_empty())
        {
            return Err(AppError::validation("id", "AI 配置 ID 无效"));
        }
        if !(1..=120).contains(&self.display_name.trim().chars().count()) {
            return Err(AppError::validation(
                "displayName",
                "配置名称必须为 1 到 120 个字符",
            ));
        }
        if !(1..=200).contains(&self.model_name.trim().chars().count()) {
            return Err(AppError::validation(
                "modelName",
                "模型名称必须为 1 到 200 个字符",
            ));
        }
        if !(1_000..=300_000).contains(&self.timeout_ms) {
            return Err(AppError::validation(
                "timeoutMs",
                "超时时间必须为 1000 到 300000 毫秒",
            ));
        }
        if !(512..=1_048_576).contains(&self.max_context_tokens) {
            return Err(AppError::validation(
                "maxContextTokens",
                "最大上下文长度必须为 512 到 1048576",
            ));
        }
        validate_loopback_url(&self.base_url, self.provider_type)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileRecord {
    pub id: String,
    pub display_name: String,
    pub provider_type: AiProviderType,
    pub base_url: String,
    pub model_name: String,
    pub timeout_ms: i64,
    pub max_context_tokens: i64,
    pub is_enabled: bool,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub connected: bool,
    pub provider_type: AiProviderType,
    pub model_available: bool,
    pub available_models: Vec<String>,
    pub latency_ms: u128,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateAiSummaryInput {
    pub summary_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub previous_period_start_date: String,
    pub reporting_currency_code: String,
    pub locale: String,
    pub aggregate_scope_confirmed: bool,
}

impl GenerateAiSummaryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.summary_type.as_str(), "monthly" | "annual") {
            return Err(AppError::validation("summaryType", "AI 总结类型无效"));
        }
        let previous = parse_date("previousPeriodStartDate", &self.previous_period_start_date)?;
        let start = parse_date("periodStartDate", &self.period_start_date)?;
        let end = parse_date("periodEndDateExclusive", &self.period_end_date_exclusive)?;
        if previous >= start || start >= end || (end - previous).num_days() > 4_100 {
            return Err(AppError::validation(
                "periodEndDateExclusive",
                "AI 总结期间无效",
            ));
        }
        if self.reporting_currency_code.len() != 3
            || !self
                .reporting_currency_code
                .bytes()
                .all(|value| value.is_ascii_uppercase())
        {
            return Err(AppError::validation(
                "reportingCurrencyCode",
                "报告币种必须是三个大写字母",
            ));
        }
        if !matches!(self.locale.as_str(), "zh-CN" | "en-CA") {
            return Err(AppError::validation("locale", "AI 总结语言无效"));
        }
        if !self.aggregate_scope_confirmed {
            return Err(AppError::validation(
                "aggregateScopeConfirmed",
                "生成前必须确认发送给本地模型的聚合数据范围",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSummaryQueryInput {
    pub summary_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
}

impl AiSummaryQueryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.summary_type.as_str(), "monthly" | "annual") {
            return Err(AppError::validation("summaryType", "AI 总结类型无效"));
        }
        let start = parse_date("periodStartDate", &self.period_start_date)?;
        let end = parse_date("periodEndDateExclusive", &self.period_end_date_exclusive)?;
        if start >= end || (end - start).num_days() > 3_700 {
            return Err(AppError::validation(
                "periodEndDateExclusive",
                "AI 总结期间无效",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAiSummaryInput {
    pub id: String,
    pub current_text: String,
    pub review_status: String,
    pub expected_updated_at: String,
}

impl UpdateAiSummaryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() || self.expected_updated_at.trim().is_empty() {
            return Err(AppError::validation("id", "AI 总结标识无效"));
        }
        if self.current_text.trim().is_empty() || self.current_text.chars().count() > 20_000 {
            return Err(AppError::validation(
                "currentText",
                "AI 总结必须为 1 到 20000 个字符",
            ));
        }
        if !matches!(
            self.review_status.as_str(),
            "draft" | "reviewed" | "rejected"
        ) {
            return Err(AppError::validation("reviewStatus", "AI 总结审核状态无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryRecord {
    pub id: String,
    pub summary_type: String,
    pub period_start_date: String,
    pub period_end_date_exclusive: String,
    pub ai_profile_id: String,
    pub model_name_snapshot: String,
    pub prompt_version: i64,
    pub data_scope: Vec<String>,
    pub input_hash: String,
    pub generated_text: String,
    pub current_text: String,
    pub review_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AiSuggestionType {
    Category,
    TaxTag,
    AnomalyExplanation,
}

impl AiSuggestionType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Category => "category",
            Self::TaxTag => "tax_tag",
            Self::AnomalyExplanation => "anomaly_explanation",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateAiSuggestionsInput {
    pub transaction_id: String,
    pub suggestion_types: Vec<AiSuggestionType>,
    pub locale: String,
    pub record_scope_confirmed: bool,
}

impl GenerateAiSuggestionsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.transaction_id.trim().is_empty() {
            return Err(AppError::validation("transactionId", "交易 ID 无效"));
        }
        if self.suggestion_types.is_empty() || self.suggestion_types.len() > 3 {
            return Err(AppError::validation(
                "suggestionTypes",
                "请选择 1 到 3 种 AI 建议",
            ));
        }
        let unique = self
            .suggestion_types
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();
        if unique.len() != self.suggestion_types.len() {
            return Err(AppError::validation(
                "suggestionTypes",
                "AI 建议类型不能重复",
            ));
        }
        if !matches!(self.locale.as_str(), "zh-CN" | "en-CA") {
            return Err(AppError::validation("locale", "AI 建议语言无效"));
        }
        if !self.record_scope_confirmed {
            return Err(AppError::validation(
                "recordScopeConfirmed",
                "生成前必须确认发送所选交易数据给本地模型",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSuggestionQueryInput {
    pub transaction_id: String,
}

impl AiSuggestionQueryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.transaction_id.trim().is_empty() {
            return Err(AppError::validation("transactionId", "交易 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewAiSuggestionInput {
    pub id: String,
    pub decision: String,
}

impl ReviewAiSuggestionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "AI 建议 ID 无效"));
        }
        if !matches!(self.decision.as_str(), "accepted" | "rejected") {
            return Err(AppError::validation("decision", "AI 建议审核决定无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionRecord {
    pub id: String,
    pub suggestion_type: AiSuggestionType,
    pub target_id: String,
    pub suggested_value: serde_json::Value,
    pub explanation: Option<String>,
    pub status: String,
    pub reviewed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionContext {
    pub transaction_id: String,
    pub target_version: i64,
    pub transaction_date: String,
    pub transaction_type: String,
    pub status: String,
    pub amount_minor: i64,
    pub currency_code: String,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub current_category_id: Option<String>,
    pub current_category_name: Option<String>,
    pub open_review_flags: Vec<String>,
    pub allowed_categories: Vec<AiSuggestionOption>,
    pub allowed_tax_tags: Vec<AiSuggestionOption>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionOption {
    pub id: String,
    pub name: String,
}

pub fn validate_loopback_url(value: &str, provider_type: AiProviderType) -> Result<Url, AppError> {
    let mut url = Url::parse(value.trim())
        .map_err(|_| AppError::validation("baseUrl", "本地 AI 地址格式无效"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::validation(
            "baseUrl",
            "本地 AI 地址只支持 http 或 https",
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::validation(
            "baseUrl",
            "本地 AI 地址不能包含凭据、查询参数或片段",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::validation("baseUrl", "本地 AI 地址缺少主机名"))?;
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if !is_loopback {
        return Err(AppError::validation(
            "baseUrl",
            "为保护隐私，AI 地址必须是 localhost、127.0.0.1 或 ::1",
        ));
    }
    let path = url.path().trim_end_matches('/');
    match provider_type {
        AiProviderType::Ollama if !path.is_empty() => {
            return Err(AppError::validation(
                "baseUrl",
                "Ollama 地址应填写服务根地址，例如 http://127.0.0.1:11434",
            ));
        }
        AiProviderType::OpenaiCompatible if !matches!(path, "" | "/v1") => {
            return Err(AppError::validation(
                "baseUrl",
                "OpenAI-compatible 地址只允许服务根路径或 /v1",
            ));
        }
        _ => {}
    }
    url.set_path(match provider_type {
        AiProviderType::Ollama => "/",
        AiProviderType::OpenaiCompatible => "/v1/",
    });
    Ok(url)
}

fn parse_date(field: &'static str, value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::validation(field, "日期格式无效"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_url_accepts_only_loopback_and_known_base_paths() {
        assert!(validate_loopback_url("http://127.0.0.1:11434", AiProviderType::Ollama).is_ok());
        assert!(
            validate_loopback_url("http://localhost:1234/v1", AiProviderType::OpenaiCompatible)
                .is_ok()
        );
        assert!(
            validate_loopback_url("http://[::1]:1234/v1", AiProviderType::OpenaiCompatible).is_ok()
        );
        assert!(
            validate_loopback_url("https://example.com/v1", AiProviderType::OpenaiCompatible)
                .is_err()
        );
        assert!(
            validate_loopback_url("http://127.0.0.1:11434/api", AiProviderType::Ollama).is_err()
        );
        assert!(
            validate_loopback_url(
                "http://localhost:1234/v1?token=secret",
                AiProviderType::OpenaiCompatible
            )
            .is_err()
        );
    }
}
