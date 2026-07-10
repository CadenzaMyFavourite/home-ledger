-- HomeLedger schema v1: recurrence, transactions, calendar, tags and attachments.

CREATE TABLE recurrence_rules (
    id TEXT PRIMARY KEY NOT NULL,
    timezone_id TEXT NOT NULL,
    dtstart_local TEXT NOT NULL,
    rrule TEXT NOT NULL,
    until_local TEXT,
    occurrence_count INTEGER CHECK (occurrence_count IS NULL OR occurrence_count > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE recurrence_exceptions (
    id TEXT PRIMARY KEY NOT NULL,
    recurrence_rule_id TEXT NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
    excluded_local_occurrence TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(recurrence_rule_id, excluded_local_occurrence)
) STRICT;

CREATE TABLE recurring_items (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    item_type TEXT NOT NULL CHECK (item_type IN ('transaction', 'event')),
    recurrence_rule_id TEXT NOT NULL REFERENCES recurrence_rules(id) ON DELETE RESTRICT,
    template_schema_version INTEGER NOT NULL CHECK (template_schema_version >= 1),
    template_json TEXT NOT NULL CHECK (json_valid(template_json)),
    default_transaction_status TEXT CHECK (
        default_transaction_status IS NULL OR default_transaction_status IN ('planned', 'pending')
    ),
    requires_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (requires_confirmation IN (0, 1)),
    auto_confirm_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_confirm_enabled IN (0, 1)),
    materialize_days_ahead INTEGER NOT NULL DEFAULT 30 CHECK (materialize_days_ahead BETWEEN 0 AND 730),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_evaluated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (item_type = 'transaction' OR default_transaction_status IS NULL),
    CHECK (auto_confirm_enabled = 0 OR requires_confirmation = 0)
) STRICT;

CREATE TABLE recurring_occurrences (
    id TEXT PRIMARY KEY NOT NULL,
    recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
    occurrence_key TEXT NOT NULL,
    scheduled_local TEXT NOT NULL,
    scheduled_at_utc TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'materialized', 'skipped', 'failed')),
    error_code TEXT,
    materialized_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(recurring_item_id, occurrence_key)
) STRICT;

CREATE TABLE import_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source_filename TEXT NOT NULL,
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
    parser_version INTEGER NOT NULL CHECK (parser_version >= 1),
    mapping_schema_version INTEGER NOT NULL CHECK (mapping_schema_version >= 1),
    mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json)),
    status TEXT NOT NULL CHECK (
        status IN ('previewed', 'committing', 'completed', 'partially_failed', 'undone', 'failed')
    ),
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    success_rows INTEGER NOT NULL DEFAULT 0 CHECK (success_rows >= 0),
    failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
    created_at TEXT NOT NULL,
    committed_at TEXT,
    undone_at TEXT
) STRICT;

CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_date TEXT NOT NULL CHECK (transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'transfer')),
    status TEXT NOT NULL CHECK (status IN ('planned', 'pending', 'completed', 'cancelled')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency_code TEXT NOT NULL CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
    reporting_amount_minor INTEGER CHECK (reporting_amount_minor IS NULL OR reporting_amount_minor >= 0),
    reporting_currency_code TEXT,
    fx_rate_numerator INTEGER CHECK (fx_rate_numerator IS NULL OR fx_rate_numerator > 0),
    fx_rate_denominator INTEGER CHECK (fx_rate_denominator IS NULL OR fx_rate_denominator > 0),
    category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE RESTRICT,
    transfer_to_payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE RESTRICT,
    transfer_to_amount_minor INTEGER CHECK (transfer_to_amount_minor IS NULL OR transfer_to_amount_minor >= 0),
    transfer_to_currency_code TEXT,
    household_member_id TEXT REFERENCES household_members(id) ON DELETE RESTRICT,
    location_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
    merchant TEXT,
    note TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('manual', 'recurring', 'import', 'template')),
    recurring_occurrence_id TEXT UNIQUE REFERENCES recurring_occurrences(id) ON DELETE RESTRICT,
    import_batch_id TEXT REFERENCES import_batches(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK ((reporting_amount_minor IS NULL) = (reporting_currency_code IS NULL)),
    CHECK ((fx_rate_numerator IS NULL) = (fx_rate_denominator IS NULL)),
    CHECK (reporting_currency_code IS NULL OR (length(reporting_currency_code) = 3 AND reporting_currency_code = upper(reporting_currency_code))),
    CHECK (transfer_to_currency_code IS NULL OR (length(transfer_to_currency_code) = 3 AND transfer_to_currency_code = upper(transfer_to_currency_code))),
    CHECK (
        (transaction_type = 'transfer'
            AND payment_method_id IS NOT NULL
            AND transfer_to_payment_method_id IS NOT NULL
            AND payment_method_id <> transfer_to_payment_method_id
            AND transfer_to_amount_minor IS NOT NULL
            AND transfer_to_currency_code IS NOT NULL
            AND reporting_amount_minor IS NULL
            AND category_id IS NULL)
        OR
        (transaction_type IN ('income', 'expense')
            AND transfer_to_payment_method_id IS NULL
            AND transfer_to_amount_minor IS NULL
            AND transfer_to_currency_code IS NULL)
    ),
    CHECK (status <> 'completed' OR transaction_type = 'transfer' OR reporting_amount_minor IS NOT NULL)
) STRICT;

CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    description TEXT,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('general', 'important', 'travel', 'medical', 'education', 'bill', 'tax', 'maintenance', 'other')
    ),
    is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
    start_date TEXT,
    end_date_exclusive TEXT,
    start_at_utc TEXT,
    end_at_utc TEXT,
    timezone_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important')),
    color TEXT,
    icon TEXT,
    location_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
    household_member_id TEXT REFERENCES household_members(id) ON DELETE RESTRICT,
    is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
    recurring_occurrence_id TEXT UNIQUE REFERENCES recurring_occurrences(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (
        (is_all_day = 1 AND start_date IS NOT NULL AND end_date_exclusive IS NOT NULL
            AND start_date < end_date_exclusive AND start_at_utc IS NULL AND end_at_utc IS NULL)
        OR
        (is_all_day = 0 AND start_date IS NULL AND end_date_exclusive IS NULL
            AND start_at_utc IS NOT NULL AND end_at_utc IS NOT NULL AND start_at_utc < end_at_utc)
    )
) STRICT;

CREATE TABLE event_transactions (
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(event_id, transaction_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE daily_notes (
    id TEXT PRIMARY KEY NOT NULL,
    note_date TEXT NOT NULL,
    household_member_id TEXT REFERENCES household_members(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
) STRICT;

CREATE UNIQUE INDEX daily_notes_one_per_member_day
    ON daily_notes(note_date, COALESCE(household_member_id, '')) WHERE deleted_at IS NULL;

CREATE TABLE tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    color TEXT,
    icon TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX tags_unique_name ON tags(name COLLATE NOCASE);

CREATE TABLE transaction_tags (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(transaction_id, tag_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE event_tags (
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(event_id, tag_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE transaction_tax_tags (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tax_tag_id TEXT NOT NULL REFERENCES tax_tags(id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('user', 'accepted_ai', 'import')),
    confirmed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(transaction_id, tax_tag_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    attachment_type TEXT NOT NULL CHECK (
        attachment_type IN ('receipt', 'invoice', 'image', 'pdf', 'contract', 'other')
    ),
    created_at TEXT NOT NULL,
    deleted_at TEXT
) STRICT;

CREATE TABLE transaction_attachments (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(transaction_id, attachment_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE event_attachments (
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(event_id, attachment_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE daily_note_attachments (
    daily_note_id TEXT NOT NULL REFERENCES daily_notes(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(daily_note_id, attachment_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE reminders (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT REFERENCES calendar_events(id) ON DELETE CASCADE,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
    recurring_item_id TEXT REFERENCES recurring_items(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (offset_minutes >= 0),
    notify_on_startup INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_startup IN (0, 1)),
    desktop_notification INTEGER NOT NULL DEFAULT 1 CHECK (desktop_notification IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((event_id IS NOT NULL) + (transaction_id IS NOT NULL) + (recurring_item_id IS NOT NULL) = 1)
) STRICT;

CREATE TABLE reminder_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    occurrence_key TEXT NOT NULL,
    scheduled_for_utc TEXT NOT NULL,
    delivered_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'dismissed', 'failed', 'cancelled')),
    error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(reminder_id, occurrence_key, scheduled_for_utc)
) STRICT;

CREATE INDEX transactions_date ON transactions(transaction_date DESC, id);
CREATE INDEX transactions_status_type_date ON transactions(status, transaction_type, transaction_date);
CREATE INDEX transactions_category_date ON transactions(category_id, transaction_date);
CREATE INDEX transactions_payment_date ON transactions(payment_method_id, transaction_date);
CREATE INDEX transactions_member_date ON transactions(household_member_id, transaction_date);
CREATE INDEX transactions_import_batch ON transactions(import_batch_id);
CREATE INDEX transactions_occurrence ON transactions(recurring_occurrence_id);
CREATE INDEX calendar_events_all_day ON calendar_events(start_date, end_date_exclusive);
CREATE INDEX calendar_events_timed ON calendar_events(start_at_utc, end_at_utc);
CREATE INDEX event_transactions_transaction ON event_transactions(transaction_id, event_id);

CREATE VIEW v_actual_transactions AS
SELECT *
FROM transactions
WHERE deleted_at IS NULL
  AND status = 'completed'
  AND transaction_type IN ('income', 'expense');
