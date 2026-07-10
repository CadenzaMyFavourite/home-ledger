-- HomeLedger schema v1: templates, reports, AI review, imports, audit and backups.

CREATE TABLE saved_templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    template_type TEXT NOT NULL CHECK (template_type IN ('transaction', 'event')),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    template_json TEXT NOT NULL CHECK (json_valid(template_json)),
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    last_used_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE saved_filters (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    scope TEXT NOT NULL CHECK (scope IN ('transactions', 'calendar', 'tax', 'global_search')),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    filter_json TEXT NOT NULL CHECK (json_valid(filter_json)),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE report_notes (
    id TEXT PRIMARY KEY NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('monthly', 'annual', 'tax')),
    period_start TEXT NOT NULL,
    period_end_exclusive TEXT NOT NULL CHECK (period_start < period_end_exclusive),
    note TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(report_type, period_start, period_end_exclusive)
) STRICT;

CREATE TABLE ai_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai_compatible')),
    base_url TEXT NOT NULL,
    model_name TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 300000),
    max_context_tokens INTEGER NOT NULL DEFAULT 8192 CHECK (max_context_tokens BETWEEN 512 AND 1048576),
    is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    non_loopback_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (non_loopback_confirmed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ai_profiles_one_default
    ON ai_profiles(is_default) WHERE is_default = 1;

CREATE TABLE ai_summaries (
    id TEXT PRIMARY KEY NOT NULL,
    summary_type TEXT NOT NULL CHECK (summary_type IN ('monthly', 'annual', 'tax_note')),
    period_start TEXT NOT NULL,
    period_end_exclusive TEXT NOT NULL CHECK (period_start < period_end_exclusive),
    ai_profile_id TEXT NOT NULL REFERENCES ai_profiles(id) ON DELETE RESTRICT,
    model_name_snapshot TEXT NOT NULL,
    prompt_version INTEGER NOT NULL CHECK (prompt_version >= 1),
    data_scope_json TEXT NOT NULL CHECK (json_valid(data_scope_json)),
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
    generated_text TEXT NOT NULL,
    current_text TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'reviewed', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
) STRICT;

CREATE INDEX ai_summaries_period ON ai_summaries(summary_type, period_start, period_end_exclusive);
CREATE INDEX ai_summaries_input_hash ON ai_summaries(input_hash);

CREATE TABLE ai_summary_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    ai_summary_id TEXT NOT NULL REFERENCES ai_summaries(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    text TEXT NOT NULL,
    edited_by TEXT NOT NULL CHECK (edited_by IN ('ai', 'user')),
    created_at TEXT NOT NULL,
    UNIQUE(ai_summary_id, revision_number)
) STRICT;

CREATE TABLE ai_suggestions (
    id TEXT PRIMARY KEY NOT NULL,
    suggestion_type TEXT NOT NULL CHECK (
        suggestion_type IN ('category', 'tax_tag', 'anomaly_explanation', 'safe_filter')
    ),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    ai_profile_id TEXT NOT NULL REFERENCES ai_profiles(id) ON DELETE RESTRICT,
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
    suggested_value_json TEXT NOT NULL CHECK (json_valid(suggested_value_json)),
    explanation TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE review_flags (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    flag_type TEXT NOT NULL CHECK (
        flag_type IN (
            'possible_duplicate', 'unusually_high', 'missing_attachment', 'uncategorized',
            'missing_fx', 'possible_tax_candidate', 'tax_review', 'subscription_change'
        )
    ),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'high')),
    detector_version INTEGER NOT NULL CHECK (detector_version >= 1),
    details_json TEXT NOT NULL CHECK (json_valid(details_json)),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed', 'resolved')),
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX review_flags_open ON review_flags(status, flag_type, transaction_id);

CREATE TABLE import_rows (
    id TEXT PRIMARY KEY NOT NULL,
    import_batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL CHECK (row_number >= 1),
    raw_row_json TEXT NOT NULL CHECK (json_valid(raw_row_json)),
    normalized_hash TEXT,
    duplicate_of_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
    decision TEXT CHECK (decision IS NULL OR decision IN ('import', 'skip', 'review')),
    result_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
    error_code TEXT,
    error_details_json TEXT CHECK (error_details_json IS NULL OR json_valid(error_details_json)),
    created_at TEXT NOT NULL,
    UNIQUE(import_batch_id, row_number)
) STRICT;

CREATE TABLE audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    occurred_at TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'accepted_ai', 'import', 'restore')),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    correlation_id TEXT,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))
) STRICT;

CREATE INDEX audit_events_entity ON audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_correlation ON audit_events(correlation_id);

CREATE TABLE backup_records (
    id TEXT PRIMARY KEY NOT NULL,
    backup_type TEXT NOT NULL CHECK (backup_type IN ('manual', 'scheduled', 'pre_restore', 'pre_migration')),
    format_version INTEGER NOT NULL CHECK (format_version >= 1),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    logical_json_schema_version INTEGER NOT NULL CHECK (logical_json_schema_version >= 1),
    app_version TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('creating', 'complete', 'verified', 'failed', 'missing')),
    total_size INTEGER NOT NULL DEFAULT 0 CHECK (total_size >= 0),
    manifest_sha256 TEXT,
    logical_json_sha256 TEXT,
    created_at TEXT NOT NULL,
    verified_at TEXT,
    failure_code TEXT
) STRICT;

CREATE TABLE backup_files (
    backup_record_id TEXT NOT NULL REFERENCES backup_records(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    PRIMARY KEY(backup_record_id, relative_path)
) STRICT, WITHOUT ROWID;
