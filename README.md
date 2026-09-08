# Transaction Engine

Transaction Engine is a backend prototype for the hard part of payments engineering: moving money exactly once under retries, crashes, concurrent requests, and partial failures.

The implementation is a modular monolith built on Node.js, TypeScript, Express, and PostgreSQL. Financial correctness is enforced by the database transaction boundary, row-level locking, uniqueness constraints, and an immutable ledger.

## What is implemented

- `POST /transactions` with authentication, authorization, validation, idempotency, and atomic balance updates
- PostgreSQL schema for users, accounts, transactions, ledger entries, idempotency keys, and audit logs
- Request replay protection with `(user_id, key)` uniqueness and request hashing
- Deterministic account locking to reduce deadlock risk
- Audit logging for successful transfers
- Health check endpoint and error middleware
- Unit and integration tests

## Getting started

1. Copy the example environment file and set your database URL.

```bash
copy .env.example .env
```

2. Start PostgreSQL.

```bash
docker compose up -d
```

3. Install dependencies and run the server.

```bash
npm install
npm run dev
```

If you already have a PostgreSQL 16+ instance, point `DATABASE_URL` at it and run the migration manually:

```bash
npm run migrate
```

## API

See [docs/api.md](docs/api.md) for the request and response contract.

## Database schema

See [docs/schema.md](docs/schema.md) for the table layout and invariants.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the service flow and deployment shape.

## Tests

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:concurrency`

The integration test suite expects a live PostgreSQL instance in `DATABASE_URL`. If it is not available, the DB-specific tests skip cleanly.

## Technical decisions

- Money is stored as integer minor units, not floating-point values.
- The PostgreSQL database is the source of truth for balances and transaction history.
- Transfers run inside a single database transaction.
- Duplicate requests are deduplicated with an idempotency key scoped to the authenticated user.
- The ledger is append-only and balanced.
- The service is a modular monolith rather than an early microservice split.

## Known limitations

- Authentication is prototype-grade: the bearer token is the user UUID, looked up directly in the `users` table.
- No foreign exchange or transaction cancellation flow exists yet.
- Recovery/reconciliation tooling is intentionally minimal.
- The implementation assumes a single currency per transfer.

## Biggest technical risk

The biggest risk is preserving financial correctness during concurrency and partial failure. The main defense is to keep the source of truth in PostgreSQL and do all mutating transfer work inside one transaction with locked rows, idempotency constraints, and balanced ledger writes. If this service grows, the next hardening step is replay-safe recovery tooling and more aggressive concurrency/failure testing.
