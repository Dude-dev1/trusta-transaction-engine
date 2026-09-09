-- Transaction Engine - Migration 002
-- Enforce immutable / append-only ledger entries.
--
-- ledger_entries may be INSERTed.
-- ledger_entries may NOT be UPDATEd, DELETEd, or TRUNCATEd.
--
-- The database itself enforces this invariant rather than relying
-- exclusively on application code.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'ledger_entries are immutable: % operation is not permitted',
        TG_OP
        USING ERRCODE = '55000';

    RETURN NULL;
END;
$$;

-- Protect individual ledger rows from UPDATE and DELETE.
DROP TRIGGER IF EXISTS ledger_entries_prevent_update_delete
ON ledger_entries;

CREATE TRIGGER ledger_entries_prevent_update_delete
BEFORE UPDATE OR DELETE
ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_mutation();

-- Protect the entire ledger table from TRUNCATE.
DROP TRIGGER IF EXISTS ledger_entries_prevent_truncate
ON ledger_entries;

CREATE TRIGGER ledger_entries_prevent_truncate
BEFORE TRUNCATE
ON ledger_entries
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ledger_mutation();

COMMIT;