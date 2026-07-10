use crate::domain::daily_summary::{DailyFinancialSummary, DailyFinancialSummaryInput};
use crate::error::AppError;
use crate::repositories::daily_summary_repository::DailySummaryRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct DailySummaryService {
    repository: Arc<DailySummaryRepository>,
}

impl DailySummaryService {
    pub fn new(repository: Arc<DailySummaryRepository>) -> Self {
        Self { repository }
    }

    pub async fn list(
        &self,
        input: DailyFinancialSummaryInput,
    ) -> Result<Vec<DailyFinancialSummary>, AppError> {
        self.repository.list(&input).await
    }
}
