use crate::domain::reminders::{
    ListReminderDeliveriesInput, ReminderDeliveryActionInput, ReminderDeliveryRecord,
};
use crate::error::AppError;
use crate::repositories::reminder_repository::ReminderRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct ReminderService {
    repository: Arc<ReminderRepository>,
}

impl ReminderService {
    pub fn new(repository: Arc<ReminderRepository>) -> Self {
        Self { repository }
    }

    pub async fn list(
        &self,
        input: ListReminderDeliveriesInput,
    ) -> Result<Vec<ReminderDeliveryRecord>, AppError> {
        self.repository.list(&input).await
    }

    pub async fn deliver(&self, input: ReminderDeliveryActionInput) -> Result<(), AppError> {
        self.repository.set_status(&input, "delivered").await
    }

    pub async fn dismiss(&self, input: ReminderDeliveryActionInput) -> Result<(), AppError> {
        self.repository.set_status(&input, "dismissed").await
    }
}
