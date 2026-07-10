use crate::domain::global_search::{GlobalSearchInput, GlobalSearchPage};
use crate::error::AppError;
use crate::repositories::global_search_repository::GlobalSearchRepository;
use std::sync::Arc;

#[derive(Clone)]
pub struct GlobalSearchService {
    repository: Arc<GlobalSearchRepository>,
}

impl GlobalSearchService {
    pub fn new(repository: Arc<GlobalSearchRepository>) -> Self {
        Self { repository }
    }

    pub async fn search(&self, input: GlobalSearchInput) -> Result<GlobalSearchPage, AppError> {
        input.validated()?;
        self.repository.search(&input).await
    }
}
