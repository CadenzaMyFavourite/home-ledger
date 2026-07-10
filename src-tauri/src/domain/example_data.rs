use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExampleDataStatus {
    pub loaded: bool,
    pub transaction_count: i64,
}
