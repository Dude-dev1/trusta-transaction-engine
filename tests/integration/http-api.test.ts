import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabaseUrl ? describe : describe.skip;

describe("HTTP API", () => {
  it("returns health status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("rejects a transfer without Authorization", async () => {
    const response = await request(app).post("/transactions").send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
    expect(response.body.requestId).toBeDefined();
  });
});

describeDb("HTTP transfer API", () => {
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

  async function createTestAccounts() {
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
         ($1, $3, 'USD', 2500, 'ACTIVE'),
         ($2, $3, 'USD', 5000, 'ACTIVE')`,
      [sourceAccountId, destinationAccountId, userId]
    );

    return {
      userId,
      sourceAccountId,
      destinationAccountId,
    };
  }

  it("creates a transfer through HTTP", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestAccounts();

    const requestId = randomUUID();
    const idempotencyKey = randomUUID();

    const response = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", idempotencyKey)
      .set("X-Request-Id", requestId)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountMinor: "500",
        currency: "USD",
      });

    expect(response.status).toBe(201);
    expect(response.headers["x-request-id"]).toBe(requestId);

    expect(response.body).toMatchObject({
      requestId,
      replayed: false,
    });

    expect(response.body.transaction).toMatchObject({
      source_account_id: sourceAccountId,
      destination_account_id: destinationAccountId,
      amount: "500",
      currency: "USD",
      status: "COMPLETED",
    });

    expect(response.body.ledgerEntries).toHaveLength(2);
  });

  it("replays the same transfer through HTTP for the same idempotency key", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestAccounts();

    const idempotencyKey = randomUUID();

    const payload = {
      sourceAccountId,
      destinationAccountId,
      amountMinor: "500",
      currency: "USD",
    };

    const firstResponse = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);

    const secondResponse = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.replayed).toBe(false);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.replayed).toBe(true);

    expect(secondResponse.body.transaction).toEqual(
      firstResponse.body.transaction
    );

    expect(secondResponse.body.ledgerEntries).toEqual(
      firstResponse.body.ledgerEntries
    );

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

    expect(counts[0]).toMatchObject({
      transactions: "1",
      ledger_entries: "2",
      idempotency_keys: "1",
      audit_logs: "1",
    });
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestAccounts();

    const idempotencyKey = randomUUID();

    const firstResponse = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountMinor: "500",
        currency: "USD",
      });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountMinor: "600",
        currency: "USD",
      });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error).toBe("CONFLICT");
  });

  it("rejects an invalid transfer payload", async () => {
    const { userId } = await createTestAccounts();

    const response = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        sourceAccountId: "not-a-uuid",
        destinationAccountId: "not-a-uuid",
        amountMinor: "-100",
        currency: "usd",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("BAD_REQUEST");
  });

  it("rejects a missing idempotency key", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestAccounts();

    const response = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .send({
        sourceAccountId,
        destinationAccountId,
        amountMinor: "500",
        currency: "USD",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("BAD_REQUEST");
  });

  it("rejects a transfer when the source account has insufficient funds", async () => {
    const { userId, sourceAccountId, destinationAccountId } =
      await createTestAccounts();

    const response = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${userId}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        sourceAccountId,
        destinationAccountId,
        amountMinor: "2501",
        currency: "USD",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("UNPROCESSABLE_ENTITY");

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

    expect(counts[0]).toMatchObject({
      transactions: "0",
      ledger_entries: "0",
      idempotency_keys: "0",
      audit_logs: "0",
    });
  });
});
