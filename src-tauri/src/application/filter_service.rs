use crate::domain::filters::{
    SaveTransactionFilterInput, TransactionFilterIdInput, TransactionSavedFilterRecord,
};
use crate::error::AppError;
use crate::repositories::filter_repository::FilterRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct FilterService {
    repository: Arc<FilterRepository>,
}

impl FilterService {
    pub fn new(repository: Arc<FilterRepository>) -> Self {
        Self { repository }
    }

    pub async fn list_transaction_filters(
        &self,
    ) -> Result<Vec<TransactionSavedFilterRecord>, AppError> {
        self.repository.list_transaction_filters().await
    }

    pub async fn save_transaction_filter(
        &self,
        input: SaveTransactionFilterInput,
    ) -> Result<TransactionSavedFilterRecord, AppError> {
        input.validate()?;
        self.repository.save_transaction_filter(&input).await
    }

    pub async fn delete_transaction_filter(
        &self,
        input: TransactionFilterIdInput,
    ) -> Result<(), AppError> {
        input.validate()?;
        self.repository.delete_transaction_filter(&input.id).await
    }
}
