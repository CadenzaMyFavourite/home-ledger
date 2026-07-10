-- HomeLedger schema v5: deterministic merchant-history suggestion lookup.

CREATE INDEX idx_transactions_merchant_type_recent
ON transactions(merchant COLLATE NOCASE, transaction_type, transaction_date DESC, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_transactions_active_date_recent
ON transactions(transaction_date DESC, created_at DESC, id DESC)
WHERE deleted_at IS NULL;
