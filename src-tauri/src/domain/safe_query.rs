use crate::domain::transactions::{
    ListTransactionsInput, SortDirection, TransactionSortField, TransactionStatus, TransactionType,
};
use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_AMOUNT_MINOR: i64 = 9_000_000_000_000_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NaturalLanguageQueryInput {
    pub query: String,
    pub locale: String,
}

impl NaturalLanguageQueryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let query = self.query.trim();
        if query.is_empty() || query.chars().count() > 500 {
            return Err(AppError::validation(
                "query",
                "自然语言查询必须包含 1 到 500 个字符",
            ));
        }
        if query.chars().any(char::is_control) {
            return Err(AppError::validation("query", "查询不能包含控制字符"));
        }
        if !matches!(self.locale.as_str(), "zh-CN" | "en-CA") {
            return Err(AppError::validation("locale", "查询语言不受支持"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct SafeQueryAllowlist {
    pub category_ids: HashSet<String>,
    pub payment_method_ids: HashSet<String>,
    pub household_member_ids: HashSet<String>,
    pub location_ids: HashSet<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeQueryPlan {
    pub schema_version: u8,
    pub intent: SafeQueryIntent,
    pub filters: SafeQueryFilters,
    pub sort: Option<SafeQuerySort>,
    pub limit: u16,
    pub explanation: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SafeQueryIntent {
    ListTransactions,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeQueryFilters {
    pub search: Option<String>,
    pub transaction_type: Option<TransactionType>,
    pub status: Option<TransactionStatus>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub amount_min_minor: Option<i64>,
    pub amount_max_minor: Option<i64>,
    pub category_id: Option<String>,
    pub payment_method_id: Option<String>,
    pub household_member_id: Option<String>,
    pub location_id: Option<String>,
    pub has_attachment: Option<bool>,
    pub is_linked_to_event: Option<bool>,
    pub is_possible_tax_candidate: Option<bool>,
    pub is_recurring: Option<bool>,
    pub is_uncategorized: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeQuerySort {
    pub field: TransactionSortField,
    pub direction: SortDirection,
}

impl SafeQueryPlan {
    pub fn compile(
        self,
        allowlist: &SafeQueryAllowlist,
    ) -> Result<ListTransactionsInput, AppError> {
        if self.schema_version != 1 || self.intent != SafeQueryIntent::ListTransactions {
            return Err(AppError::validation(
                "schemaVersion",
                "查询计划版本或意图不受支持",
            ));
        }
        if !(1..=200).contains(&self.limit) {
            return Err(AppError::validation(
                "limit",
                "自然语言查询最多返回 200 条记录",
            ));
        }
        if self.explanation.trim().is_empty() || self.explanation.chars().count() > 500 {
            return Err(AppError::validation("explanation", "查询说明格式无效"));
        }
        validate_search(self.filters.search.as_deref())?;
        validate_id(
            "categoryId",
            self.filters.category_id.as_deref(),
            &allowlist.category_ids,
        )?;
        validate_id(
            "paymentMethodId",
            self.filters.payment_method_id.as_deref(),
            &allowlist.payment_method_ids,
        )?;
        validate_id(
            "householdMemberId",
            self.filters.household_member_id.as_deref(),
            &allowlist.household_member_ids,
        )?;
        validate_id(
            "locationId",
            self.filters.location_id.as_deref(),
            &allowlist.location_ids,
        )?;

        let input = ListTransactionsInput {
            id: None,
            search: self.filters.search.map(|value| value.trim().to_owned()),
            transaction_type: self.filters.transaction_type,
            status: self.filters.status,
            date_from: self.filters.date_from,
            date_to: self.filters.date_to,
            amount_min_minor: self.filters.amount_min_minor,
            amount_max_minor: self.filters.amount_max_minor,
            category_id: self.filters.category_id,
            payment_method_id: self.filters.payment_method_id,
            household_member_id: self.filters.household_member_id,
            location_id: self.filters.location_id,
            has_attachment: self.filters.has_attachment,
            is_linked_to_event: self.filters.is_linked_to_event,
            is_possible_tax_candidate: self.filters.is_possible_tax_candidate,
            is_recurring: self.filters.is_recurring,
            is_uncategorized: self.filters.is_uncategorized,
            sort_by: self.sort.map(|sort| sort.field),
            sort_direction: self.sort.map(|sort| sort.direction),
            limit: Some(i64::from(self.limit)),
            offset: Some(0),
        };
        input.validated_limit()?;
        validate_range(&input)?;
        Ok(input)
    }
}

fn validate_id(
    field: &'static str,
    value: Option<&str>,
    allowed: &HashSet<String>,
) -> Result<(), AppError> {
    if value.is_some_and(|id| !allowed.contains(id)) {
        return Err(AppError::validation(
            field,
            "查询计划引用了不存在或未启用的选项",
        ));
    }
    Ok(())
}

fn validate_search(value: Option<&str>) -> Result<(), AppError> {
    let Some(value) = value else { return Ok(()) };
    let trimmed = value.trim();
    let lowered = trimmed.to_ascii_lowercase();
    if trimmed.is_empty()
        || trimmed.chars().count() > 200
        || trimmed.chars().any(char::is_control)
        || [";", "--", "/*", "*/", "://", "../", "..\\"]
            .iter()
            .any(|token| lowered.contains(token))
    {
        return Err(AppError::validation(
            "search",
            "查询计划包含不安全的搜索文本",
        ));
    }
    Ok(())
}

fn validate_range(input: &ListTransactionsInput) -> Result<(), AppError> {
    if input
        .amount_min_minor
        .is_some_and(|value| value > MAX_AMOUNT_MINOR)
        || input
            .amount_max_minor
            .is_some_and(|value| value > MAX_AMOUNT_MINOR)
    {
        return Err(AppError::validation(
            "amountMaxMinor",
            "查询金额超过系统上限",
        ));
    }
    let from = input.date_from.as_deref().and_then(parse_date);
    let to = input.date_to.as_deref().and_then(parse_date);
    if from
        .zip(to)
        .is_some_and(|(from, to)| (to - from).num_days() > 3_660)
    {
        return Err(AppError::validation(
            "dateTo",
            "单次自然语言查询的日期范围不能超过十年",
        ));
    }
    Ok(())
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist() -> SafeQueryAllowlist {
        SafeQueryAllowlist {
            category_ids: HashSet::from(["education".to_owned()]),
            payment_method_ids: HashSet::from(["credit-card".to_owned()]),
            ..Default::default()
        }
    }

    #[test]
    fn valid_plan_compiles_only_to_existing_parameterized_filters() {
        let plan: SafeQueryPlan = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "intent": "list_transactions",
            "filters": { "transactionType": "expense", "dateFrom": "2026-01-01",
                "dateTo": "2026-12-31", "categoryId": "education", "hasAttachment": false },
            "sort": { "field": "amount", "direction": "desc" }, "limit": 100,
            "explanation": "列出 2026 年教育支出并按金额排序"
        }))
        .unwrap();
        let compiled = plan.compile(&allowlist()).unwrap();
        assert_eq!(compiled.category_id.as_deref(), Some("education"));
        assert_eq!(compiled.limit, Some(100));
        assert_eq!(compiled.has_attachment, Some(false));
    }

    #[test]
    fn unknown_fields_ids_and_unsafe_text_are_rejected() {
        assert!(
            serde_json::from_value::<SafeQueryPlan>(serde_json::json!({
                "schemaVersion": 1, "intent": "list_transactions", "filters": {},
                "limit": 10, "explanation": "x", "sql": "DROP TABLE transactions"
            }))
            .is_err()
        );
        for (search, category) in [
            (Some("x'; DROP TABLE transactions;--"), None),
            (Some("file://../../secret"), None),
            (None, Some("hallucinated-id")),
        ] {
            let plan = SafeQueryPlan {
                schema_version: 1,
                intent: SafeQueryIntent::ListTransactions,
                filters: SafeQueryFilters {
                    search: search.map(str::to_owned),
                    category_id: category.map(str::to_owned),
                    ..Default::default()
                },
                sort: None,
                limit: 10,
                explanation: "安全检查".to_owned(),
            };
            assert!(plan.compile(&allowlist()).is_err());
        }
    }
}
