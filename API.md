# Transaction Engine API Documentation

## 1. Overview

The Transaction Engine exposes a REST API for creating financial transfers between accounts.

The request flow is:

```text
HTTP Request
    ↓
Request ID
    ↓
Authentication
    ↓
Request Validation
    ↓
Authorization
    ↓
Database Transaction
    ↓
Account Locking
    ↓
Balance Mutation
    ↓
Ledger Entries
    ↓
Transaction Completion
    ↓
Audit Log
    ↓
HTTP Response
```

The API is implemented using Node.js, Express, TypeScript, and PostgreSQL.

---

# 2. Base URL

For local development:

```text
http://localhost:3000
```

The API does not currently define a versioned prefix such as `/api/v1`.

---

# 3. Request IDs

Every request receives a request ID.

The client may provide:

```http
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

If the header is not supplied, the server generates a UUID.

The request ID is:

- attached to the Express request context;
- returned through the `X-Request-ID` response header;
- included in JSON error responses;
- included in the audit metadata for transfer creation.

Example:

```http
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

---

# 4. Authentication

Protected transaction endpoints require:

```http
Authorization: Bearer <user-uuid>
```

The current prototype uses the authenticated user's UUID as the bearer token.

Example:

```http
Authorization: Bearer 11111111-1111-1111-1111-111111111111
```

The authentication middleware:

1. checks that the `Authorization` header exists;
2. requires the `Bearer` scheme;
3. treats the supplied token as a user UUID;
4. looks up the user in PostgreSQL;
5. requires the user to exist;
6. requires the user status to be `ACTIVE`.

Inactive users cannot perform authenticated operations.

> **Prototype security note:** This bearer-token mechanism is intentionally simple for the prototype. It is not a production JWT, OAuth, or session-based authentication system.

---

# 5. Health Check

## `GET /health`

Returns the health status of the HTTP application.

### Authentication

None.

### Request

No request body or headers are required.

### Example

```http
GET /health
```

### Success Response

**200 OK**

```json
{
  "status": "ok"
}
```

---

# 6. Create Transfer

## `POST /transactions`

Creates a financial transfer from one account to another.

The operation is atomic.

A successful transfer:

1. authenticates the user;
2. validates the request;
3. validates ownership of the source account;
4. locks both accounts;
5. validates account state and currency;
6. checks the source balance;
7. creates the transaction;
8. debits the source account;
9. credits the destination account;
10. creates a DEBIT ledger entry;
11. creates a CREDIT ledger entry;
12. marks the transaction `COMPLETED`;
13. records the idempotency result;
14. creates an audit log.

All financial mutations occur inside one PostgreSQL transaction.

---

## Authentication

Required:

```http
Authorization: Bearer <user-uuid>
```

---

## Required Headers

### `Idempotency-Key`

Required for every transfer.

```http
Idempotency-Key: transfer-20260909-001
```

Constraints:

- must be present;
- must contain at least one character;
- maximum length is 255 characters.

The key is scoped to the authenticated user.

The database enforces uniqueness using:

```text
(user_id, key)
```

---

## Optional Headers

### `X-Request-ID`

```http
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

If omitted, the server generates one.

---

# 7. Transfer Request Body

Content type:

```http
Content-Type: application/json
```

Schema:

```json
{
  "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "amountMinor": "10000",
  "currency": "USD"
}
```

## Fields

### `sourceAccountId`

Type:

```text
UUID
```

The account from which funds are debited.

The authenticated user must own this account.

---

### `destinationAccountId`

Type:

```text
UUID
```

The account receiving the funds.

The source and destination accounts must be different.

---

### `amountMinor`

The transfer amount expressed in the currency's smallest unit.

Examples:

```text
$100.00 → 10000 cents
$25.50  → 2550 cents
```

The API accepts either:

```json
{
  "amountMinor": 10000
}
```

or:

```json
{
  "amountMinor": "10000"
}
```

The value must:

- contain only digits when supplied as a string;
- be a positive integer;
- be safely representable when supplied as a JavaScript number.

Internally, the service converts the amount to PostgreSQL-compatible integer arithmetic using JavaScript `bigint`.

---

### `currency`

Three uppercase ISO-style currency characters.

Example:

```json
{
  "currency": "USD"
}
```

The current validation requires:

```text
^[A-Z]{3}$
```

Examples:

```text
USD
EUR
GBP
GHS
```

The source account, destination account, and transfer must all use the same currency.

---

# 8. Successful Transfer Response

A newly created transfer returns:

**201 Created**

Example:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "replayed": false,
  "transaction": {
    "id": "c0000000-0000-0000-0000-000000000001",
    "source_account_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destination_account_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amount": "10000",
    "currency": "USD",
    "status": "COMPLETED",
    "failure_reason": null,
    "created_at": "2026-09-09T10:00:00.000Z",
    "completed_at": "2026-09-09T10:00:00.010Z"
  },
  "ledgerEntries": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "transaction_id": "c0000000-0000-0000-0000-000000000001",
      "account_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "amount": "-10000",
      "entry_type": "DEBIT",
      "created_at": "2026-09-09T10:00:00.005Z"
    },
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "transaction_id": "c0000000-0000-0000-0000-000000000001",
      "account_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "amount": "10000",
      "entry_type": "CREDIT",
      "created_at": "2026-09-09T10:00:00.006Z"
    }
  ]
}
```

