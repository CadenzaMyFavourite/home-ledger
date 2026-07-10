use crate::domain::transactions::{
    BatchCategoryUpdateInput, BatchEditTransactionsInput, BatchEditTransactionsResult,
    BatchTransactionItemsInput, BatchTransactionMutationResult, CreateTransactionInput,
    ListTransactionsInput, TransactionMutationResult, TransactionPage, TransactionRecord,
    TransactionStatus, TransactionSuggestion, TransactionSuggestionInput, TransactionType,
    TransactionVersionInput, UndoBatchEditInput, UpdateTransactionInput,
};
use crate::error::AppError;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use crate::repositories::transaction_repository::TransactionRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct TransactionService {
    transaction_repository: Arc<TransactionRepository>,
    reference_repository: Arc<ReferenceDataRepository>,
}

struct PreparedTransaction {
    input: CreateTransactionInput,
    reporting_amount_minor: Option<i64>,
    reporting_currency_code: Option<String>,
    review_flag_types: Vec<&'static str>,
}

impl TransactionService {
    pub fn new(
        transaction_repository: Arc<TransactionRepository>,
        reference_repository: Arc<ReferenceDataRepository>,
    ) -> Self {
        Self {
            transaction_repository,
            reference_repository,
        }
    }

    pub async fn list(&self, input: ListTransactionsInput) -> Result<TransactionPage, AppError> {
        input.validated_limit()?;
        self.transaction_repository.list(&input).await
    }

    pub async fn suggest(
        &self,
        input: TransactionSuggestionInput,
    ) -> Result<TransactionSuggestion, AppError> {
        input.validate()?;
        self.transaction_repository.suggest(&input).await
    }

    pub async fn create(
        &self,
        input: CreateTransactionInput,
    ) -> Result<TransactionRecord, AppError> {
        let prepared = self.prepare(input).await?;
        self.transaction_repository
            .create(
                &prepared.input,
                prepared.reporting_amount_minor,
                prepared.reporting_currency_code.as_deref(),
                &prepared.review_flag_types,
            )
            .await
    }

    pub async fn update(
        &self,
        input: UpdateTransactionInput,
    ) -> Result<TransactionRecord, AppError> {
        input.validate_identity()?;
        let id = input.id;
        let version = input.version;
        let prepared = self.prepare(input.transaction).await?;
        let normalized = UpdateTransactionInput {
            id,
            version,
            transaction: prepared.input,
        };
        self.transaction_repository
            .update(
                &normalized,
                prepared.reporting_amount_minor,
                prepared.reporting_currency_code.as_deref(),
                &prepared.review_flag_types,
            )
            .await
    }

    pub async fn soft_delete(
        &self,
        input: TransactionVersionInput,
    ) -> Result<TransactionMutationResult, AppError> {
        input.validate()?;
        self.transaction_repository.soft_delete(&input).await
    }

    pub async fn restore(
        &self,
        input: TransactionVersionInput,
    ) -> Result<TransactionRecord, AppError> {
        input.validate()?;
        self.transaction_repository.restore(&input).await
    }

    pub async fn batch_update_category(
        &self,
        input: BatchCategoryUpdateInput,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        input.validate()?;
        let category = if let Some(category_id) = input.category_id.as_deref() {
            let category = self
                .reference_repository
                .get_category(category_id)
                .await?
                .ok_or_else(|| AppError::not_found("category", "所选分类不存在"))?;
            if !category.is_active {
                return Err(AppError::validation("categoryId", "所选分类已停用"));
            }
            Some(category)
        } else {
            None
        };
        let category_type = category
            .as_ref()
            .map(|category| category.category_type.as_str());
        let possible_tax_candidate = category.as_ref().is_some_and(is_possible_tax_category);
        self.transaction_repository
            .batch_update_category(&input, category_type, possible_tax_candidate)
            .await
    }

    pub async fn batch_soft_delete(
        &self,
        input: BatchTransactionItemsInput,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        input.validate()?;
        self.transaction_repository.batch_soft_delete(&input).await
    }

    pub async fn batch_restore(
        &self,
        input: BatchTransactionItemsInput,
    ) -> Result<BatchTransactionMutationResult, AppError> {
        input.validate()?;
        self.transaction_repository.batch_restore(&input).await
    }

