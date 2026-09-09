import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashTransferRequest } from "../../src/utils/request-hash.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describeDb("transfer service", () => {
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

  it("creates a transfer and replays the same result for the same idempotency key", async () => {
    const userId = randomUUID();
    const sourceAccountId = randomUUID();
    const destinationAccountId = randomUUID();

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [userId, "alice@example.com", "hash"]
    );

    await query(
      `INSERT INTO accounts (id, user_id, currency, balance, status)
       VALUES
         ($1, $2, 'USD', 25000, 'ACTIVE'),
         ($3, $2, 'USD', 5000, 'ACTIVE')`,
      [sourceAccountId, userId, destinationAccountId]
    );

    const first = await createTransfer({
      userId,
      requestId: randomUUID(),
      idempotencyKey: "abc123",
      sourceAccountId,
      destinationAccountId,
      amountMinor: 10000n,
      currency: "USD",
    });

    expect(first.replayed).toBe(false);
    expect(first.transaction.status).toBe("COMPLETED");
    expect(first.ledgerEntries).toHaveLength(2);

    const second = await createTransfer({
      userId,
      requestId: randomUUID(),
      idempotencyKey: "abc123",
      sourceAccountId,
      destinationAccountId,
      amountMinor: 10000n,
      currency: "USD",
    });

    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);

    const balances = await query<{ id: string; balance: string }>(
      `SELECT id, balance FROM accounts ORDER BY id`
    );

    expect(balances.map((row) => row.balance)).toEqual(["15000", "15000"]);
  });

  it("rejects a pending idempotency key that has no committed transaction yet", async () => {
    const userId = randomUUID();
    const sourceAccountId = randomUUID();
    const destinationAccountId = randomUUID();
    const request = {
      userId,
      requestId: randomUUID(),
      idempotencyKey: "pending-key",
      sourceAccountId,
      destinationAccountId,
      amountMinor: 10000n,
      currency: "USD",
    };

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [userId, "pending@example.com", "hash"]
    );

    await query(
      `INSERT INTO accounts (id, user_id, currency, balance, status)
       VALUES
         ($1, $2, 'USD', 25000, 'ACTIVE'),
         ($3, $2, 'USD', 5000, 'ACTIVE')`,
      [sourceAccountId, userId, destinationAccountId]
    );

    await query(
      `INSERT INTO idempotency_keys (key, user_id, request_hash, status)
       VALUES ($1, $2, $3, 'PENDING')`,
      [request.idempotencyKey, userId, hashTransferRequest(request)]
    );

    await expect(createTransfer(request)).rejects.toThrow(
      "currently in progress"
    );
  });
});
