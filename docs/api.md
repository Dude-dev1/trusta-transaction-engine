# API Documentation

## Authentication

All transaction requests require a bearer token in the form of a user UUID.

```http
Authorization: Bearer 11111111-1111-1111-1111-111111111111
```

The service looks up that user in `users` and rejects suspended or disabled users.

## POST /transactions

Creates a transfer between two accounts owned or accessed by the authenticated user.

### Headers

- `Authorization: Bearer <user-uuid>`
- `Idempotency-Key: <unique-key-per-user>`

### Body

```json
{
  "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "amountMinor": 10000,
  "currency": "USD"
}
```

### Response: 201 Created

```json
{
  "requestId": "8b2f9f83-7dd5-4d1f-b8b4-c75b6931e65c",
  "replayed": false,
  "transaction": {
    "id": "c0000000-0000-0000-0000-000000000001",
    "source_account_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destination_account_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amount": "10000",
    "currency": "USD",
    "status": "COMPLETED",
    "failure_reason": null,
    "created_at": "2026-09-08T12:00:00.000Z",
    "completed_at": "2026-09-08T12:00:00.000Z"
  },
  "ledgerEntries": [
    {
      "id": "...",
      "transaction_id": "c0000000-0000-0000-0000-000000000001",
      "account_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "amount": -10000,
      "entry_type": "DEBIT",
      "created_at": "2026-09-08T12:00:00.000Z"
    },
    {
      "id": "...",
      "transaction_id": "c0000000-0000-0000-0000-000000000001",
      "account_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "amount": 10000,
      "entry_type": "CREDIT",
      "created_at": "2026-09-08T12:00:00.000Z"
    }
  ]
}
```

### Response: 200 OK

Returned when the same idempotency key is replayed with the same request.

### Important errors

- `400 Bad Request` for invalid JSON, missing headers, or invalid field shapes
- `401 Unauthorized` for missing or invalid bearer token
- `403 Forbidden` when the source account is not owned by the authenticated user
- `409 Conflict` when the same idempotency key is reused for a different request
- `422 Unprocessable Entity` for business-rule failures like insufficient balance
- `503 Service Unavailable` when the database is not available
