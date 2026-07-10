use crate::domain::reference_data::{
    Category, HouseholdMember, Location, PaymentMethod, SaveCategoryInput,
    SaveHouseholdMemberInput, SaveLocationInput, SavePaymentMethodInput, TransactionReferenceData,
};
use crate::error::AppError;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct ReferenceDataService {
    repository: Arc<ReferenceDataRepository>,
}

impl ReferenceDataService {
    pub fn new(repository: Arc<ReferenceDataRepository>) -> Self {
        Self { repository }
    }

    pub async fn list_transaction_reference_data(
        &self,
    ) -> Result<TransactionReferenceData, AppError> {
        self.repository.list_transaction_reference_data().await
    }

    pub async fn save_category(&self, input: SaveCategoryInput) -> Result<Category, AppError> {
        input.validate()?;
        if let Some(existing_id) = input.id.as_deref() {
            let existing = self
                .repository
                .get_category(existing_id)
                .await?
                .ok_or_else(|| AppError::not_found("category", "分类不存在"))?;
            if existing.category_type != input.category_type {
                return Err(AppError::validation(
                    "categoryType",
                    "已有分类不能更改收入/支出类型；请新建分类并停用旧分类",
                ));
            }
            if input.parent_id.is_some()
                && self.repository.category_has_children(existing_id).await?
            {
                return Err(AppError::validation(
                    "parentId",
                    "包含子分类的分类不能再设置父分类",
                ));
            }
        }
        if let Some(parent_id) = input.parent_id.as_deref() {
            let parent = self
                .repository
                .get_category(parent_id)
                .await?
                .ok_or_else(|| AppError::not_found("category", "父分类不存在"))?;
            if parent.parent_id.is_some() {
                return Err(AppError::validation("parentId", "分类最多支持两级"));
            }
            if parent.category_type != input.category_type {
                return Err(AppError::validation(
                    "parentId",
                    "父子分类的交易类型必须一致",
                ));
            }
            if input.is_active && !parent.is_active {
                return Err(AppError::validation(
                    "parentId",
                    "启用的子分类不能属于已停用父分类",
                ));
            }
        }
        self.repository.save_category(&input).await
    }

    pub async fn save_payment_method(
        &self,
        input: SavePaymentMethodInput,
    ) -> Result<PaymentMethod, AppError> {
        input.validate()?;
        self.repository.save_payment_method(&input).await
    }

    pub async fn save_household_member(
        &self,
        input: SaveHouseholdMemberInput,
    ) -> Result<HouseholdMember, AppError> {
        input.validate()?;
        self.repository.save_household_member(&input).await
    }

    pub async fn save_location(&self, input: SaveLocationInput) -> Result<Location, AppError> {
        input.validate()?;
        self.repository.save_location(&input).await
    }
}
