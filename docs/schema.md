# Transaction Engine Schema

This document describes the persisted data model for the transaction engine and the integrity rules enforced at the database layer.

## Overview

The schema is designed to preserve financial correctness under concurrent requests, retry attempts, and partial failures. Values are stored in minor units, and the ledger is treated as an append-only audit trail of money movement.

The core tables are:

- `users`
- `accounts`
- `transactions`
- `ledger_entries`
- `idempotency_keys`
- `audit_logs`

---

## 1. users

Stores the application users who own accounts.

| Column          | Type        | Notes                                |
| --------------- | ----------- | ------------------------------------ |
| `id`            | UUID        | Primary key                          |
| `email`         | TEXT        | Unique and not null                  |
| `password_hash` | TEXT        | Not null                             |
| `status`        | TEXT        | `ACTIVE`, `SUSPENDED`, or `DISABLED` |
| `created_at`    | TIMESTAMPTZ | Default `now()`                      |
| `updated_at`    | TIMESTAMPTZ | Default `now()`                      |

Constraints:

- `email` must be unique
- `status` must satisfy the allowed values

---

## 2. accounts

Represents a wallet or account owned by a user.

| Column       | Type        | Notes                                |
| ------------ | ----------- | ------------------------------------ |
| `id`         | UUID        | Primary key                          |
| `user_id`    | UUID        | FK to `users.id`                     |
| `currency`   | CHAR(3)     | 3-letter currency code               |
| `balance`    | BIGINT      | Stored in minor units                |
| `status`     | TEXT        | `ACTIVE`, `SUSPENDED`, or `DISABLED` |
| `created_at` | TIMESTAMPTZ | Default `now()`                      |
| `updated_at` | TIMESTAMPTZ | Default `now()`                      |

Constraints:

- `balance >= 0`
- `currency` matches `^[A-Z]{3}$`
- `status` must be one of the allowed values
- `user_id` cannot be deleted while accounts still reference it

Important invariant:

- Account balances can never become negative.

---

## 3. transactions

Represents a financial transfer request from one account to another.

| Column                   | Type        | Notes                               |
| ------------------------ | ----------- | ----------------------------------- |
| `id`                     | UUID        | Primary key                         |
| `source_account_id`      | UUID        | FK to `accounts.id`                 |
| `destination_account_id` | UUID        | FK to `accounts.id`                 |
| `amount`                 | BIGINT      | Positive amount in minor units      |
| `currency`               | CHAR(3)     | Must match both account currencies  |
| `status`                 | TEXT        | `PENDING`, `COMPLETED`, or `FAILED` |
| `failure_reason`         | TEXT        | Nullable                            |
| `created_at`             | TIMESTAMPTZ | Default `now()`                     |
| `completed_at`           | TIMESTAMPTZ | Populated only when completed       |

Constraints:

- `amount > 0`
- `source_account_id <> destination_account_id`
- `status` must be valid
- `currency` must match `^[A-Z]{3}$`
- `completed_at` must be populated for `COMPLETED` records
- `completed_at` must be null for non-completed records

Transaction lifecycle:

1. inserted as `PENDING`
2. validated and processed in a single DB transaction
3. marked `COMPLETED` once ledger entries and balances have been written
4. persisted as immutable financial history

---

## 4. ledger_entries

A double-entry accounting log that records how the transfer changed balances.

| Column           | Type        | Notes                   |
| ---------------- | ----------- | ----------------------- |
| `id`             | UUID        | Primary key             |
| `transaction_id` | UUID        | FK to `transactions.id` |
| `account_id`     | UUID        | FK to `accounts.id`     |
| `amount`         | BIGINT      | Signed value            |
| `entry_type`     | TEXT        | `DEBIT` or `CREDIT`     |
| `created_at`     | TIMESTAMPTZ | Default `now()`         |

Constraints:

- `entry_type` must be `DEBIT` or `CREDIT`
- `amount <> 0`
- `DEBIT` entries must be negative
- `CREDIT` entries must be positive

Critical rule:

- For a completed transaction, there must be exactly one credit and one debit, and the sum of both must be zero.

---

## 5. idempotency_keys

Protects against duplicate client requests and ensures repeated requests return the same transaction result.

| Column           | Type        | Notes                                 |
| ---------------- | ----------- | ------------------------------------- |
| `key`            | TEXT        | Part of the composite primary key     |
| `user_id`        | UUID        | FK to `users.id`                      |
| `request_hash`   | TEXT        | Canonical hash of the request payload |
| `transaction_id` | UUID        | FK to `transactions.id`               |
| `status`         | TEXT        | `PENDING`, `COMPLETED`, or `FAILED`   |
| `created_at`     | TIMESTAMPTZ | Default `now()`                       |
| `expires_at`     | TIMESTAMPTZ | Optional                              |

Constraints:

- Primary key is `(user_id, key)`
- `status` must be valid
- The same client request key for a user is unique

This ensures idempotent retries have deterministic behavior.

---

## 6. audit_logs

Append-only logs meant for accountability and investigation.

| Column          | Type        | Notes              |
| --------------- | ----------- | ------------------ |
| `id`            | UUID        | Primary key        |
| `user_id`       | UUID        | FK to `users.id`   |
| `action`        | TEXT        | Action name        |
| `resource_type` | TEXT        | Resource kind      |
| `resource_id`   | UUID        | Target resource    |
| `metadata`      | JSONB       | Structured context |
| `created_at`    | TIMESTAMPTZ | Default `now()`    |

Constraints:

- audit rows are protected from update/delete/truncate actions
- they are intentionally append-only

---

## Invariants enforced by the database

The following rules are enforced through SQL constraints and trigger-based validation:

- Account balances must stay non-negative.
- Source and destination accounts must be different.
- Transaction amounts must be positive.
- Ledger entries must always be signed correctly.
- Completed transactions must contain exactly one debit and one credit.
- Ledger totals for a completed transaction must sum to zero.
- Debits must map to the source account.
- Credits must map to the destination account.
- Transaction currency must match both account currencies.
- Idempotency keys are unique per user.
- Audit logs and ledger entries are immutable.

---

## Data flow for a transfer

1. A client sends a transfer request.
2. The app validates the payload and checks the idempotency key.
3. A database transaction is started.
4. Source and destination accounts are locked.
5. Balance and validity checks are performed.
6. A `transactions` row is inserted as `PENDING`.
7. Two `ledger_entries` rows are inserted: one debit and one credit.
8. The transaction is marked `COMPLETED`.
9. Deferred database constraints validate the double-entry integrity.
10. The action is recorded in the append-only `audit_logs` table.

---

## Notes

- Money is stored in minor units such as cents or pesewas, not as floating-point values.
- `BIGINT` is used to avoid rounding issues and maintain precision.
- The database is treated as the source of truth for financial correctness.
- Application code validates inputs, but the database enforces the last line of protection.
