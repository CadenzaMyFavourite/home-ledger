use crate::domain::settings::{AppSettings, UpdateSettingsInput};
use crate::error::AppError;
use crate::repositories::settings_repository::SettingsRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct SettingsService {
    repository: Arc<SettingsRepository>,
}

impl SettingsService {
    pub fn new(repository: Arc<SettingsRepository>) -> Self {
        Self { repository }
    }

    pub async fn get(&self) -> Result<AppSettings, AppError> {
        self.repository.get().await
    }

    pub async fn update(&self, input: UpdateSettingsInput) -> Result<AppSettings, AppError> {
        input.validate()?;
        self.repository.update(input).await
    }
}
