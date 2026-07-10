-- HomeLedger schema v1: settings and reusable household reference data.
-- All timestamps are UTC ISO-8601 strings. Money never appears in this migration.

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE household_members (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
    relationship TEXT,
    avatar_relative_path TEXT,
    color TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX household_members_one_default
    ON household_members(is_default) WHERE is_default = 1;

CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    icon TEXT,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE UNIQUE INDEX categories_unique_name
    ON categories(type, COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX categories_parent_sort ON categories(parent_id, sort_order, name);

CREATE TABLE payment_methods (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
    method_type TEXT NOT NULL CHECK (
        method_type IN ('cash', 'debit_card', 'credit_card', 'chequing', 'savings', 'other')
    ),
    institution TEXT,
    last_four TEXT CHECK (last_four IS NULL OR last_four GLOB '[0-9][0-9][0-9][0-9]'),
    default_currency_code TEXT NOT NULL CHECK (
        length(default_currency_code) = 3 AND default_currency_code = upper(default_currency_code)
    ),
    icon TEXT,
    color TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX payment_methods_unique_name
    ON payment_methods(display_name COLLATE NOCASE);

CREATE TABLE locations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    address_line TEXT,
    city TEXT,
    province TEXT,
    country_code TEXT CHECK (
        country_code IS NULL OR (length(country_code) = 2 AND country_code = upper(country_code))
    ),
    postal_code TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE tax_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
    region_code TEXT,
    config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    config_json TEXT NOT NULL CHECK (json_valid(config_json)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX tax_profiles_one_default
    ON tax_profiles(is_default) WHERE is_default = 1;

CREATE TABLE tax_tags (
    id TEXT PRIMARY KEY NOT NULL,
    tax_profile_id TEXT NOT NULL REFERENCES tax_profiles(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX tax_tags_unique_name
    ON tax_tags(tax_profile_id, name COLLATE NOCASE);

INSERT INTO app_settings(key, value_json, schema_version, updated_at) VALUES
    ('locale', '"zh-CN"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('timezone_id', '"America/Toronto"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('reporting_currency_code', '"CAD"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('country_code', '"CA"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('region_code', '"ON"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('theme', '"system"', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('auto_backup_policy', '{"enabled":false,"intervalDays":7,"retentionCount":8}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('notification_preferences', '{"onStartup":true,"desktop":true}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('calendar_color_overrides', '{}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO household_members(
    id, display_name, relationship, color, is_default, is_active, created_at, updated_at
) VALUES (
    '00000000-0000-7000-8000-000000000001', '我', 'self', '#0F766E', 1, 1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO tax_profiles(
    id, name, country_code, region_code, config_version, config_json,
    is_default, is_active, created_at, updated_at
) VALUES (
    '00000000-0000-7000-8000-000000000100', 'Canada / Ontario', 'CA', 'ON', 1,
    '{"disclaimer":"系统只能帮助整理候选记录，最终税务处理应由用户或专业人士确认。"}',
    1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO tax_tags(
    id, tax_profile_id, name, description, is_system, sort_order, created_at, updated_at
) VALUES
    ('00000000-0000-7000-8000-000000000201', '00000000-0000-7000-8000-000000000100', '不涉及税务', NULL, 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000202', '00000000-0000-7000-8000-000000000100', '个人支出', NULL, 1, 20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000203', '00000000-0000-7000-8000-000000000100', '商业支出', NULL, 1, 30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000204', '00000000-0000-7000-8000-000000000100', '自雇支出', NULL, 1, 40, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000205', '00000000-0000-7000-8000-000000000100', '出租房相关', NULL, 1, 50, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000206', '00000000-0000-7000-8000-000000000100', '教育相关', NULL, 1, 60, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000207', '00000000-0000-7000-8000-000000000100', '医疗相关', NULL, 1, 70, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000208', '00000000-0000-7000-8000-000000000100', '慈善捐赠', NULL, 1, 80, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000209', '00000000-0000-7000-8000-000000000100', '投资相关', NULL, 1, 90, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000210', '00000000-0000-7000-8000-000000000100', '车辆相关', NULL, 1, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000211', '00000000-0000-7000-8000-000000000100', '家庭办公相关', NULL, 1, 110, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('00000000-0000-7000-8000-000000000212', '00000000-0000-7000-8000-000000000100', '需要检查', '候选项目，必须由用户或税务专业人士确认。', 1, 120, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
