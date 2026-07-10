use crate::domain::financial_summary::{
    ExportFinancialReportInput, ExportFinancialReportResult, FinancialSummary,
    FinancialSummaryInput, ReportNoteQueryInput, ReportNoteRecord, ReviewCandidateActionInput,
    SaveReportNoteInput,
};
use crate::error::AppError;
use crate::repositories::financial_summary_repository::FinancialSummaryRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct FinancialSummaryService {
    repository: Arc<FinancialSummaryRepository>,
}

impl FinancialSummaryService {
    pub fn new(repository: Arc<FinancialSummaryRepository>) -> Self {
        Self { repository }
    }

    pub async fn get(&self, input: FinancialSummaryInput) -> Result<FinancialSummary, AppError> {
        self.repository.get(&input).await
    }

    pub async fn set_review_status(
        &self,
        input: ReviewCandidateActionInput,
    ) -> Result<ReviewCandidateActionInput, AppError> {
        self.repository.set_review_status(&input).await
    }

    pub async fn get_report_note(
        &self,
        input: ReportNoteQueryInput,
    ) -> Result<Option<ReportNoteRecord>, AppError> {
        self.repository.get_report_note(&input).await
    }

    pub async fn save_report_note(
        &self,
        input: SaveReportNoteInput,
    ) -> Result<ReportNoteRecord, AppError> {
        self.repository.save_report_note(&input).await
    }

    pub async fn export_report(
        &self,
        input: ExportFinancialReportInput,
    ) -> Result<ExportFinancialReportResult, AppError> {
        crate::application::report_export::export_report(&self.repository, &input).await
    }
}
