-- Transaction Engine - Migration 001: Initial Schema
-- Implements the Phase 2 design with users, accounts, transactions,
-- ledger_entries, idempotency_keys, and audit_logs.
--
-- Principles enforced at the database layer, not just application code:
-- Money stored as BIGINT in minor units
-- Balance must be greater than or equal to zero
-- Amount must be positive, source and destination must be different
-- Idempotency uniqueness on (user_id, key)
-- Append-only financial history with no destructive deletes modeled

--

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for generating random UUIDs

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'))
);

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    currency        CHAR(3) NOT NULL,
    balance         BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_balance_nonnegative CHECK (balance >= 0),
    CONSTRAINT accounts_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
    CONSTRAINT accounts_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_user_currency ON accounts(user_id, currency);

-- Transactions table (business-level financial operation)
CREATE TABLE IF NOT EXISTS transactions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    destination_account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount                      BIGINT NOT NULL,
    currency                    CHAR(3) NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'PENDING',
    failure_reason              TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                TIMESTAMPTZ,

    CONSTRAINT transactions_amount_positive CHECK (amount > 0),
    CONSTRAINT transactions_distinct_accounts CHECK (source_account_id <> destination_account_id),
    CONSTRAINT transactions_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    CONSTRAINT transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS idx_transactions_source_account ON transactions(source_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination_account ON transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Ledger entries (immutable, append-only, double-entry)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount          BIGINT NOT NULL,
    entry_type      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ledger_entry_type_check CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    CONSTRAINT ledger_amount_nonzero CHECK (amount <> 0),
    CONSTRAINT ledger_amount_sign_matches_type CHECK (
        (entry_type = 'DEBIT'  AND amount < 0) OR
        (entry_type = 'CREDIT' AND amount > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_id ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON ledger_entries(created_at);

-- Idempotency keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_hash    TEXT NOT NULL,
    transaction_id  UUID REFERENCES transactions(id) ON DELETE RESTRICT,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,

    PRIMARY KEY (user_id, key),
    CONSTRAINT idempotency_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'))
);

-- Audit logs (append-only, separate from application logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE RESTRICT,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     UUID NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

COMMIT;
