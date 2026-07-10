use crate::domain::events::{
    CalendarEventIdInput, CalendarEventRecord, CalendarEventVersionInput, CreateCalendarEventInput,
    EventTransactionLinkInput, ListCalendarEventsInput, UpdateCalendarEventInput,
};
use crate::error::AppError;
use crate::repositories::event_repository::EventRepository;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct EventService {
    repository: Arc<EventRepository>,
    reference_repository: Arc<ReferenceDataRepository>,
}

impl EventService {
    pub fn new(
        repository: Arc<EventRepository>,
        reference_repository: Arc<ReferenceDataRepository>,
    ) -> Self {
        Self {
            repository,
            reference_repository,
        }
    }

    pub async fn list(
        &self,
        input: ListCalendarEventsInput,
    ) -> Result<Vec<CalendarEventRecord>, AppError> {
        self.repository.list(&input.prepare()?).await
    }

    pub async fn get(&self, input: CalendarEventIdInput) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.repository.get(&input.id).await
    }

    pub async fn create(
        &self,
        mut input: CreateCalendarEventInput,
    ) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.prepare_references(&mut input).await?;
        self.repository.create(&input).await
    }

    pub async fn update(
        &self,
        mut input: UpdateCalendarEventInput,
    ) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.prepare_references(&mut input.event).await?;
        self.repository.update(&input).await
    }

    pub async fn soft_delete(
        &self,
        input: CalendarEventVersionInput,
    ) -> Result<CalendarEventVersionInput, AppError> {
        input.validate()?;
        self.repository.soft_delete(&input).await
    }

    pub async fn restore(
        &self,
        input: CalendarEventVersionInput,
    ) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.repository.restore(&input).await
    }

    pub async fn link_transaction(
        &self,
        input: EventTransactionLinkInput,
    ) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.repository.set_transaction_link(&input, true).await
    }

    pub async fn unlink_transaction(
        &self,
        input: EventTransactionLinkInput,
    ) -> Result<CalendarEventRecord, AppError> {
        input.validate()?;
        self.repository.set_transaction_link(&input, false).await
    }

    async fn prepare_references(
        &self,
        input: &mut CreateCalendarEventInput,
    ) -> Result<(), AppError> {
        if input.household_member_id.is_none() {
            input.household_member_id = Some(
                self.reference_repository
                    .default_household_member_id()
                    .await?,
            );
        }
        if let Some(member_id) = input.household_member_id.as_deref()
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
        if let Some(location_id) = input.location_id.as_deref()
            && !self
                .reference_repository
                .location_is_active(location_id)
                .await?
        {
            return Err(AppError::validation("locationId", "所选地点不存在或已停用"));
        }
        Ok(())
    }
}
