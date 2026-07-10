use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_AMOUNT_MINOR: i64 = 9_000_000_000_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionType {
    Income,
    Expense,
    Transfer,
}

impl TransactionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Income => "income",
            Self::Expense => "expense",
            Self::Transfer => "transfer",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Planned,
    Pending,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionSortField {
    TransactionDate,
    Amount,
    Merchant,
    CreatedAt,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl TransactionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTransactionInput {
    pub transaction_date: String,
    pub transaction_type: TransactionType,
    pub status: TransactionStatus,
    pub amount_minor: i64,
    pub currency_code: String,
    pub category_id: Option<String>,
    pub payment_method_id: Option<String>,
    pub transfer_to_payment_method_id: Option<String>,
    pub transfer_to_amount_minor: Option<i64>,
    pub transfer_to_currency_code: Option<String>,
    pub household_member_id: Option<String>,
    pub location_id: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTransactionInput {
    pub id: String,
    pub version: i64,
    #[serde(flatten)]
    pub transaction: CreateTransactionInput,
}

impl UpdateTransactionInput {
    pub fn validate_identity(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "交易 ID 不能为空"));
        }
        if self.version < 1 {
            return Err(AppError::validation("version", "交易版本无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionVersionInput {
    pub id: String,
    pub version: i64,
}

impl TransactionVersionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "交易 ID 不能为空"));
        }
        if self.version < 1 {
            return Err(AppError::validation("version", "交易版本无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionMutationResult {
    pub id: String,
    pub version: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchTransactionItemsInput {
    pub items: Vec<TransactionVersionInput>,
}

impl BatchTransactionItemsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_batch_items(&self.items)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchCategoryUpdateInput {
    pub items: Vec<TransactionVersionInput>,
    pub category_id: Option<String>,
}

impl BatchCategoryUpdateInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_batch_items(&self.items)?;
        if self
            .category_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty())
        {
            return Err(AppError::validation("categoryId", "分类 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTransactionMutationResult {
    pub items: Vec<TransactionMutationResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NullableIdPatch {
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchTaxTagPatch {
    pub tax_tag_id: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchTransactionPatch {
    pub category: Option<NullableIdPatch>,
    pub payment_method: Option<NullableIdPatch>,
    pub household_member: Option<NullableIdPatch>,
    pub status: Option<TransactionStatus>,
    pub tax_tag: Option<BatchTaxTagPatch>,
}

impl BatchTransactionPatch {
    fn validate(&self) -> Result<(), AppError> {
        if self.category.is_none()
            && self.payment_method.is_none()
            && self.household_member.is_none()
            && self.status.is_none()
            && self.tax_tag.is_none()
        {
            return Err(AppError::validation(
                "patch",
                "请至少选择一个需要批量修改的字段",
            ));
        }
        for (field, patch) in [
            ("categoryId", self.category.as_ref()),
            ("paymentMethodId", self.payment_method.as_ref()),
            ("householdMemberId", self.household_member.as_ref()),
        ] {
            if patch
                .and_then(|patch| patch.value.as_ref())
                .is_some_and(|id| id.trim().is_empty())
            {
                return Err(AppError::validation(field, "所选记录 ID 无效"));
            }
        }
        if self
            .tax_tag
            .as_ref()
            .is_some_and(|patch| patch.tax_tag_id.trim().is_empty())
        {
            return Err(AppError::validation("taxTagId", "税务标签 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchEditTransactionsInput {
    pub items: Vec<TransactionVersionInput>,
    pub patch: BatchTransactionPatch,
}

impl BatchEditTransactionsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_batch_items(&self.items)?;
        self.patch.validate()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTransactionConflict {
    pub id: String,
    pub expected_version: i64,
    pub actual_version: Option<i64>,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEditTransactionsResult {
    pub operation_id: String,
    pub items: Vec<TransactionMutationResult>,
    pub conflicts: Vec<BatchTransactionConflict>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoBatchEditInput {
    pub operation_id: String,
}

impl UndoBatchEditInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.operation_id.trim().is_empty() {
            return Err(AppError::validation("operationId", "批量操作 ID 无效"));
        }
        Ok(())
    }
}

fn validate_batch_items(items: &[TransactionVersionInput]) -> Result<(), AppError> {
    if items.is_empty() || items.len() > 500 {
        return Err(AppError::validation(
            "items",
            "批量操作必须包含 1 到 500 笔记录",
        ));
    }
    let mut ids = HashSet::with_capacity(items.len());
    for item in items {
        item.validate()?;
        if !ids.insert(item.id.as_str()) {
            return Err(AppError::validation("items", "批量操作包含重复记录"));
        }
    }
    Ok(())
}

impl CreateTransactionInput {
    pub fn validate_shape(&self) -> Result<(), AppError> {
        NaiveDate::parse_from_str(&self.transaction_date, "%Y-%m-%d")
            .map_err(|_| AppError::validation("transactionDate", "交易日期格式无效"))?;
        validate_amount("amountMinor", self.amount_minor)?;
        validate_currency("currencyCode", &self.currency_code)?;

        if self
            .merchant
            .as_ref()
            .is_some_and(|value| value.trim().len() > 200)
        {
            return Err(AppError::validation(
                "merchant",
                "商家名称不能超过 200 个字符",
            ));
        }
        if self.note.as_ref().is_some_and(|value| value.len() > 4_000) {
            return Err(AppError::validation("note", "备注不能超过 4000 个字符"));
        }

        match self.transaction_type {
            TransactionType::Transfer => {
                let source = self.payment_method_id.as_deref().ok_or_else(|| {
                    AppError::validation("paymentMethodId", "转账必须选择转出账户")
                })?;
                let target = self
                    .transfer_to_payment_method_id
                    .as_deref()
                    .ok_or_else(|| {
                        AppError::validation("transferToPaymentMethodId", "转账必须选择转入账户")
                    })?;
                if source == target {
                    return Err(AppError::validation(
                        "transferToPaymentMethodId",
                        "转入和转出账户不能相同",
                    ));
                }
                validate_amount(
                    "transferToAmountMinor",
                    self.transfer_to_amount_minor.ok_or_else(|| {
                        AppError::validation("transferToAmountMinor", "请输入转入金额")
                    })?,
                )?;
                validate_currency(
                    "transferToCurrencyCode",
                    self.transfer_to_currency_code.as_deref().ok_or_else(|| {
                        AppError::validation("transferToCurrencyCode", "请输入转入币种")
                    })?,
                )?;
                if self.category_id.is_some() {
                    return Err(AppError::validation("categoryId", "转账不能设置收支分类"));
                }
            }
            TransactionType::Income | TransactionType::Expense => {
                if self.transfer_to_payment_method_id.is_some()
                    || self.transfer_to_amount_minor.is_some()
                    || self.transfer_to_currency_code.is_some()
                {
                    return Err(AppError::validation(
                        "transactionType",
                        "收入和支出不能包含转账目标字段",
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validate_amount(field: &'static str, amount: i64) -> Result<(), AppError> {
    if !(1..=MAX_AMOUNT_MINOR).contains(&amount) {
        return Err(AppError::validation(
            field,
            "金额必须大于零且不能超过系统上限",
        ));
    }
    Ok(())
}

fn validate_currency(field: &'static str, code: &str) -> Result<(), AppError> {
    if code.len() != 3 || !code.chars().all(|character| character.is_ascii_uppercase()) {
        return Err(AppError::validation(field, "币种必须是三位大写 ISO 代码"));
    }
    Ok(())
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListTransactionsInput {
    pub id: Option<String>,
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
    pub sort_by: Option<TransactionSortField>,
    pub sort_direction: Option<SortDirection>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl ListTransactionsInput {
    pub fn validated_limit(&self) -> Result<i64, AppError> {
        let limit = self.limit.unwrap_or(100);
        if !(1..=500).contains(&limit) {
            return Err(AppError::validation(
                "limit",
                "每页记录数必须在 1 到 500 之间",
            ));
        }
        if self.offset.unwrap_or(0) < 0 {
            return Err(AppError::validation("offset", "分页位置不能为负数"));
        }
        if self
            .id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty() || id.len() > 100)
        {
            return Err(AppError::validation("id", "交易 ID 无效"));
        }
        let date_from = self
            .date_from
            .as_deref()
            .map(|value| {
                NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| AppError::validation("dateFrom", "开始日期格式无效"))
            })
            .transpose()?;
        let date_to = self
            .date_to
            .as_deref()
            .map(|value| {
                NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| AppError::validation("dateTo", "结束日期格式无效"))
            })
            .transpose()?;
        if date_from.zip(date_to).is_some_and(|(from, to)| from > to) {
            return Err(AppError::validation("dateTo", "结束日期不能早于开始日期"));
        }
        if self.amount_min_minor.is_some_and(|amount| amount < 0)
            || self.amount_max_minor.is_some_and(|amount| amount < 0)
        {
            return Err(AppError::validation("amountMinMinor", "金额筛选不能为负数"));
        }
        if self
            .amount_min_minor
            .zip(self.amount_max_minor)
            .is_some_and(|(minimum, maximum)| minimum > maximum)
        {
            return Err(AppError::validation(
                "amountMaxMinor",
                "最大金额不能小于最小金额",
            ));
        }
        Ok(limit)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRecord {
    pub id: String,
    pub transaction_date: String,
    pub transaction_type: String,
    pub status: String,
    pub amount_minor: i64,
    pub currency_code: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub payment_method_id: Option<String>,
    pub payment_method_name: Option<String>,
    pub transfer_to_payment_method_id: Option<String>,
    pub transfer_to_payment_method_name: Option<String>,
    pub transfer_to_amount_minor: Option<i64>,
    pub transfer_to_currency_code: Option<String>,
    pub household_member_id: Option<String>,
    pub household_member_name: Option<String>,
    pub location_id: Option<String>,
    pub location_name: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub has_possible_tax_hint: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPage {
    pub records: Vec<TransactionRecord>,
    pub total: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionSuggestionInput {
    pub merchant: String,
    pub transaction_type: TransactionType,
}

impl TransactionSuggestionInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let merchant = self.merchant.trim();
        if merchant.len() < 2 || merchant.len() > 200 {
            return Err(AppError::validation(
                "merchant",
                "商家或对方名称必须为 2 到 200 个字符",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSuggestion {
    pub matched_count: i64,
    pub category_id: Option<String>,
    pub payment_method_id: Option<String>,
    pub household_member_id: Option<String>,
    pub location_id: Option<String>,
    pub amount_minor: Option<i64>,
    pub note: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_requires_distinct_accounts() {
        let input = CreateTransactionInput {
            transaction_date: "2026-07-02".into(),
            transaction_type: TransactionType::Transfer,
            status: TransactionStatus::Completed,
            amount_minor: 1_000,
            currency_code: "CAD".into(),
            category_id: None,
            payment_method_id: Some("same".into()),
            transfer_to_payment_method_id: Some("same".into()),
            transfer_to_amount_minor: Some(1_000),
            transfer_to_currency_code: Some("CAD".into()),
            household_member_id: None,
            location_id: None,
            merchant: None,
            note: None,
        };

        assert!(input.validate_shape().is_err());
    }
}
