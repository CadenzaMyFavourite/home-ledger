mod application;
mod commands;
mod domain;
mod error;
mod infrastructure;
mod repositories;

use application::attachment_service::AttachmentService;
use application::backup_service::{
    BackupService, apply_pending_restore, finalize_applied_restore, reconcile_applied_restore,
    rollback_applied_restore,
};
use application::csv_import_service::CsvImportService;
use application::daily_note_service::DailyNoteService;
use application::daily_summary_service::DailySummaryService;
use application::event_service::EventService;
use application::example_data_service::ExampleDataService;
use application::filter_service::FilterService;
use application::financial_summary_service::FinancialSummaryService;
use application::global_search_service::GlobalSearchService;
use application::local_ai_service::LocalAiService;
use application::recurring_service::RecurringService;
use application::reference_data_service::ReferenceDataService;
use application::reminder_service::ReminderService;
use application::safe_query_service::SafeQueryService;
use application::settings_service::SettingsService;
use application::tax_service::TaxService;
use application::template_service::TemplateService;
use application::transaction_service::TransactionService;
use commands::{settings, system};
use infrastructure::database::open_database;
use repositories::settings_repository::SettingsRepository;
use repositories::template_repository::TemplateRepository;
use repositories::{
    attachment_repository::AttachmentRepository, csv_import_repository::CsvImportRepository,
    daily_note_repository::DailyNoteRepository, daily_summary_repository::DailySummaryRepository,
    event_repository::EventRepository, example_data_repository::ExampleDataRepository,
    filter_repository::FilterRepository, financial_summary_repository::FinancialSummaryRepository,
    global_search_repository::GlobalSearchRepository, local_ai_repository::LocalAiRepository,
    recurring_repository::RecurringRepository, reference_data_repository::ReferenceDataRepository,
    reminder_repository::ReminderRepository, tax_repository::TaxRepository,
    transaction_repository::TransactionRepository,
};
use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub attachment_service: AttachmentService,
    pub settings_service: SettingsService,
    pub backup_service: BackupService,
    pub csv_import_service: CsvImportService,
    pub reference_data_service: ReferenceDataService,
    pub transaction_service: TransactionService,
    pub template_service: TemplateService,
    pub filter_service: FilterService,
    pub example_data_service: ExampleDataService,
    pub event_service: EventService,
    pub recurring_service: RecurringService,
    pub reminder_service: ReminderService,
    pub daily_summary_service: DailySummaryService,
    pub daily_note_service: DailyNoteService,
    pub financial_summary_service: FinancialSummaryService,
    pub global_search_service: GlobalSearchService,
    pub local_ai_service: LocalAiService,
    pub safe_query_service: SafeQueryService,
    pub tax_service: TaxService,
    pub database: sqlx::SqlitePool,
}

