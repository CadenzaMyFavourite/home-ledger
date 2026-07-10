use crate::AppState;
use crate::domain::reminders::{
    ListReminderDeliveriesInput, ReminderDeliveryActionInput, ReminderDeliveryRecord,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_reminder_deliveries(
    input: ListReminderDeliveriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReminderDeliveryRecord>, CommandError> {
    state.reminder_service.list(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn mark_reminder_delivered(
    input: ReminderDeliveryActionInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .reminder_service
        .deliver(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn dismiss_reminder(
    input: ReminderDeliveryActionInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state
        .reminder_service
        .dismiss(input)
        .await
        .map_err(Into::into)
}
