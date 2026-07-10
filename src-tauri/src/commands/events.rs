use crate::AppState;
use crate::domain::events::{
    CalendarEventIdInput, CalendarEventRecord, CalendarEventVersionInput, CreateCalendarEventInput,
    EventTransactionLinkInput, ListCalendarEventsInput, UpdateCalendarEventInput,
};
use crate::error::CommandError;
use tauri::State;

#[tauri::command]
pub async fn list_calendar_events(
    input: ListCalendarEventsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CalendarEventRecord>, CommandError> {
    state.event_service.list(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn get_calendar_event(
    input: CalendarEventIdInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state.event_service.get(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn create_calendar_event(
    input: CreateCalendarEventInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state.event_service.create(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn update_calendar_event(
    input: UpdateCalendarEventInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state.event_service.update(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn delete_calendar_event(
    input: CalendarEventVersionInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventVersionInput, CommandError> {
    state
        .event_service
        .soft_delete(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn restore_calendar_event(
    input: CalendarEventVersionInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state.event_service.restore(input).await.map_err(Into::into)
}

#[tauri::command]
pub async fn link_event_transaction(
    input: EventTransactionLinkInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state
        .event_service
        .link_transaction(input)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn unlink_event_transaction(
    input: EventTransactionLinkInput,
    state: State<'_, AppState>,
) -> Result<CalendarEventRecord, CommandError> {
    state
        .event_service
        .unlink_transaction(input)
        .await
        .map_err(Into::into)
}
