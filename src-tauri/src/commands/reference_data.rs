use crate::AppState;
use crate::domain::reference_data::{
    Category, HouseholdMember, Location, PaymentMethod, SaveCategoryInput,
    SaveHouseholdMemberInput, SaveLocationInput, SavePaymentMethodInput, TransactionReferenceData,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_transaction_reference_data(
    state: State<'_, AppState>,
) -> Result<TransactionReferenceData, CommandError> {
    state
        .reference_data_service
        .list_transaction_reference_data()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_category(
    input: SaveCategoryInput,
    state: State<'_, AppState>,
) -> Result<Category, CommandError> {
    state
        .reference_data_service
        .save_category(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_payment_method(
    input: SavePaymentMethodInput,
    state: State<'_, AppState>,
) -> Result<PaymentMethod, CommandError> {
    state
        .reference_data_service
        .save_payment_method(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_household_member(
    input: SaveHouseholdMemberInput,
    state: State<'_, AppState>,
) -> Result<HouseholdMember, CommandError> {
    state
        .reference_data_service
        .save_household_member(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn save_location(
    input: SaveLocationInput,
    state: State<'_, AppState>,
) -> Result<Location, CommandError> {
    state
        .reference_data_service
        .save_location(input)
        .await
        .map_err(Into::into)
}