    pub async fn batch_edit(
        &self,
        input: BatchEditTransactionsInput,
    ) -> Result<BatchEditTransactionsResult, AppError> {
        input.validate()?;
        let mut possible_tax_candidate = false;
        let category_type = if let Some(category_patch) = input.patch.category.as_ref() {
            if let Some(category_id) = category_patch.value.as_deref() {
                let category = self
                    .reference_repository
                    .get_category(category_id)
                    .await?
                    .ok_or_else(|| AppError::not_found("category", "所选分类不存在"))?;
                if !category.is_active {
                    return Err(AppError::validation("categoryId", "所选分类已停用"));
                }
                possible_tax_candidate = is_possible_tax_category(&category);
                Some(Some(category.category_type))
            } else {
                Some(None)
            }
        } else {
            None
        };
        if let Some(payment_method_id) = input
            .patch
            .payment_method
            .as_ref()
            .and_then(|patch| patch.value.as_deref())
            && !self
                .reference_repository
                .payment_method_is_active(payment_method_id)
                .await?
        {
            return Err(AppError::validation(
                "paymentMethodId",
                "所选支付方式不存在或已停用",
            ));
        }
        if let Some(member_id) = input
            .patch
            .household_member
            .as_ref()
            .and_then(|patch| patch.value.as_deref())
            && !self
                .reference_repository
                .household_member_is_active(member_id)
                .await?
        {
            return Err(AppError::validation(
                "householdMemberId",
                "所选家庭成员不存在或已停用",
            ));
        }
        self.transaction_repository
            .batch_edit(&input, category_type, possible_tax_candidate)
            .await
    }

    pub async fn undo_batch_edit(
        &self,
        input: UndoBatchEditInput,
    ) -> Result<BatchEditTransactionsResult, AppError> {
        input.validate()?;
        self.transaction_repository.undo_batch_edit(&input).await
    }

    async fn prepare(
        &self,
        mut input: CreateTransactionInput,
    ) -> Result<PreparedTransaction, AppError> {
        input.validate_shape()?;

        if input.household_member_id.is_none() {
            input.household_member_id = Some(
                self.reference_repository
                    .default_household_member_id()
                    .await?,
            );
        }
        if let Some(household_member_id) = input.household_member_id.as_deref()
            && !self
                .reference_repository
                .household_member_is_active(household_member_id)
                .await?
        {
            return Err(AppError::validation(
                "householdMemberId",
                "所选家庭成员不存在或已停用",
            ));
        }
        if let Some(location_id) = input.location_id.as_deref()
            && !self
                .reference_repository
                .location_is_active(location_id)
                .await?
        {
            return Err(AppError::validation("locationId", "所选地点不存在或已停用"));
        }

        let category = if let Some(category_id) = input.category_id.as_deref() {
            let category = self
                .reference_repository
                .get_category(category_id)
                .await?
                .ok_or_else(|| AppError::not_found("category", "所选分类不存在"))?;
            if !category.is_active {
                return Err(AppError::validation("categoryId", "所选分类已停用"));
            }
            if category.category_type != input.transaction_type.as_str() {
                return Err(AppError::validation("categoryId", "分类与交易类型不一致"));
            }
            Some(category)
        } else {
            None
        };

        if let Some(payment_method_id) = input.payment_method_id.as_deref()
            && !self
                .reference_repository
                .payment_method_is_active(payment_method_id)
                .await?
        {
            return Err(AppError::validation(
                "paymentMethodId",
                "所选支付方式不存在或已停用",
            ));
        }
        if let Some(payment_method_id) = input.transfer_to_payment_method_id.as_deref()
            && !self
                .reference_repository
                .payment_method_is_active(payment_method_id)
                .await?
        {
            return Err(AppError::validation(
                "transferToPaymentMethodId",
                "所选转入账户不存在或已停用",
            ));
        }

        let reporting_currency = self.reference_repository.reporting_currency_code().await?;
        let (reporting_amount_minor, reporting_currency_code) =
            match (&input.transaction_type, &input.status) {
                (
                    TransactionType::Income | TransactionType::Expense,
                    TransactionStatus::Completed,
                ) => {
                    if input.currency_code != reporting_currency {
                        return Err(AppError::validation(
                            "currencyCode",
                            "已完成的外币交易需要先提供人工确认的换算金额",
                        ));
                    }
                    (Some(input.amount_minor), Some(reporting_currency))
                }
                _ => (None, None),
            };

        let mut flags = Vec::new();
        if !matches!(input.transaction_type, TransactionType::Transfer)
            && matches!(input.status, TransactionStatus::Completed)
            && category.is_none()
        {
            flags.push("uncategorized");
        }
        if matches!(input.transaction_type, TransactionType::Expense)
            && category.as_ref().is_some_and(is_possible_tax_category)
        {
            flags.push("possible_tax_candidate");
        }

        Ok(PreparedTransaction {
            input,
            reporting_amount_minor,
            reporting_currency_code,
            review_flag_types: flags,
        })
    }
}

fn is_possible_tax_category(category: &crate::domain::reference_data::Category) -> bool {
    const POSSIBLE_NAMES: [&str; 6] =
        ["教育", "医疗", "车辆", "家庭办公", "慈善捐赠", "出租房相关"];
    POSSIBLE_NAMES.contains(&category.name.as_str())
        || category
            .parent_name
            .as_deref()
            .is_some_and(|name| POSSIBLE_NAMES.contains(&name))
}
