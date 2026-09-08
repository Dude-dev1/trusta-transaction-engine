# Database Schema

The database schema is the source of truth for financial correctness.

## Tables

### users

- `id` UUID primary key
- `email` unique, not null
- `password_hash` not null
- `status` one of `ACTIVE`, `SUSPENDED`, `DISABLED`
- timestamps

### accounts

- `id` UUID primary key
- `user_id` foreign key to `users.id`
- `currency` 3-letter ISO-like code
- `balance` BIGINT minor units, must stay `>= 0`
- `status` one of `ACTIVE`, `SUSPENDED`, `DISABLED`
- timestamps

### transactions

- `id` UUID primary key
- `source_account_id` FK to `accounts.id`
- `destination_account_id` FK to `accounts.id`
- `amount` BIGINT minor units, must be positive
- `currency` 3-letter code
- `status` one of `PENDING`, `COMPLETED`, `FAILED`
- `failure_reason` nullable text
- timestamps

### ledger_entries

- `id` UUID primary key
- `transaction_id` FK to `transactions.id`
- `account_id` FK to `accounts.id`
- `amount` signed BIGINT
- `entry_type` one of `DEBIT`, `CREDIT`
- timestamps

### idempotency_keys

- primary key `(user_id, key)`
- `request_hash` stores the canonical request fingerprint
- `transaction_id` links to the completed transaction
- `status` one of `PENDING`, `COMPLETED`, `FAILED`
- timestamps

### audit_logs

- `id` UUID primary key
- `user_id` FK to `users.id`
- `action`, `resource_type`, `resource_id`
- `metadata` JSONB
- timestamp

## Key invariants

- balance cannot go negative
- transaction amount must be positive
- source and destination accounts must differ
- ledger entries must balance as debit/credit pairs
- idempotency keys are unique per user
- financial rows are not casually deleted
