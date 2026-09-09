import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describeDb("database migration strategy", () => {
  let query: typeof import("../../src/database/client.js").query;
  let pool: typeof import("../../src/database/client.js").pool;

  beforeAll(async () => {
    const database = await import("../../src/database/client.js");
    query = database.query;
    pool = database.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("includes the expected core tables and migration triggers", async () => {
    const tables = await query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users',
          'accounts',
          'transactions',
          'ledger_entries',
          'idempotency_keys',
          'audit_logs'
        )
      ORDER BY table_name
    `);

    expect(tables.map((row) => row.table_name)).toEqual([
      "accounts",
      "audit_logs",
      "idempotency_keys",
      "ledger_entries",
      "transactions",
      "users",
    ]);

    const triggers = await query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname IN (
        'ledger_entries_prevent_update_delete',
        'ledger_entries_prevent_truncate',
        'audit_logs_prevent_update_delete',
        'audit_logs_prevent_truncate',
        'transactions_validate_completed_ledger',
        'ledger_entries_validate_completed_transaction',
        'transactions_validate_account_consistency'
      )
      ORDER BY tgname
    `);

    expect(triggers.map((row) => row.tgname)).toEqual([
      "audit_logs_prevent_truncate",
      "audit_logs_prevent_update_delete",
      "ledger_entries_prevent_truncate",
      "ledger_entries_prevent_update_delete",
      "ledger_entries_validate_completed_transaction",
      "transactions_validate_account_consistency",
      "transactions_validate_completed_ledger",
    ]);

    const functions = await query<{ proname: string }>(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN (
        'prevent_ledger_mutation',
        'prevent_audit_log_mutation',
        'validate_completed_transaction_ledger',
        'validate_transaction_account_consistency'
      )
      ORDER BY proname
    `);

    expect(functions.map((row) => row.proname)).toEqual([
      "prevent_audit_log_mutation",
      "prevent_ledger_mutation",
      "validate_completed_transaction_ledger",
      "validate_transaction_account_consistency",
    ]);
  });
});
