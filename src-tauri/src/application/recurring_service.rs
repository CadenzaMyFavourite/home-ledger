use crate::domain::recurring::{
    MaterializeRecurringInput, MaterializeRecurringResult, RecurringEventRecord,
    RecurringTransactionRecord, SaveRecurringEventInput, SaveRecurringTransactionInput,
};
use crate::error::AppError;
use crate::repositories::recurring_repository::RecurringRepository;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct RecurringService {
    repository: Arc<RecurringRepository>,
    references: Arc<ReferenceDataRepository>,
}

impl RecurringService {
    pub fn new(
        repository: Arc<RecurringRepository>,
        references: Arc<ReferenceDataRepository>,
    ) -> Self {
        Self {
            repository,
            references,
        }
    }

    pub async fn list(&self) -> Result<Vec<RecurringTransactionRecord>, AppError> {
        self.repository.list().await
    }

    pub async fn list_events(&self) -> Result<Vec<RecurringEventRecord>, AppError> {
        self.repository.list_events().await
    }

    pub async fn save_event(
        &self,
        mut input: SaveRecurringEventInput,
    ) -> Result<RecurringEventRecord, AppError> {
        input.validate()?;
        if input.template.household_member_id.is_none() {
            input.template.household_member_id =
                Some(self.references.default_household_member_id().await?);
        }
        if let Some(member_id) = input.template.household_member_id.as_deref()
            && !self
                .references
                .household_member_is_active(member_id)
                .await?
        {
            return Err(AppError::validation(
                "householdMemberId",
                "所选家庭成员不存在或已停用",
            ));
        }
        if let Some(location_id) = input.template.location_id.as_deref()
            && !self.references.location_is_active(location_id).await?
        {
            return Err(AppError::validation("locationId", "所选地点不存在或已停用"));
        }
        self.repository.save_event(&input).await
    }

    pub async fn save(
        &self,
        input: SaveRecurringTransactionInput,
    ) -> Result<RecurringTransactionRecord, AppError> {
        input.validate()?;
        let template = &input.template;
        if let Some(category_id) = template.category_id.as_deref() {
            let category = self
                .references
                .get_category(category_id)
                .await?
                .filter(|category| category.is_active)
                .ok_or_else(|| AppError::validation("categoryId", "所选分类不存在或已停用"))?;
            if category.category_type != template.transaction_type.as_str() {
                return Err(AppError::validation("categoryId", "分类与交易类型不匹配"));
            }
        }
        for payment_id in [
            template.payment_method_id.as_deref(),
            template.transfer_to_payment_method_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !self.references.payment_method_is_active(payment_id).await? {
                return Err(AppError::validation(
                    "paymentMethodId",
                    "所选支付方式不存在或已停用",
                ));
            }
        }
        if let Some(member_id) = template.household_member_id.as_deref()
            && !self
                .references
                .household_member_is_active(member_id)
                .await?
        {
            return Err(AppError::validation(
                "householdMemberId",
                "所选家庭成员不存在或已停用",
            ));
        }
        if let Some(location_id) = template.location_id.as_deref()
            && !self.references.location_is_active(location_id).await?
        {
            return Err(AppError::validation("locationId", "所选地点不存在或已停用"));
        }
        self.repository.save(&input).await
    }

    pub async fn materialize(
        &self,
        input: MaterializeRecurringInput,
    ) -> Result<MaterializeRecurringResult, AppError> {
        self.repository.materialize(input.date()?).await
    }
}
