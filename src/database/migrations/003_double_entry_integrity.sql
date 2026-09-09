-- Transaction Engine - Migration 003
-- Enforce double-entry integrity for COMPLETED transactions.
--
-- A completed transfer must have exactly:
--
--   1 DEBIT  = -transaction.amount
--   1 CREDIT = +transaction.amount
--
-- The DEBIT must belong to the source account.
-- The CREDIT must belong to the destination account.
--
-- Therefore:
--
--   sum(ledger entries) = 0
--
-- The constraint is DEFERRABLE INITIALLY DEFERRED because the
-- application creates the transaction first, then inserts the
-- ledger entries, and finally marks the transaction COMPLETED
-- within the same PostgreSQL transaction.

BEGIN;

CREATE OR REPLACE FUNCTION validate_completed_transaction_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    transaction_record RECORD;

    ledger_count INTEGER;
    debit_count INTEGER;
    credit_count INTEGER;

    ledger_total BIGINT;

    debit_amount BIGINT;
    credit_amount BIGINT;

    debit_account_id UUID;
    credit_account_id UUID;
BEGIN
    /*
     * Determine which transaction should be validated.
     *
     * The trigger can fire because:
     *
     * 1. A transaction changes status to COMPLETED.
     * 2. A ledger entry is inserted for a transaction.
     */
    IF TG_TABLE_NAME = 'transactions' THEN
        SELECT
            id,
            source_account_id,
            destination_account_id,
            amount,
            status
        INTO transaction_record
        FROM transactions
        WHERE id = NEW.id;

    ELSE
        SELECT
            id,
            source_account_id,
            destination_account_id,
            amount,
            status
        INTO transaction_record
        FROM transactions
        WHERE id = NEW.transaction_id;
    END IF;

    /*
     * If the transaction doesn't exist, let the normal foreign-key
     * constraint handle that situation.
     */
    IF transaction_record.id IS NULL THEN
        RETURN NULL;
    END IF;

    /*
     * Only COMPLETED transactions need the final double-entry
     * invariant.
     *
     * PENDING transactions are allowed to temporarily have zero
     * or incomplete ledger entries while the surrounding database
     * transaction is still executing.
     */
    IF transaction_record.status <> 'COMPLETED' THEN
        RETURN NULL;
    END IF;

    /*
     * Count the ledger entries.
     */
    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (
            WHERE entry_type = 'DEBIT'
        )::INTEGER,
        COUNT(*) FILTER (
            WHERE entry_type = 'CREDIT'
        )::INTEGER,
        COALESCE(SUM(amount), 0)::BIGINT
    INTO
        ledger_count,
        debit_count,
        credit_count,
        ledger_total
    FROM ledger_entries
    WHERE transaction_id = transaction_record.id;

    /*
     * A completed transfer must have exactly two entries.
     */
    IF ledger_count <> 2 THEN
        RAISE EXCEPTION
            'Completed transaction % must have exactly 2 ledger entries; found %',
            transaction_record.id,
            ledger_count
            USING ERRCODE = '23514';
    END IF;

    /*
     * Exactly one DEBIT and one CREDIT.
     */
    IF debit_count <> 1 OR credit_count <> 1 THEN
        RAISE EXCEPTION
            'Completed transaction % must have exactly 1 DEBIT and 1 CREDIT; found % DEBIT and % CREDIT',
            transaction_record.id,
            debit_count,
            credit_count
            USING ERRCODE = '23514';
    END IF;

    /*
     * The ledger must balance.
     */
    IF ledger_total <> 0 THEN
        RAISE EXCEPTION
            'Completed transaction % has unbalanced ledger total: %',
            transaction_record.id,
            ledger_total
            USING ERRCODE = '23514';
    END IF;

    /*
     * Retrieve the single DEBIT and CREDIT.
     */
    SELECT
        amount,
        account_id
    INTO
        debit_amount,
        debit_account_id
    FROM ledger_entries
    WHERE transaction_id = transaction_record.id
      AND entry_type = 'DEBIT';

    SELECT
        amount,
        account_id
    INTO
        credit_amount,
        credit_account_id
    FROM ledger_entries
    WHERE transaction_id = transaction_record.id
      AND entry_type = 'CREDIT';

    /*
     * The DEBIT must exactly equal negative transaction amount.
     */
    IF debit_amount <> -transaction_record.amount THEN
        RAISE EXCEPTION
            'Completed transaction % has invalid DEBIT amount: expected %, found %',
            transaction_record.id,
            -transaction_record.amount,
            debit_amount
            USING ERRCODE = '23514';
    END IF;

    /*
     * The CREDIT must exactly equal positive transaction amount.
     */
    IF credit_amount <> transaction_record.amount THEN
        RAISE EXCEPTION
            'Completed transaction % has invalid CREDIT amount: expected %, found %',
            transaction_record.id,
            transaction_record.amount,
            credit_amount
            USING ERRCODE = '23514';
    END IF;

    /*
     * The DEBIT must belong to the source account.
     */
    IF debit_account_id <> transaction_record.source_account_id THEN
        RAISE EXCEPTION
            'Completed transaction % has DEBIT on wrong account: expected %, found %',
            transaction_record.id,
            transaction_record.source_account_id,
            debit_account_id
            USING ERRCODE = '23514';
    END IF;

    /*
     * The CREDIT must belong to the destination account.
     */
    IF credit_account_id <> transaction_record.destination_account_id THEN
        RAISE EXCEPTION
            'Completed transaction % has CREDIT on wrong account: expected %, found %',
            transaction_record.id,
            transaction_record.destination_account_id,
            credit_account_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;


DROP TRIGGER IF EXISTS transactions_validate_completed_ledger
ON transactions;

CREATE CONSTRAINT TRIGGER transactions_validate_completed_ledger
AFTER INSERT OR UPDATE OF status
ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_completed_transaction_ledger();


DROP TRIGGER IF EXISTS ledger_entries_validate_completed_transaction
ON ledger_entries;

CREATE CONSTRAINT TRIGGER ledger_entries_validate_completed_transaction
AFTER INSERT
ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_completed_transaction_ledger();


COMMIT;