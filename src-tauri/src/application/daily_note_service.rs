use crate::domain::daily_notes::{
    DailyNoteRecord, DeleteDailyNoteInput, GetDailyNoteInput, SaveDailyNoteInput,
};
use crate::error::AppError;
use crate::repositories::daily_note_repository::DailyNoteRepository;
use crate::repositories::reference_data_repository::ReferenceDataRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct DailyNoteService {
    repository: Arc<DailyNoteRepository>,
    references: Arc<ReferenceDataRepository>,
}

impl DailyNoteService {
    pub fn new(
        repository: Arc<DailyNoteRepository>,
        references: Arc<ReferenceDataRepository>,
    ) -> Self {
        Self {
            repository,
            references,
        }
    }

    pub async fn get(&self, input: GetDailyNoteInput) -> Result<Option<DailyNoteRecord>, AppError> {
        input.validate()?;
        self.repository.get(&input).await
    }

    pub async fn save(&self, input: SaveDailyNoteInput) -> Result<DailyNoteRecord, AppError> {
        input.validate()?;
        if let Some(member_id) = input.household_member_id.as_deref()
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
        self.repository.save(&input).await
    }

    pub async fn delete(&self, input: DeleteDailyNoteInput) -> Result<(), AppError> {
        input.validate()?;
        self.repository.delete(&input).await
    }
}
