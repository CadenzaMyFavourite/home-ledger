use crate::domain::example_data::ExampleDataStatus;
use crate::error::AppError;
use crate::repositories::example_data_repository::ExampleDataRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct ExampleDataService {
    repository: Arc<ExampleDataRepository>,
}

impl ExampleDataService {
    pub fn new(repository: Arc<ExampleDataRepository>) -> Self {
        Self { repository }
    }

    pub async fn status(&self) -> Result<ExampleDataStatus, AppError> {
        self.repository.status().await
    }

    pub async fn load(&self) -> Result<ExampleDataStatus, AppError> {
        self.repository.load().await
    }

    pub async fn remove(&self) -> Result<ExampleDataStatus, AppError> {
        self.repository.remove().await
    }
}