PostgreSQL `BIGINT` values are returned by `node-postgres` as strings. Therefore monetary database values appear as strings in the JSON response.

---

# 9. Idempotent Replay

Submitting the same request again with the same authenticated user and `Idempotency-Key` does not create another transfer.

Example:

```http
POST /transactions
Authorization: Bearer 11111111-1111-1111-1111-111111111111
Idempotency-Key: transfer-001
Content-Type: application/json
```

with the same request body.

The original transaction result is returned.

### Response

**200 OK**

```json
{
  "requestId": "another-request-id",
  "replayed": true,
  "transaction": {
    "...": "original transaction"
  },
  "ledgerEntries": [
    {
      "...": "original ledger entry"
    }
  ]
}
```

The response indicates:

```json
{
  "replayed": true
}
```

No second balance mutation or second set of ledger entries is created.

---

# 10. Idempotency-Key Conflict

An idempotency key cannot be reused for a different transfer request.

For example, if:

```text
Idempotency-Key: transfer-001
```

was previously used for:

```text
Account A → Account B
Amount: 10000
Currency: USD
```

the same key cannot be used for:

```text
Account A → Account C
Amount: 5000
Currency: USD
```

The service hashes the transfer request using SHA-256 and compares the stored request hash.

### Response

**409 Conflict**

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "error": "CONFLICT",
  "message": "This idempotency key was already used for a different request."
}
```

---

# 11. Error Responses

Errors use a consistent JSON structure.

Example:

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "error": "BAD_REQUEST",
  "message": "Invalid transaction payload.",
  "details": {}
}
```

---

# 12. HTTP Error Codes

## 400 Bad Request

Returned when the request is invalid.

Examples:

- invalid transaction payload;
- malformed UUID;
- invalid amount;
- invalid currency;
- missing `Idempotency-Key`;
- invalid `Idempotency-Key`;
- malformed authentication header.

Example:

```json
{
  "requestId": "request-id",
  "error": "BAD_REQUEST",
  "message": "Missing or invalid Idempotency-Key header.",
  "details": {}
}
```

---

## 401 Unauthorized

Returned when authentication fails.

Examples:

- missing `Authorization` header;
- malformed bearer authentication;
- unknown user UUID.

Example:

```json
{
  "requestId": "request-id",
  "error": "UNAUTHORIZED",
  "message": "The supplied bearer token is not a valid user."
}
```

---

## 403 Forbidden

Returned when the authenticated user cannot perform the operation.

Currently this includes:

- inactive authenticated user;
- authenticated user does not own the source account.

Example:

```json
{
  "requestId": "request-id",
  "error": "FORBIDDEN",
  "message": "You do not own the source account."
}
```

---

## 404 Not Found

Returned when a required resource cannot be found.

Examples:

- source account does not exist;
- destination account does not exist;
- transaction result cannot be found.

Example:

```json
{
  "requestId": "request-id",
  "error": "NOT_FOUND",
  "message": "The source account was not found."
}
```

---

## 409 Conflict

Returned for idempotency conflicts.

Example:

```json
{
  "requestId": "request-id",
  "error": "CONFLICT",
  "message": "This idempotency key was already used for a different request."
}
```

---

## 422 Unprocessable Entity

Returned when the request is syntactically valid but violates a business rule.

Examples:

