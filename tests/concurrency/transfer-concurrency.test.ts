import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describeDb("transfer concurrency", () => {
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

  async function createTestUserAndAccounts() {
    const userId = randomUUID();
    const sourceAccountId = randomUUID();
    const destinationAccountId = randomUUID();

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [userId, `${userId}@example.com`, "hash"]
    );

    await query(
      `INSERT INTO accounts (
         id,
         user_id,
         currency,
         balance,
         status
       )
       VALUES
         ($1, $3, 'USD', 25000, 'ACTIVE'),
         ($2, $3, 'USD', 5000, 'ACTIVE')`,
      [sourceAccountId, destinationAccountId, userId]
    );

    return {
      userId,
      sourceAccountId,
      destinationAccountId,
    };
  }

  it("serializes opposite-direction transfers without deadlock and preserves balances", async () => {
    const userOneId = randomUUID();
    const userTwoId = randomUUID();
    const accountOneId = randomUUID();
    const accountTwoId = randomUUID();

    await query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES
         ($1, $2, $3, 'ACTIVE'),
         ($4, $5, $6, 'ACTIVE')`,
      [
        userOneId,
        "kojo@example.com",
        "hash-one",
        userTwoId,
        "kofi@example.com",
        "hash-two",
      ]
    );

    await query(
      `INSERT INTO accounts (id, user_id, currency, balance, status)
       VALUES
         ($1, $2, 'USD', 25000, 'ACTIVE'),
         ($3, $4, 'USD', 25000, 'ACTIVE')`,
      [accountOneId, userOneId, accountTwoId, userTwoId]
    );

    const [first, second] = await Promise.all([
      createTransfer({
        userId: userOneId,
        requestId: randomUUID(),
        idempotencyKey: "opposite-direction-1",
        sourceAccountId: accountOneId,
        destinationAccountId: accountTwoId,
        amountMinor: 1000n,
        currency: "USD",
      }),
      createTransfer({
        userId: userTwoId,
        requestId: randomUUID(),
        idempotencyKey: "opposite-direction-2",
        sourceAccountId: accountTwoId,
        destinationAccountId: accountOneId,
        amountMinor: 1500n,
        currency: "USD",
      }),
    ]);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(first.transaction.status).toBe("COMPLETED");
    expect(second.transaction.status).toBe("COMPLETED");

    const balances = await query<{ balance: string }>(
      `SELECT balance FROM accounts ORDER BY id`
    );

    expect(balances.map((row) => row.balance)).toHaveLength(2);

    expect(Number(balances[0].balance) + Number(balances[1].balance)).toBe(
      50000
    );

    const sortedBalances = [...balances.map((row) => Number(row.balance))].sort(
      (a, b) => a - b
    );

    expect(sortedBalances).toEqual([24500, 25500]);
  });

  it("executes exactly one transfer when identical requests race on the same idempotency key", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestUserAndAccounts();

    const idempotencyKey = randomUUID();

    const input = {
      userId,
      sourceAccountId,
      destinationAccountId,
      amountMinor: 1000n,
      currency: "USD",
    };

    const [first, second, third, fourth] = await Promise.all([
      createTransfer({
        ...input,
        requestId: randomUUID(),
        idempotencyKey,
      }),
      createTransfer({
        ...input,
        requestId: randomUUID(),
        idempotencyKey,
      }),
      createTransfer({
        ...input,
        requestId: randomUUID(),
        idempotencyKey,
      }),
      createTransfer({
        ...input,
        requestId: randomUUID(),
        idempotencyKey,
      }),
    ]);

    const results = [first, second, third, fourth];

    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(3);

    const transactionIds = new Set(
      results.map((result) => result.transaction.id)
    );

    expect(transactionIds.size).toBe(1);

    const counts = await query<{
      transactions: string;
      ledger_entries: string;
      idempotency_keys: string;
      audit_logs: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM transactions) AS transactions,
        (SELECT COUNT(*)::text FROM ledger_entries) AS ledger_entries,
        (SELECT COUNT(*)::text FROM idempotency_keys) AS idempotency_keys,
        (SELECT COUNT(*)::text FROM audit_logs) AS audit_logs
    `);

    expect(counts[0]).toEqual({
      transactions: "1",
      ledger_entries: "2",
      idempotency_keys: "1",
      audit_logs: "1",
    });

    const balances = await query<{
      id: string;
      balance: string;
    }>(
      `SELECT id, balance
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id`,
      [sourceAccountId, destinationAccountId]
    );

    const balanceMap = new Map(
      balances.map((account) => [account.id, Number(account.balance)])
    );

    expect(balanceMap.get(sourceAccountId)).toBe(24000);
    expect(balanceMap.get(destinationAccountId)).toBe(6000);
  });

  it("allows only one financial operation when different payloads race on the same idempotency key", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestUserAndAccounts();

    const idempotencyKey = randomUUID();

    const firstInput = {
      userId,
      requestId: randomUUID(),
      idempotencyKey,
      sourceAccountId,
      destinationAccountId,
      amountMinor: 1000n,
      currency: "USD",
    };

    const secondInput = {
      userId,
      requestId: randomUUID(),
      idempotencyKey,
      sourceAccountId,
      destinationAccountId,
      amountMinor: 2000n,
      currency: "USD",
    };

    const results = await Promise.allSettled([
      createTransfer(firstInput),
      createTransfer(secondInput),
    ]);

    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof createTransfer>>
      > => result.status === "fulfilled"
    );

    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(rejected[0].reason).toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });

    const counts = await query<{
      transactions: string;
      ledger_entries: string;
      idempotency_keys: string;
      audit_logs: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM transactions) AS transactions,
        (SELECT COUNT(*)::text FROM ledger_entries) AS ledger_entries,
        (SELECT COUNT(*)::text FROM idempotency_keys) AS idempotency_keys,
        (SELECT COUNT(*)::text FROM audit_logs) AS audit_logs
    `);

    expect(counts[0]).toEqual({
      transactions: "1",
      ledger_entries: "2",
      idempotency_keys: "1",
      audit_logs: "1",
    });

    const transaction = fulfilled[0].value.transaction;

    expect(["1000", "2000"]).toContain(transaction.amount);

    const balances = await query<{
      balance: string;
    }>(
      `SELECT balance
       FROM accounts
       WHERE id = $1`,
      [sourceAccountId]
    );

    const destinationBalances = await query<{
      balance: string;
    }>(
      `SELECT balance
       FROM accounts
       WHERE id = $1`,
      [destinationAccountId]
    );

    const amount = Number(transaction.amount);

    expect(Number(balances[0].balance)).toBe(25000 - amount);
    expect(Number(destinationBalances[0].balance)).toBe(5000 + amount);
  });
});
