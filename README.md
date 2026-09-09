Yes. The duplication can be removed while keeping the README complete. I also cleaned up the structure so each topic appears once and kept the claims within what you've actually implemented.

Copy the entire block below into `README.md`:

````markdown
# Trusta Transaction Engine

Trusta Transaction Engine is a backend prototype for the hard part of payments engineering: moving money exactly once under retries, concurrent requests, partial failures, and database errors.

The implementation is a modular monolith built with Node.js, TypeScript, Express, and PostgreSQL.

Financial correctness is enforced through the PostgreSQL transaction boundary, row-level locking, uniqueness constraints, database constraints, deferred validation triggers, and an immutable ledger.

## Project Information

**Track:** Backend Engineering

**Project Title:** Trusta Transaction Engine

**Repository:**  
https://github.com/Dude-dev1/trusta-transaction-engine

## What is Implemented

- `POST /transactions` with authentication, authorization, validation, idempotency, and atomic balance updates
- PostgreSQL schema for users, accounts, transactions, ledger entries, idempotency keys, and audit logs
- Request replay protection using `(user_id, key)` uniqueness and request hashing
- Deterministic account locking to reduce deadlock risk
- Atomic transfer processing using PostgreSQL transactions
- Double-entry ledger validation
- Immutable ledger entries
- Immutable audit logs
- Audit logging for successful transfers
- Health check endpoint
- Centralized error handling
- Unit, integration, and concurrency tests
- Database constraint verification

## Architecture

The transaction flow is:

```text
Client
  |
  v
Authentication
  |
  v
Request Validation
  |
  v
Idempotency Check
  |
  v
PostgreSQL Transaction
  |
  +--> Lock Source and Destination Accounts
  |
  +--> Validate Balance
  |
  +--> Create Transaction
  |
  +--> Write Ledger Entries
  |
  +--> Update Balances
  |
  +--> Write Audit Log
  |
  +--> Complete Transaction
  |
  v
Response
```
````

The PostgreSQL database is the source of truth for balances and financial history.

A workplace-submissible architecture diagram is also included in the project documentation.

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Dude-dev1/trusta-transaction-engine.git
cd trusta-transaction-engine
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure the Environment

Copy the example environment file.

On Windows:

```bash
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Configure `DATABASE_URL` in `.env` to point to the PostgreSQL database.

Example:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/transaction_engine
```

Use the actual credentials and database name for the PostgreSQL instance being used.

## Start PostgreSQL

The repository includes Docker Compose configuration.

If using Docker:

```bash
docker compose up -d
```

If PostgreSQL is already installed locally, make sure the database is running and that `DATABASE_URL` points to it.

## Run Database Migrations

After PostgreSQL is available, run:

```bash
npm run migrate
```

The migration sequence creates the core database schema and applies the database-level protections.

The migrations cover:

1. Initial schema
2. Ledger immutability
3. Double-entry integrity
4. Transaction/account consistency
5. Audit-log immutability

The main tables are:

```text
users
accounts
transactions
ledger_entries
idempotency_keys
audit_logs
```

## Run the API

Start the development server with:

```bash
npm run dev
```

The health endpoint is:

```text
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## API

The main transaction endpoint is:

```text
POST /transactions
```

The endpoint requires authentication and an idempotency key.

Required headers:

```text
Authorization: Bearer <user-id>
Idempotency-Key: <unique-key>
```

Example request:

```json
{
  "sourceAccountId": "<source-account-uuid>",
  "destinationAccountId": "<destination-account-uuid>",
  "amountMinor": "1000",
  "currency": "USD"
}
```

`amountMinor` represents the amount in minor currency units and is handled as an integer rather than a floating-point value.

The complete request and response contract is documented in:

```text
API.md
```

## How to Verify the Important Behaviours

### Authentication

Send a request without a valid bearer token.

The request should be rejected.

The current prototype uses the authenticated user's UUID as the bearer token.

### Validation

Try invalid values such as:

- Missing source account
- Invalid UUID
- Zero amount
- Negative amount
- Invalid currency
- Missing idempotency key

The request should be rejected before the transfer is processed.

### Idempotency

Send the same transaction twice using the same authenticated user and idempotency key.

For example:

```text
Authorization: Bearer <same-user>
Idempotency-Key: transfer-001
```

The second request should replay the existing result instead of creating another financial transaction.

### Idempotency Conflict

Send two requests using the same idempotency key but different transaction payloads.

The conflicting request should be rejected rather than being processed as a separate transaction.

The request hash is used to detect this condition.

### Concurrency

Run:

```bash
npm run test:concurrency
```

The concurrency tests verify that concurrent requests cannot create duplicate processing for the same idempotency key.

Account locking is also performed in a deterministic order to reduce deadlock risk.

### Failure Recovery and Rollback

The failure rollback integration test verifies that when a transfer fails before completion, the database transaction is rolled back.

Run:

```bash
npx vitest run tests/integration/transfer-failure-rollback.test.ts
```

The test verifies that the failed operation does not leave behind:

- A transaction record
- Ledger entries
- An idempotency record
- An audit record

### Ledger Integrity

Run:

```bash
psql "$DATABASE_URL" -f tests/verify_constraints.sql
```

The verification script attempts invalid ledger states and checks that the database rejects them.

### Audit-Log Integrity

The audit-log integration test verifies that audit records cannot be updated or deleted.

Run:

```bash
npx vitest run tests/integration/audit-log-integrity.test.ts
```

## Tests

Run the complete test suite with:

```bash
npm test
```

The final successful verification run produced:

```text
Test Files  7 passed (7)
Tests       21 passed (21)
```

Individual test groups can also be run with:

### Unit Tests

```bash
npm run test:unit
```

### Integration Tests

```bash
npm run test:integration
```

### Concurrency Tests

```bash
npm run test:concurrency
```

The integration tests require a live PostgreSQL instance through `DATABASE_URL`.

The test suite currently covers:

- Request hashing
- HTTP API behaviour
- Authentication behaviour
- Transaction creation
- Idempotent replay
- Idempotency conflicts
- Concurrent requests
- Audit-log immutability
- Migration structure
- Transaction rollback
- Database integrity

## Database Constraint Verification

The repository includes:

```text
tests/verify_constraints.sql
```

This script can be run directly against PostgreSQL:

```bash
psql "$DATABASE_URL" -f tests/verify_constraints.sql
```

It verifies database-level financial controls including:

- Valid double-entry transactions
- Rejection of completed transactions with incomplete ledger entries
- Rejection of incorrect ledger amounts
- Rejection of multiple debit entries
- Rejection of credits on the wrong account
- Rejection of extra ledger entries
- Rejection of unbalanced ledgers
- Ledger immutability

This demonstrates that important financial invariants are enforced at the database layer rather than relying only on application code.

## Database Design

The core schema consists of:

```text
users
    |
    +---- accounts
              |
              +---- transactions
              |
              +---- ledger_entries

