use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlobalSearchInput {
    pub query: String,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl GlobalSearchInput {
    pub fn validated(&self) -> Result<(String, i64, i64), AppError> {
        let query = self.query.trim();
        if query.chars().count() < 2 || query.chars().count() > 100 {
            return Err(AppError::validation(
                "query",
                "全局搜索必须包含 2 到 100 个字符",
            ));
        }
        if query.chars().any(char::is_control) {
            return Err(AppError::validation("query", "全局搜索不能包含控制字符"));
        }
        let limit = self.limit.unwrap_or(30);
        let offset = self.offset.unwrap_or(0);
        if !(1..=100).contains(&limit) || offset < 0 {
            return Err(AppError::validation("limit", "搜索分页参数无效"));
        }
        Ok((escape_like(query), limit, offset))
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GlobalSearchKind {
    Transaction,
    Event,
    Attachment,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchResult {
    pub kind: GlobalSearchKind,
    pub id: String,
    pub owner_type: String,
    pub owner_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub occurred_on: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchPage {
    pub records: Vec<GlobalSearchResult>,
    pub total: i64,
}

fn escape_like(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_input_is_bounded_and_escapes_wildcards() {
        let input = GlobalSearchInput {
            query: "50%_off".into(),
            limit: Some(20),
            offset: Some(0),
        };
        assert_eq!(input.validated().unwrap().0, "%50\\%\\_off%");
        assert!(
            GlobalSearchInput {
                query: "x".into(),
                limit: None,
                offset: None
            }
            .validated()
            .is_err()
        );
    }
}
