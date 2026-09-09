-- Transaction Engine - Migration 004
-- Enforce consistency between completed transactions and their accounts.
--
-- A COMPLETED transaction must:
--
--   1. Have a valid source account.
--   2. Have a valid destination account.
--   3. Use the same currency as both accounts.
--   4. Have completed_at populated.
--
-- A non-COMPLETED transaction must not have completed_at populated.
--
-- This is intentionally implemented as a deferred constraint trigger so
-- the application can construct the transaction inside a single atomic
-- PostgreSQL transaction before the final consistency check occurs.

BEGIN;

CREATE OR REPLACE FUNCTION validate_transaction_account_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_currency CHAR(3);
    destination_currency CHAR(3);
BEGIN
    /*
     * A transaction cannot be COMPLETED without a completion timestamp.
     */
    IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NULL THEN
        RAISE EXCEPTION
            'Completed transaction % must have completed_at populated',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    /*
     * A transaction that is not COMPLETED must not have a completion
     * timestamp.
     */
    IF NEW.status <> 'COMPLETED' AND NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION
            'Non-completed transaction % must not have completed_at populated',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    /*
     * Only completed transactions require account consistency.
     */
    IF NEW.status <> 'COMPLETED' THEN
        RETURN NULL;
    END IF;

    /*
     * Fetch the currencies of both accounts.
     */
    SELECT currency
    INTO source_currency
    FROM accounts
    WHERE id = NEW.source_account_id;

    IF source_currency IS NULL THEN
        RAISE EXCEPTION
            'Completed transaction % references missing source account %',
            NEW.id,
            NEW.source_account_id
            USING ERRCODE = '23503';
    END IF;

    SELECT currency
    INTO destination_currency
    FROM accounts
    WHERE id = NEW.destination_account_id;

    IF destination_currency IS NULL THEN
        RAISE EXCEPTION
            'Completed transaction % references missing destination account %',
            NEW.id,
            NEW.destination_account_id
            USING ERRCODE = '23503';
    END IF;

    /*
     * The transaction currency must match the source account currency.
     */
    IF source_currency <> NEW.currency THEN
        RAISE EXCEPTION
            'Completed transaction % currency % does not match source account % currency %',
            NEW.id,
            NEW.currency,
            NEW.source_account_id,
            source_currency
            USING ERRCODE = '23514';
    END IF;

    /*
     * The transaction currency must match the destination account currency.
     */
    IF destination_currency <> NEW.currency THEN
        RAISE EXCEPTION
            'Completed transaction % currency % does not match destination account % currency %',
            NEW.id,
            NEW.currency,
            NEW.destination_account_id,
            destination_currency
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;


DROP TRIGGER IF EXISTS transactions_validate_account_consistency
ON transactions;


CREATE CONSTRAINT TRIGGER transactions_validate_account_consistency
AFTER INSERT OR UPDATE OF
    status,
    completed_at,
    currency,
    source_account_id,
    destination_account_id
ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_transaction_account_consistency();


COMMIT;