-- Transaction Engine - Database Constraint Verification
--
-- This verifies:
--
-- 1. Existing Phase 2 constraints
-- 2. Ledger immutability
-- 3. Double-entry integrity
-- 4. Completed transactions require exactly:
--      one DEBIT
--      one CREDIT
--      balanced amounts
--      correct source/destination accounts
--
-- Run against transaction_engine_dev.

\set ON_ERROR_STOP off

\echo ''
\echo '============================================================'
\echo 'Transaction Engine - Database Constraint Verification'
\echo '============================================================'


\echo ''
\echo '=== 1. Seed users ==='

INSERT INTO users (
    id,
    email,
    password_hash,
    status
)
VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'evaluator.user1@example.com',
    'hash1',
    'ACTIVE'
),
(
    '22222222-2222-2222-2222-222222222222',
    'evaluator.user2@example.com',
    'hash2',
    'ACTIVE'
);


\echo ''
\echo '=== 2. Seed USD accounts ==='

INSERT INTO accounts (
    id,
    user_id,
    currency,
    balance,
    status
)
VALUES
(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'USD',
    10000,
    'ACTIVE'
),
(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'USD',
    5000,
    'ACTIVE'
);


\echo ''
\echo '============================================================'
\echo 'VALID DOUBLE-ENTRY TRANSACTION'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    10000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -10000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000001',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    10000,
    'CREDIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000001';

COMMIT;

\echo 'VALID TRANSACTION COMMITTED SUCCESSFULLY';


\echo ''
\echo '=== Verify ledger total is zero ==='

SELECT
    transaction_id,
    COUNT(*) AS entry_count,
    SUM(amount) AS ledger_total
FROM ledger_entries
WHERE transaction_id =
    'c0000000-0000-0000-0000-000000000001'
GROUP BY transaction_id;


\echo ''
\echo '=== Verify DEBIT and CREDIT ==='

SELECT
    entry_type,
    account_id,
    amount
FROM ledger_entries
WHERE transaction_id =
    'c0000000-0000-0000-0000-000000000001'
ORDER BY entry_type;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 1: COMPLETED TRANSACTION WITH ONE ENTRY'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES (
    'c0000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -5000,
    'DEBIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000002';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 2: COMPLETED TRANSACTION WITH WRONG AMOUNTS'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -4000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000003',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    4000,
    'CREDIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000003';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 3: TWO DEBITS'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000004',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000004',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -5000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000004',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    -5000,
    'DEBIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000004';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 4: CREDIT ON WRONG ACCOUNT'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000005',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000005',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -5000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000005',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    5000,
    'CREDIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000005';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 5: EXTRA THIRD ENTRY'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000006',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000006',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -5000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000006',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'CREDIT'
),
(
    'c0000000-0000-0000-0000-000000000006',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    1,
    'CREDIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000006';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'INVALID TEST 6: UNBALANCED LEDGER'
\echo '============================================================'

BEGIN;

INSERT INTO transactions (
    id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    status
)
VALUES (
    'c0000000-0000-0000-0000-000000000007',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    5000,
    'USD',
    'PENDING'
);

INSERT INTO ledger_entries (
    transaction_id,
    account_id,
    amount,
    entry_type
)
VALUES
(
    'c0000000-0000-0000-0000-000000000007',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    -5000,
    'DEBIT'
),
(
    'c0000000-0000-0000-0000-000000000007',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    4999,
    'CREDIT'
);

UPDATE transactions
SET status = 'COMPLETED',
    completed_at = now()
WHERE id = 'c0000000-0000-0000-0000-000000000007';

\echo 'Expected: COMMIT below must fail.'

COMMIT;

ROLLBACK;


\echo ''
\echo '============================================================'
\echo 'LEDGER IMMUTABILITY'
\echo '============================================================'

\echo ''
\echo '=== UPDATE should fail ==='

UPDATE ledger_entries
SET amount = -9999
WHERE transaction_id =
    'c0000000-0000-0000-0000-000000000001'
AND entry_type = 'DEBIT';


\echo ''
\echo '=== DELETE should fail ==='

DELETE FROM ledger_entries
WHERE transaction_id =
    'c0000000-0000-0000-0000-000000000001'
AND entry_type = 'DEBIT';


\echo ''
\echo '=== Final valid ledger must still contain exactly 2 entries ==='

SELECT
    transaction_id,
    COUNT(*) AS entry_count,
    SUM(amount) AS ledger_total
FROM ledger_entries
WHERE transaction_id =
    'c0000000-0000-0000-0000-000000000001'
GROUP BY transaction_id;


\echo ''
\echo '============================================================'
\echo 'END OF VERIFICATION'
\echo '============================================================'

\echo ''
\echo 'Expected:'
\echo '  Valid transaction                  -> COMMIT succeeds'
\echo '  One-entry transaction              -> COMMIT fails'
\echo '  Wrong amounts                      -> COMMIT fails'
\echo '  Two DEBIT entries                  -> COMMIT fails'
\echo '  Wrong CREDIT account               -> COMMIT fails'
\echo '  Extra third entry                  -> COMMIT fails'
\echo '  Unbalanced ledger                  -> COMMIT fails'
\echo '  Ledger UPDATE                      -> fails'
\echo '  Ledger DELETE                      -> fails'
\echo ''