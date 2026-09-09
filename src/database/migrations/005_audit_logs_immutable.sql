-- Transaction Engine - Migration 005
-- Enforce immutable / append-only audit logs.
--
-- audit_logs may be INSERTed.
-- audit_logs may NOT be UPDATEd, DELETEd, or TRUNCATEd.
--
-- Audit records are append-only to preserve an irreversible history of
-- financial actions for investigation, replay, and compliance.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'audit_logs are immutable: % operation is not permitted',
        TG_OP
        USING ERRCODE = '55000';

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_prevent_update_delete
ON audit_logs;

CREATE TRIGGER audit_logs_prevent_update_delete
BEFORE UPDATE OR DELETE
ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_logs_prevent_truncate
ON audit_logs;

CREATE TRIGGER audit_logs_prevent_truncate
BEFORE TRUNCATE
ON audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_audit_log_mutation();

COMMIT;
