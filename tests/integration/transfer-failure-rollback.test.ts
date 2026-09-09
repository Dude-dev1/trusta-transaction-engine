import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describeDb("transfer failure rollback semantics", () => {
  let createTransfer: typeof import("../../src/modules/transactions/transfer.service.js").createTransfer;
  let query: typeof import("../../src/database/client.js").query;
  let pool: typeof import("../../src/database/client.js").pool;

  beforeAll(async () => {
    const service = await import(
      "../../src/modules/transactions/transfer.service.js"
    );
    const database = await import("../../src/database/client.js");
    createTransfer = service.createTransfer;
    query = database.query;
    pool = database.pool;
  });

  beforeEach(async () => {
    await query(`
        ALTER TABLE audit_logs
        DISABLE TRIGGER audit_logs_prevent_update_delete;
    `);

    await query(`
        ALTER TABLE audit_logs
        DISABLE TRIGGER audit_logs_prevent_truncate;
    `);

    await query(`
        ALTER TABLE ledger_entries
        DISABLE TRIGGER ledger_entries_prevent_update_delete;
    `);

    await query(`
        ALTER TABLE ledger_entries
        DISABLE TRIGGER ledger_entries_prevent_truncate;
    `);

    await query(`
        DELETE FROM audit_logs;
        DELETE FROM idempotency_keys;
        DELETE FROM ledger_entries;
        DELETE FROM transactions;
        DELETE FROM accounts;
        DELETE FROM users;
    `);

    await query(`
        ALTER TABLE audit_logs
        ENABLE TRIGGER audit_logs_prevent_update_delete;
    `);

    await query(`
        ALTER TABLE audit_logs
        ENABLE TRIGGER audit_logs_prevent_truncate;
    `);

    await query(`
        ALTER TABLE ledger_entries
        ENABLE TRIGGER ledger_entries_prevent_update_delete;
    `);

    await query(`
        ALTER TABLE ledger_entries
        ENABLE TRIGGER ledger_entries_prevent_truncate;
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rolls back all inserts when the transfer fails before completion", async () => {
    const userId = randomUUID();
    const sourceAccountId = randomUUID();
    const destinationAccountId = randomUUID();

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [userId, "failure@example.com", "hash"]
    );

    await query(
      `INSERT INTO accounts (id, user_id, currency, balance, status)
       VALUES
         ($1, $2, 'USD', 2500, 'ACTIVE'),
         ($3, $2, 'USD', 5000, 'ACTIVE')`,
      [sourceAccountId, userId, destinationAccountId]
    );

    await expect(
      createTransfer({
        userId,
        requestId: randomUUID(),
        idempotencyKey: "failure-rollback-key",
        sourceAccountId,
        destinationAccountId,
        amountMinor: 5001n,
        currency: "USD",
      })
    ).rejects.toThrow(/sufficient balance/i);

    const counts = await query<{ count: string }>(`
      SELECT
        (SELECT COUNT(*)::text FROM transactions) AS transactions,
        (SELECT COUNT(*)::text FROM ledger_entries) AS ledger_entries,
        (SELECT COUNT(*)::text FROM idempotency_keys) AS idempotency_keys,
        (SELECT COUNT(*)::text FROM audit_logs) AS audit_logs
    `);

    expect(counts[0]).toMatchObject({
      transactions: "0",
      ledger_entries: "0",
      idempotency_keys: "0",
      audit_logs: "0",
    });
  });
});
