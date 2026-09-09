import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describeDb("audit log integrity", () => {
  let query: typeof import("../../src/database/client.js").query;
  let pool: typeof import("../../src/database/client.js").pool;

  beforeAll(async () => {
    const database = await import("../../src/database/client.js");
    query = database.query;
    pool = database.pool;
  });

  beforeEach(async () => {
    await query(`
    ALTER TABLE audit_logs
    DISABLE TRIGGER audit_logs_prevent_update_delete;

    ALTER TABLE audit_logs
    DISABLE TRIGGER audit_logs_prevent_truncate;

    ALTER TABLE ledger_entries
    DISABLE TRIGGER ledger_entries_prevent_update_delete;

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

    ALTER TABLE audit_logs
    ENABLE TRIGGER audit_logs_prevent_truncate;

    ALTER TABLE ledger_entries
    ENABLE TRIGGER ledger_entries_prevent_update_delete;

    ALTER TABLE ledger_entries
    ENABLE TRIGGER ledger_entries_prevent_truncate;
  `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("prevents updates and deletes on audit logs", async () => {
    const userId = randomUUID();

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [userId, "audit@example.com", "hash"]
    );

    const inserted = await query<{ id: string }>(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)
       RETURNING id`,
      [userId, "TRANSFER_CREATED", "TRANSACTION", randomUUID()]
    );

    await expect(
      query(`UPDATE audit_logs SET action = 'UPDATED' WHERE id = $1`, [
        inserted[0].id,
      ])
    ).rejects.toThrow(/immutable|not permitted|audit_logs/i);

    await expect(
      query(`DELETE FROM audit_logs WHERE id = $1`, [inserted[0].id])
    ).rejects.toThrow(/immutable|not permitted|audit_logs/i);
  });
});