fn initialise_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("home_ledger=info,warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    initialise_logging();

    let builder = tauri::Builder::default();
    #[cfg(feature = "desktop-e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("home-ledger.sqlite3");
            let restore_applied = apply_pending_restore(&app_data_dir)?;
            let database = match tauri::async_runtime::block_on(open_database(&database_path)) {
                Ok(database) => database,
                Err(error) if restore_applied => {
                    rollback_applied_restore(&app_data_dir)?;
                    tracing::error!(%error, "restored database failed to open; rollback applied");
                    tauri::async_runtime::block_on(open_database(&database_path))?
                }
                Err(error) => return Err(error.into()),
            };
            if restore_applied {
                tauri::async_runtime::block_on(reconcile_applied_restore(
                    &database,
                    &app_data_dir,
                ))?;
                finalize_applied_restore(&app_data_dir)?;
            }
            let settings_repository = Arc::new(SettingsRepository::new(database.clone()));
            let attachment_repository = Arc::new(AttachmentRepository::new(database.clone()));
            let csv_import_repository = Arc::new(CsvImportRepository::new(database.clone()));
            let reference_data_repository =
                Arc::new(ReferenceDataRepository::new(database.clone()));
            let transaction_repository = Arc::new(TransactionRepository::new(database.clone()));
            let template_repository = Arc::new(TemplateRepository::new(database.clone()));
            let filter_repository = Arc::new(FilterRepository::new(database.clone()));
            let example_data_repository = Arc::new(ExampleDataRepository::new(database.clone()));
            let event_repository = Arc::new(EventRepository::new(database.clone()));
            let recurring_repository = Arc::new(RecurringRepository::new(database.clone()));
            let reminder_repository = Arc::new(ReminderRepository::new(database.clone()));
            let daily_summary_repository = Arc::new(DailySummaryRepository::new(database.clone()));
            let daily_note_repository = Arc::new(DailyNoteRepository::new(database.clone()));
            let financial_summary_repository =
                Arc::new(FinancialSummaryRepository::new(database.clone()));
            let global_search_repository = Arc::new(GlobalSearchRepository::new(database.clone()));
            let local_ai_repository = Arc::new(LocalAiRepository::new(database.clone()));
            let tax_repository = Arc::new(TaxRepository::new(database.clone()));
            let settings_service = SettingsService::new(settings_repository);
            let attachment_service =
                AttachmentService::new(attachment_repository, app_data_dir.clone());
            let backup_service = BackupService::new(database.clone(), app_data_dir.clone());
            let csv_import_service = CsvImportService::new(csv_import_repository);
            let reference_data_service =
                ReferenceDataService::new(reference_data_repository.clone());
            let transaction_service =
                TransactionService::new(transaction_repository, reference_data_repository.clone());
            let template_service =
                TemplateService::new(template_repository, reference_data_repository.clone());
            let filter_service = FilterService::new(filter_repository);
            let example_data_service = ExampleDataService::new(example_data_repository);
            let event_service =
                EventService::new(event_repository, reference_data_repository.clone());
            let recurring_service =
                RecurringService::new(recurring_repository, reference_data_repository.clone());
            let reminder_service = ReminderService::new(reminder_repository);
            let daily_summary_service = DailySummaryService::new(daily_summary_repository);
            let daily_note_service =
                DailyNoteService::new(daily_note_repository, reference_data_repository.clone());
            let financial_summary_service =
                FinancialSummaryService::new(financial_summary_repository);
            let global_search_service = GlobalSearchService::new(global_search_repository);
            let local_ai_service = LocalAiService::new(local_ai_repository);
            let safe_query_service = SafeQueryService::new(database.clone());
            let tax_service = TaxService::new(tax_repository);

            app.manage(AppState {
                attachment_service,
                settings_service,
                backup_service: backup_service.clone(),
                csv_import_service,
                reference_data_service,
                transaction_service,
                template_service,
                filter_service,
                example_data_service,
                event_service,
                recurring_service,
                reminder_service,
                daily_summary_service,
                daily_note_service,
                financial_summary_service,
                global_search_service,
                local_ai_service,
                safe_query_service,
                tax_service,
                database,
            });
            tauri::async_runtime::spawn(async move {
                if let Err(error) = backup_service.run_scheduled_if_due().await {
                    tracing::error!(%error, "scheduled backup failed; application continues");
                }
            });
            tracing::info!(path = %database_path.display(), "local database ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::attachments::list_attachments,
            commands::attachments::pick_attachment,
            commands::attachments::open_attachment,
            commands::attachments::delete_attachment,
            commands::safe_query::validate_safe_query_plan,
            commands::safe_query::translate_safe_query,
            commands::global_search::global_search,
            settings::get_settings,
            settings::update_settings,
            commands::backup::list_backups,
            commands::backup::create_backup,
            commands::backup::verify_backup,
            commands::backup::stage_backup_restore,
            commands::csv_import::preview_csv_import,
            commands::csv_import::analyze_csv_import,
            commands::csv_import::commit_csv_import,
            commands::csv_import::undo_csv_import,
            system::get_app_status,
            commands::example_data::get_example_data_status,
            commands::example_data::load_example_data,
            commands::example_data::remove_example_data,
            commands::events::list_calendar_events,
            commands::events::get_calendar_event,
            commands::events::create_calendar_event,
            commands::events::update_calendar_event,
            commands::events::delete_calendar_event,
            commands::events::restore_calendar_event,
            commands::events::link_event_transaction,
            commands::events::unlink_event_transaction,
            commands::recurring::list_recurring_transactions,
            commands::recurring::list_recurring_events,
            commands::recurring::save_recurring_transaction,
            commands::recurring::save_recurring_event,
            commands::recurring::materialize_recurring_transactions,
            commands::reminders::list_reminder_deliveries,
            commands::reminders::mark_reminder_delivered,
            commands::reminders::dismiss_reminder,
            commands::daily_summary::list_daily_financial_summaries,
            commands::daily_notes::get_daily_note,
            commands::daily_notes::save_daily_note,
            commands::daily_notes::delete_daily_note,
            commands::financial_summary::get_financial_summary,
            commands::financial_summary::set_financial_review_candidate_status,
            commands::financial_summary::get_report_note,
            commands::financial_summary::save_report_note,
            commands::financial_summary::export_financial_report,
            commands::local_ai::list_ai_profiles,
            commands::local_ai::save_ai_profile,
            commands::local_ai::test_ai_connection,
            commands::local_ai::list_ai_summaries,
            commands::local_ai::generate_ai_summary,
            commands::local_ai::update_ai_summary,
            commands::local_ai::list_ai_suggestions,
            commands::local_ai::generate_ai_suggestions,
            commands::local_ai::review_ai_suggestion,
            commands::tax::get_tax_organizer,
            commands::tax::set_transaction_tax_tag,
            commands::tax::save_tax_tag,
            commands::tax::export_tax_package,
            commands::reference_data::list_transaction_reference_data,
            commands::reference_data::save_category,
            commands::reference_data::save_payment_method,
            commands::reference_data::save_household_member,
            commands::reference_data::save_location,
            commands::templates::list_transaction_templates,
            commands::templates::save_transaction_template,
            commands::templates::use_transaction_template,
            commands::filters::list_transaction_filters,
            commands::filters::save_transaction_filter,
            commands::filters::delete_transaction_filter,
            commands::transactions::list_transactions,
            commands::transactions::suggest_transaction,
            commands::transactions::create_transaction,
            commands::transactions::update_transaction,
            commands::transactions::delete_transaction,
            commands::transactions::restore_transaction,
            commands::transactions::batch_update_transaction_category,
            commands::transactions::batch_edit_transactions,
            commands::transactions::undo_batch_edit_transactions,
            commands::transactions::batch_delete_transactions,
            commands::transactions::batch_restore_transactions
        ])
        .run(tauri::generate_context!())
        .expect("HomeLedger failed to start");
}