- source account has insufficient balance;
- source account is suspended/disabled;
- destination account is suspended/disabled;
- currencies do not match.

Example:

```json
{
  "requestId": "request-id",
  "error": "UNPROCESSABLE_ENTITY",
  "message": "The source account does not have sufficient balance."
}
```

---

## 503 Service Unavailable

Returned when PostgreSQL is unavailable for recognized database connection/service errors.

Example:

```json
{
  "requestId": "request-id",
  "error": "SERVICE_UNAVAILABLE",
  "message": "The service is temporarily unavailable."
}
```

---

## 500 Internal Server Error

Unexpected errors are returned without exposing internal implementation details.

Example:

```json
{
  "requestId": "request-id",
  "error": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected error occurred."
}
```

---

# 13. Transfer Integrity Guarantees

The transfer implementation uses PostgreSQL transactions:

```text
BEGIN
  ↓
Reserve idempotency key
  ↓
Lock source/destination accounts
  ↓
Validate balance
  ↓
Create transaction
  ↓
Debit source
  ↓
Credit destination
  ↓
Insert DEBIT ledger entry
  ↓
Insert CREDIT ledger entry
  ↓
Complete transaction
  ↓
Record idempotency result
  ↓
Create audit log
  ↓
COMMIT
```

If any operation fails:

```text
ROLLBACK
```

This prevents partial financial state from being committed.

---

# 14. Concurrency Control

Account rows are locked using:

```sql
SELECT ...
FROM accounts
WHERE id = $1
FOR UPDATE
```

The two account IDs are sorted before locks are acquired.

Therefore concurrent transfers involving the same accounts use a deterministic lock ordering.

This is designed to prevent opposite-direction transfers from deadlocking.

Example:

```text
Transfer A → B

locks:
A
B
```

and:

```text
Transfer B → A

locks:
A
B
```

rather than:

```text
Transfer A → B
A then B

Transfer B → A
B then A
```

Balances are read only after the account rows have been locked.

---

# 15. Double-Entry Ledger

Every completed transfer produces exactly two ledger entries:

```text
DEBIT  source      -amount
CREDIT destination +amount
```

The database validates that:

- exactly two entries exist;
- exactly one is a DEBIT;
- exactly one is a CREDIT;
- the ledger total is zero;
- the DEBIT equals the negative transaction amount;
- the CREDIT equals the transaction amount;
- the DEBIT belongs to the source account;
- the CREDIT belongs to the destination account.

Ledger entries are append-only.

The database prevents:

```text
UPDATE ledger_entries
DELETE FROM ledger_entries
TRUNCATE ledger_entries
```

---

# 16. Audit Logging

Successful transfer creation creates an audit record containing:

- authenticated user;
- action;
- resource type;
- transaction ID;
- request ID;
- idempotency key;
- amount;
- currency;
- source account;
- destination account.

Audit logs are append-only.

The database prevents modification or deletion of audit records.

---

# 17. Example cURL Request

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Authorization: Bearer 11111111-1111-1111-1111-111111111111" \
  -H "Idempotency-Key: transfer-001" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "10000",
    "currency": "USD"
  }'
```

Expected initial response:

```text
HTTP/1.1 201 Created
```

Repeating the same request with the same authenticated user and idempotency key returns:

```text
HTTP/1.1 200 OK
```

with:

```json
{
  "replayed": true
}
```

---

# 18. Endpoint Summary

| Method | Endpoint        | Authentication   | Purpose                  |
| ------ | --------------- | ---------------- | ------------------------ |
| GET    | `/health`       | No               | Service health check     |
| POST   | `/transactions` | Bearer user UUID | Create/replay a transfer |

---

# 19. Current API Scope

The current prototype intentionally focuses on the core transaction-engine workflow.

Implemented:

- authentication;
- authorization;
- transfer validation;
- account ownership validation;
- atomic transfers;
- idempotency;
- deterministic account locking;
- balance validation;
- double-entry ledger;
- database integrity constraints;
- immutable ledger entries;
- immutable audit logs;
- request IDs;
- structured errors;
- database failure handling;
- rollback on failed transfers.

Not currently implemented as API endpoints:

- user registration;
- login/token issuance;
- account creation;
- account balance endpoint;
- transaction history endpoint;
- transaction lookup endpoint;
- refunds;
- reversals;
- multi-currency exchange;
- external payment-provider integration.
