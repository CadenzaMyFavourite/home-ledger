use crate::domain::csv_import::{
    AnalyzeCsvImportInput, CommitCsvImportInput, CsvImportAnalysis, CsvImportBatchInput,
    CsvImportCommitResult, CsvImportPreview, CsvImportUndoResult, PreviewCsvImportInput,
};
use crate::error::AppError;
use crate::repositories::csv_import_repository::CsvImportRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct CsvImportService {
    repository: Arc<CsvImportRepository>,
}

impl CsvImportService {
    pub fn new(repository: Arc<CsvImportRepository>) -> Self {
        Self { repository }
    }

    pub async fn preview(
        &self,
        input: PreviewCsvImportInput,
    ) -> Result<CsvImportPreview, AppError> {
        self.repository.preview(&input).await
    }

    pub async fn analyze(
        &self,
        input: AnalyzeCsvImportInput,
    ) -> Result<CsvImportAnalysis, AppError> {
        self.repository.analyze(&input).await
    }

    pub async fn commit(
        &self,
        input: CommitCsvImportInput,
    ) -> Result<CsvImportCommitResult, AppError> {
        self.repository.commit(&input).await
    }

    pub async fn undo(&self, input: CsvImportBatchInput) -> Result<CsvImportUndoResult, AppError> {
        self.repository.undo(&input).await
    }
}
