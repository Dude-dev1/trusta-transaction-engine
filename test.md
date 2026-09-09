# Transaction Engine — Live API Testing Guide

## Live Deployment

**Base URL:** `https://trusta-transaction-engine.onrender.com`

The API is deployed on Render and uses the production PostgreSQL database hosted on Supabase.

---

## Evaluator Test Data

These records are reserved for evaluator testing. **Do not modify or reuse them for personal testing.**

| Resource            | UUID                                   |
| ------------------- | -------------------------------------- |
| User 1              | `11111111-1111-1111-1111-111111111111` |
| User 2              | `22222222-2222-2222-2222-222222222222` |
| Source account      | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` |
| Destination account | `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` |

The evaluator should generate a unique `Idempotency-Key` for each new transfer.

---

# 1. Create a Transfer

```bash
curl -X POST https://trusta-transaction-engine.onrender.com/transactions \
  -H "Authorization: Bearer 11111111-1111-1111-1111-111111111111" \
  -H "Idempotency-Key: evaluator-transfer-001" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "1000",
    "currency": "USD"
  }'
```

### Expected result

A successful response should contain:

- `replayed: false`
- A transaction with status `COMPLETED`
- The requested amount and currency
- One `DEBIT` ledger entry for the source account
- One `CREDIT` ledger entry for the destination account

The ledger should balance: `-1000 + 1000 = 0`.

---

# 2. Test Idempotency Replay

Run the **same request again**, keeping the same:

`Idempotency-Key: evaluator-transfer-001`

The second response should contain:

```json
"replayed": true
```

The returned transaction and ledger entries should correspond to the original transaction.

No second financial operation should be created.

---

# 3. Test Idempotency-Key Conflict

Reuse the same idempotency key but change the request payload.

For example, change:

```json
"amountMinor": "1000"
```

to:

```json
"amountMinor": "2000"
```

while keeping the same idempotency key.

The API should reject the request with a conflict response similar to:

```json
{
  "error": "CONFLICT",
  "message": "This idempotency key was already used for a different request."
}
```

This verifies that an idempotency key cannot be reused for a different request.

---

# 4. Missing Idempotency Key

A transfer request without the `Idempotency-Key` header should be rejected.

```bash
curl -X POST https://trusta-transaction-engine.onrender.com/transactions \
  -H "Authorization: Bearer 11111111-1111-1111-1111-111111111111" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "1000",
    "currency": "USD"
  }'
```

Expected behavior: the request is rejected because the idempotency key is required.

---

# 5. Invalid Transfer Payload

The API validates the transfer payload.

For example, an invalid amount should be rejected:

```bash
curl -X POST https://trusta-transaction-engine.onrender.com/transactions \
  -H "Authorization: Bearer 11111111-1111-1111-1111-111111111111" \
  -H "Idempotency-Key: evaluator-invalid-001" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "0",
    "currency": "USD"
  }'
```

The request should be rejected.

---

# 6. Insufficient Funds

A transfer that exceeds the available balance of the source account should be rejected.

Use a new idempotency key for this scenario.

```bash
curl -X POST https://trusta-transaction-engine.onrender.com/transactions \
  -H "Authorization: Bearer 11111111-1111-1111-1111-111111111111" \
  -H "Idempotency-Key: evaluator-insufficient-001" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "999999999",
    "currency": "USD"
  }'
```

The transfer should be rejected and the source account should not be debited.

---

# 7. Authorization

The bearer token must correspond to a valid user.

For example, using a UUID that is not a registered user should result in an unauthorized response.

```bash
curl -X POST https://trusta-transaction-engine.onrender.com/transactions \
  -H "Authorization: Bearer 00000000-0000-0000-0000-000000000000" \
  -H "Idempotency-Key: evaluator-auth-001" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "destinationAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "amountMinor": "1000",
    "currency": "USD"
  }'
```

Expected behavior: the API rejects the request as unauthorized.

---

# Testing Notes

- Use a **new idempotency key** for every new transfer.
- To test replay behavior, reuse the **same key and identical request**.
- To test conflict behavior, reuse the **same key with a different request payload**.
- The evaluator accounts are reserved for evaluator testing.
- `amountMinor` represents the transfer amount in minor currency units.
- The live API uses the production Supabase PostgreSQL database.

## Successful Transfer Checklist

- [ ] HTTP API is reachable
- [ ] Valid bearer user is accepted
- [ ] Transfer completes successfully
- [ ] Idempotency key is stored
- [ ] Identical request is replayed
- [ ] Different request with the same key is rejected
- [ ] Ledger contains a DEBIT and CREDIT
- [ ] Ledger remains balanced
- [ ] Invalid requests are rejected
- [ ] Insufficient funds are rejected
