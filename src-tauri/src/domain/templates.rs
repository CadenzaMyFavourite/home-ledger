use crate::domain::transactions::{CreateTransactionInput, TransactionStatus, TransactionType};
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionTemplateData {
    pub transaction_type: TransactionType,
    pub status: TransactionStatus,
    pub amount_minor: i64,
    pub currency_code: String,
    pub category_id: Option<String>,
    pub payment_method_id: Option<String>,
    pub transfer_to_payment_method_id: Option<String>,
    pub transfer_to_amount_minor: Option<i64>,
    pub transfer_to_currency_code: Option<String>,
    pub merchant: Option<String>,
    pub note: Option<String>,
}

impl TransactionTemplateData {
    pub fn validate(&self) -> Result<(), AppError> {
        self.as_transaction_input("2000-01-01".to_owned())
            .validate_shape()
    }

    pub fn as_transaction_input(&self, transaction_date: String) -> CreateTransactionInput {
        CreateTransactionInput {
            transaction_date,
            transaction_type: self.transaction_type,
            status: self.status,
            amount_minor: self.amount_minor,
            currency_code: self.currency_code.clone(),
            category_id: self.category_id.clone(),
            payment_method_id: self.payment_method_id.clone(),
            transfer_to_payment_method_id: self.transfer_to_payment_method_id.clone(),
            transfer_to_amount_minor: self.transfer_to_amount_minor,
            transfer_to_currency_code: self.transfer_to_currency_code.clone(),
            household_member_id: None,
            location_id: None,
            merchant: self.merchant.clone(),
            note: self.note.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTransactionTemplateInput {
    pub id: Option<String>,
    pub name: String,
    pub data: TransactionTemplateData,
    pub is_active: bool,
}

impl SaveTransactionTemplateInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let name = self.name.trim();
        if name.is_empty() || name.len() > 120 {
            return Err(AppError::validation(
                "name",
                "模板名称必须为 1 到 120 个字符",
            ));
        }
        if self.id.as_ref().is_some_and(|id| id.trim().is_empty()) {
            return Err(AppError::validation("id", "模板 ID 无效"));
        }
        self.data.validate()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionTemplateIdInput {
    pub id: String,
}

impl TransactionTemplateIdInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id.trim().is_empty() {
            return Err(AppError::validation("id", "模板 ID 无效"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionTemplateRecord {
    pub id: String,
    pub name: String,
    pub data: TransactionTemplateData,
    pub usage_count: i64,
    pub last_used_at: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_template_keeps_transaction_constraints() {
        let data = TransactionTemplateData {
            transaction_type: TransactionType::Transfer,
            status: TransactionStatus::Completed,
            amount_minor: 1_000,
            currency_code: "CAD".into(),
            category_id: None,
            payment_method_id: Some("same".into()),
            transfer_to_payment_method_id: Some("same".into()),
            transfer_to_amount_minor: Some(1_000),
            transfer_to_currency_code: Some("CAD".into()),
            merchant: None,
            note: None,
        };

        assert!(data.validate().is_err());
    }
}
