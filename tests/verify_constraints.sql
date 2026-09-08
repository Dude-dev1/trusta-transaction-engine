-- Manual constraint-verification script (run against transaction_engine_dev).
-- Not part of the app's automated test suite (that will be vitest against
-- the real transaction service later) — this is a one-off sanity pass
-- directly against the schema created by migration 001.

\set ON_ERROR_STOP off
\echo '=== 1. Seed two users and one account each (USD) ==='

INSERT INTO users (id, email, password_hash, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'kojo@example.com', 'hash1', 'ACTIVE'),
  ('22222222-2222-2222-2222-222222222222', 'kofi@example.com',   'hash2', 'ACTIVE');

INSERT INTO accounts (id, user_id, currency, balance, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'USD', 10000, 'ACTIVE'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'USD', 5000,  'ACTIVE');

\echo '=== 2. Valid transfer: kojo -> kofi, 10000 minor units ($100.00) ==='

INSERT INTO transactions (id, source_account_id, destination_account_id, amount, currency, status, completed_at)
VALUES ('c0000000-0000-0000-0000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        10000, 'USD', 'COMPLETED', now());

INSERT INTO ledger_entries (transaction_id, account_id, amount, entry_type) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -10000, 'DEBIT'),
  ('c0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  10000, 'CREDIT');

UPDATE accounts SET balance = balance - 10000 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE accounts SET balance = balance + 10000 WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

\echo '--- ledger balances to zero for this transaction? (expect 0) ---'
SELECT sum(amount) FROM ledger_entries WHERE transaction_id = 'c0000000-0000-0000-0000-000000000001';

\echo '=== 3. VIOLATION TEST: negative balance should be rejected ==='
UPDATE accounts SET balance = -1 WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

\echo '=== 4. VIOLATION TEST: amount <= 0 should be rejected ==='
INSERT INTO transactions (source_account_id, destination_account_id, amount, currency, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, 'USD', 'PENDING');

\echo '=== 5. VIOLATION TEST: source = destination should be rejected ==='
INSERT INTO transactions (source_account_id, destination_account_id, amount, currency, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100, 'USD', 'PENDING');

\echo '=== 6. VIOLATION TEST: DEBIT with positive amount should be rejected ==='
INSERT INTO ledger_entries (transaction_id, account_id, amount, entry_type)
VALUES ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 500, 'DEBIT');

\echo '=== 7. VIOLATION TEST: bad status value should be rejected ==='
INSERT INTO transactions (source_account_id, destination_account_id, amount, currency, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 100, 'USD', 'CANCELLED');

\echo '=== 8. Idempotency uniqueness: same (user_id, key) twice should be rejected ==='
INSERT INTO idempotency_keys (key, user_id, request_hash, status)
VALUES ('ABC123', '11111111-1111-1111-1111-111111111111', 'hash-of-request-1', 'COMPLETED');

INSERT INTO idempotency_keys (key, user_id, request_hash, status)
VALUES ('ABC123', '11111111-1111-1111-1111-111111111111', 'hash-of-request-2', 'PENDING');

\echo '=== 9. Idempotency: same key, DIFFERENT user should be allowed (per-user scoping) ==='
INSERT INTO idempotency_keys (key, user_id, request_hash, status)
VALUES ('ABC123', '22222222-2222-2222-2222-222222222222', 'hash-of-kofis-request', 'PENDING');

\echo '--- idempotency_keys rows (expect 2: kojo/ABC123 completed, kofi/ABC123 pending) ---'
SELECT key, user_id, status FROM idempotency_keys ORDER BY user_id;

\echo '=== 10. Duplicate email should be rejected ==='
INSERT INTO users (email, password_hash, status) VALUES ('kojo@example.com', 'other-hash', 'ACTIVE');

\echo '=== 11. Deletion restraint: deleting a referenced account should be rejected ==='
DELETE FROM accounts WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

\echo '=== Done. Review above: violation tests (3,4,5,6,7,8,10,11) must all show ERROR. ==='