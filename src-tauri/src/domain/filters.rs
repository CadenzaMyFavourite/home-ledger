use crate::domain::transactions::{TransactionStatus, TransactionType};
use crate::error::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionSavedFilterData {
    pub search: String,
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
    pub sort_by: String,
    pub sort_direction: String,
}

impl TransactionSavedFilterData {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.search.trim().len() > 200 {
            return Err(AppError::validation(
                "search",
                "搜索内容不能超过 200 个字符",
            ));
        }
        for (field, value) in [("dateFrom", &self.date_from), ("dateTo", &self.date_to)] {
            if let Some(value) = value {
                NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| AppError::validation(field, "日期格式必须是 YYYY-MM-DD"))?;
            }
        }
        if self
            .date_from
            .as_ref()
            .zip(self.date_to.as_ref())
            .is_some_and(|(from, to)| from > to)
        {
            return Err(AppError::validation("dateTo", "结束日期不能早于开始日期"));
        }
        if self.amount_min_minor.is_some_and(|value| value < 0)
            || self.amount_max_minor.is_some_and(|value| value < 0)
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
                "最高金额不能低于最低金额",
            ));
        }
        if !matches!(
            self.sort_by.as_str(),
            "transaction_date" | "amount" | "merchant" | "created_at"
        ) {
            return Err(AppError::validation("sortBy", "排序字段无效"));
        }
        if !matches!(self.sort_direction.as_str(), "asc" | "desc") {
            return Err(AppError::validation("sortDirection", "排序方向无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTransactionFilterInput {
    pub id: Option<String>,
    pub name: String,
    pub data: TransactionSavedFilterData,
    pub is_pinned: bool,
}

impl SaveTransactionFilterInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.name.trim().is_empty() || self.name.trim().len() > 120 {
            return Err(AppError::validation(
                "name",
                "筛选名称必须为 1 到 120 个字符",
            ));
        }
        if self.id.as_ref().is_some_and(|id| id.trim().is_empty()) {
            return Err(AppError::validation("id", "筛选 ID 无效"));
        }
        self.data.validate()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionFilterIdInput {
    pub id: String,
}

impl TransactionFilterIdInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "筛选 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSavedFilterRecord {
    pub id: String,
    pub name: String,
    pub data: TransactionSavedFilterData,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_filter() -> TransactionSavedFilterData {
        TransactionSavedFilterData {
            search: String::new(),
            transaction_type: None,
            status: None,
            date_from: Some("2026-01-01".into()),
            date_to: Some("2026-12-31".into()),
            amount_min_minor: Some(0),
            amount_max_minor: Some(10_000),
            category_id: None,
            payment_method_id: None,
            household_member_id: None,
            location_id: None,
            sort_by: "transaction_date".into(),
            sort_direction: "desc".into(),
        }
    }

    #[test]
    fn saved_filter_rejects_unknown_sort_and_invalid_ranges() {
        let mut filter = valid_filter();
        filter.sort_by = "DROP TABLE transactions".into();
        assert!(filter.validate().is_err());

        let mut filter = valid_filter();
        filter.amount_min_minor = Some(20_000);
        assert!(filter.validate().is_err());
    }
}
