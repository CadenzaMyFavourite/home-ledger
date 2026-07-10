use crate::domain::templates::{
    SaveTransactionTemplateInput, TransactionTemplateIdInput, TransactionTemplateRecord,
};
use crate::error::AppError;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use crate::repositories::template_repository::TemplateRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct TemplateService {
    repository: Arc<TemplateRepository>,
    reference_repository: Arc<ReferenceDataRepository>,
}

impl TemplateService {
    pub fn new(
        repository: Arc<TemplateRepository>,
        reference_repository: Arc<ReferenceDataRepository>,
    ) -> Self {
        Self {
            repository,
            reference_repository,
        }
    }

    pub async fn list_transaction_templates(
        &self,
        include_inactive: bool,
    ) -> Result<Vec<TransactionTemplateRecord>, AppError> {
        self.repository
            .list_transaction_templates(include_inactive)
            .await
    }

    pub async fn save_transaction_template(
        &self,
        input: SaveTransactionTemplateInput,
    ) -> Result<TransactionTemplateRecord, AppError> {
        input.validate()?;
        if let Some(category_id) = input.data.category_id.as_deref() {
            let category = self
                .reference_repository
                .get_category(category_id)
                .await?
                .ok_or_else(|| AppError::not_found("category", "模板分类不存在"))?;
            if !category.is_active {
                return Err(AppError::validation("categoryId", "模板分类已停用"));
            }
            if category.category_type != input.data.transaction_type.as_str() {
                return Err(AppError::validation(
                    "categoryId",
                    "模板分类与交易类型不一致",
                ));
            }
        }
        for (field, payment_method_id) in [
            ("paymentMethodId", input.data.payment_method_id.as_deref()),
            (
                "transferToPaymentMethodId",
                input.data.transfer_to_payment_method_id.as_deref(),
            ),
        ] {
            if let Some(payment_method_id) = payment_method_id
                && !self
                    .reference_repository
                    .payment_method_is_active(payment_method_id)
                    .await?
            {
                return Err(AppError::validation(field, "模板支付方式不存在或已停用"));
            }
        }
        self.repository.save_transaction_template(&input).await
    }

    pub async fn use_transaction_template(
        &self,
        input: TransactionTemplateIdInput,
    ) -> Result<TransactionTemplateRecord, AppError> {
        input.validate()?;
        self.repository.use_transaction_template(&input.id).await
    }
}
