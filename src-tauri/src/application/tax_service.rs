use crate::domain::tax::{
    ExportTaxPackageInput, ExportTaxPackageResult, SaveTaxTagInput, SetTransactionTaxTagInput,
    TaxOrganizer, TaxTagMutationResult, TaxTagRecord, TaxYearInput,
};
use crate::error::AppError;
use crate::repositories::tax_repository::TaxRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct TaxService {
    repository: Arc<TaxRepository>,
}

impl TaxService {
    pub fn new(repository: Arc<TaxRepository>) -> Self {
        Self { repository }
    }

    pub async fn get_organizer(&self, input: TaxYearInput) -> Result<TaxOrganizer, AppError> {
        self.repository.get_organizer(&input).await
    }

    pub async fn set_transaction_tag(
        &self,
        input: SetTransactionTaxTagInput,
    ) -> Result<TaxTagMutationResult, AppError> {
        self.repository.set_transaction_tag(&input).await
    }

    pub async fn save_tag(&self, input: SaveTaxTagInput) -> Result<TaxTagRecord, AppError> {
        self.repository.save_tag(&input).await
    }

    pub async fn export_package(
        &self,
        input: ExportTaxPackageInput,
    ) -> Result<ExportTaxPackageResult, AppError> {
        crate::application::tax_export::export_tax_package(&self.repository, &input).await
    }
}