users
    |
    +---- idempotency_keys

users
    |
    +---- audit_logs
```

Important database guarantees include:

- Account balances cannot become negative
- Transaction amounts must be positive
- Source and destination accounts must be different
- Currencies must use three uppercase letters
- Idempotency keys are unique per user
- Ledger entries are append-only
- Audit logs are append-only
- Completed transactions require a valid double-entry ledger
- Completed transactions must use matching account currencies
- Completed transactions require `completed_at`

More detailed schema information is available in the project documentation.

## Technical Decisions

### Integer Money Representation

Money is stored as integer minor units rather than floating-point values. This avoids floating-point precision problems when handling financial amounts.

### PostgreSQL as the Source of Truth

Balances and transaction history are kept in PostgreSQL. The database transaction boundary is used to keep related financial changes consistent.

### Database Transactions

Transfers run inside a single PostgreSQL transaction so that balance updates, transaction records, ledger entries, idempotency records, and audit activity are handled consistently.

### Idempotency

Duplicate requests are deduplicated using an idempotency key scoped to the authenticated user.

The request hash allows the service to distinguish a legitimate retry from a conflicting request using the same key with different data.

### Deterministic Account Locking

Source and destination accounts are locked in a deterministic order to reduce the risk of deadlocks when multiple transfers happen concurrently.

### Immutable Financial Records

Ledger entries and audit logs are protected from modification and deletion. This preserves the historical record rather than allowing completed financial activity to be silently changed.

### Modular Monolith

The service uses a modular monolith structure rather than introducing distributed services prematurely. This keeps transaction processing within a single application and database boundary while leaving room for future separation if the system grows.

## Known Limitations

This is a backend prototype rather than a production banking platform.

Current limitations include:

- Authentication is prototype-grade. The bearer token is the user UUID looked up directly in the `users` table.
- There is no external identity provider or JWT-based authentication.
- There is no foreign exchange flow.
- There is no transaction cancellation flow.
- Recovery and reconciliation tooling is intentionally minimal.
- The implementation assumes a single currency per transfer.
- Operational monitoring and alerting are not implemented.
- The current architecture is a modular monolith rather than a distributed transaction platform.

These limitations were kept within the scope of the challenge rather than expanding the implementation beyond what was required.

## Biggest Technical Risk

The biggest technical risk is preserving financial correctness during concurrency and partial failure.

The main defence is keeping the source of truth in PostgreSQL and performing the mutating transfer work inside one transaction with locked account rows, idempotency constraints, database validation, and balanced ledger writes.

If the service grows, the next hardening step would be replay-safe recovery and reconciliation tooling, together with more aggressive concurrency and failure testing.

## Evidence of Work

The repository contains:

- Application source code
- PostgreSQL migrations
- Database verification scripts
- Unit tests
- Integration tests
- Concurrency tests
- API documentation
- Architecture documentation
- Schema documentation
- Environment configuration example
- Docker Compose configuration

The submission document also includes architecture and testing evidence.

The final successful test run verified:

```text
Test Files  7 passed (7)
Tests       21 passed (21)
```

The repository also contains the test cases used to verify idempotency, concurrency, rollback behaviour, database integrity, and audit-log immutability.

## API Documentation

The full API request and response contract is available in:

```text
API.md
```

It documents the transaction endpoint, authentication requirements, idempotency requirements, request structure, responses, and error behaviour.

## Architecture Documentation

The project includes architecture documentation describing the transaction flow, application structure, and database interaction.

The architecture diagram used for the submission shows the separation between request handling, transaction processing, and database-level financial controls.

## AI / External Tools

AI tools were used during development as an engineering support tool for analysis, debugging, test design, documentation, and iteration.

I remain responsible for the implementation and understand the technical decisions and behaviour of the system.
