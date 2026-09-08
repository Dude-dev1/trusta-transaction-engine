import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../../database/client.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "../../utils/errors.js";
import { hashTransferRequest } from "../../utils/request-hash.js";
import type {
  TransferExecutionInput,
  TransferLedgerEntry,
  TransferResult,
  TransferTransactionRow,
} from "./transfer.types.js";

interface IdempotencyRow {
  key: string;
  user_id: string;
  request_hash: string;
  transaction_id: string | null;
  status: "PENDING" | "COMPLETED" | "FAILED";
}

interface LockableAccountRow {
  id: string;
  user_id: string;
  currency: string;
  balance: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
}

async function loadLockedAccounts(
  client: PoolClient,
  sourceAccountId: string,
  destinationAccountId: string
): Promise<Map<string, LockableAccountRow>> {
  const ids = [sourceAccountId, destinationAccountId].sort();
  const result = await client.query<LockableAccountRow>(
    `SELECT id, user_id, currency, balance, status
     FROM accounts
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [ids]
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

async function loadTransactionResult(
  client: PoolClient,
  transactionId: string
): Promise<{
  transaction: TransferTransactionRow;
  ledgerEntries: TransferLedgerEntry[];
}> {
  const transactionRows = await client.query<TransferTransactionRow>(
    `SELECT id, source_account_id, destination_account_id, amount, currency, status, failure_reason, created_at, completed_at
     FROM transactions
     WHERE id = $1`,
    [transactionId]
  );

  const ledgerRows = await client.query<TransferLedgerEntry>(
    `SELECT id, transaction_id, account_id, amount, entry_type, created_at
     FROM ledger_entries
     WHERE transaction_id = $1
     ORDER BY created_at, id`,
    [transactionId]
  );

  const transaction = transactionRows.rows[0];
  if (!transaction) {
    throw new NotFoundError("Transaction record was not found.");
  }

  return { transaction, ledgerEntries: ledgerRows.rows };
}

async function reserveIdempotencyKey(
  client: PoolClient,
  userId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<{ inserted: boolean; record: IdempotencyRow }> {
  const insertResult = await client.query<IdempotencyRow>(
    `INSERT INTO idempotency_keys (key, user_id, request_hash, status)
     VALUES ($1, $2, $3, 'PENDING')
     ON CONFLICT (user_id, key) DO NOTHING
     RETURNING key, user_id, request_hash, transaction_id, status`,
    [idempotencyKey, userId, requestHash]
  );

  if (insertResult.rowCount === 1) {
    return { inserted: true, record: insertResult.rows[0] };
  }

  const rowResult = await client.query<IdempotencyRow>(
    `SELECT key, user_id, request_hash, transaction_id, status
     FROM idempotency_keys
     WHERE user_id = $1 AND key = $2
     FOR UPDATE`,
    [userId, idempotencyKey]
  );

  const record = rowResult.rows[0];
  if (!record) {
    return reserveIdempotencyKey(client, userId, idempotencyKey, requestHash);
  }

  return { inserted: false, record };
}

export async function createTransfer(
  input: TransferExecutionInput
): Promise<TransferResult> {
  const requestHash = hashTransferRequest(input);

  return withTransaction(async (client) => {
    const idempotency = await reserveIdempotencyKey(
      client,
      input.userId,
      input.idempotencyKey,
      requestHash
    );

    if (!idempotency.inserted) {
      if (idempotency.record.request_hash !== requestHash) {
        throw new ConflictError(
          "This idempotency key was already used for a different request."
        );
      }

      if (idempotency.record.transaction_id) {
        const replay = await loadTransactionResult(
          client,
          idempotency.record.transaction_id
        );
        return {
          replayed: true,
          transaction: replay.transaction,
          ledgerEntries: replay.ledgerEntries,
        };
      }
    }

    const accounts = await loadLockedAccounts(
      client,
      input.sourceAccountId,
      input.destinationAccountId
    );
    const sourceAccount = accounts.get(input.sourceAccountId);
    const destinationAccount = accounts.get(input.destinationAccountId);

    if (!sourceAccount) {
      throw new NotFoundError("The source account was not found.");
    }

    if (!destinationAccount) {
      throw new NotFoundError("The destination account was not found.");
    }

    if (sourceAccount.user_id !== input.userId) {
      throw new ForbiddenError("You do not own the source account.");
    }

    if (
      sourceAccount.status !== "ACTIVE" ||
      destinationAccount.status !== "ACTIVE"
    ) {
      throw new UnprocessableEntityError(
        "Both accounts must be active before a transfer can be created."
      );
    }

    if (
      sourceAccount.currency !== input.currency ||
      destinationAccount.currency !== input.currency
    ) {
      throw new UnprocessableEntityError(
        "Both accounts must use the same currency as the transfer."
      );
    }

    const sourceBalance = Number(sourceAccount.balance);
    if (sourceBalance < input.amountMinor) {
      throw new UnprocessableEntityError(
        "The source account does not have sufficient balance."
      );
    }

    const transactionId = randomUUID();
    const transactionResult = await client.query<TransferTransactionRow>(
      `INSERT INTO transactions (
         id, source_account_id, destination_account_id, amount, currency, status
       ) VALUES ($1, $2, $3, $4, $5, 'PENDING')
       RETURNING id, source_account_id, destination_account_id, amount, currency, status, failure_reason, created_at, completed_at`,
      [
        transactionId,
        input.sourceAccountId,
        input.destinationAccountId,
        input.amountMinor,
        input.currency,
      ]
    );

    await client.query(
      `UPDATE accounts
       SET balance = balance - $1,
           updated_at = now()
       WHERE id = $2`,
      [input.amountMinor, input.sourceAccountId]
    );

    await client.query(
      `UPDATE accounts
       SET balance = balance + $1,
           updated_at = now()
       WHERE id = $2`,
      [input.amountMinor, input.destinationAccountId]
    );

    const ledgerEntriesToInsert = [
      {
        id: randomUUID(),
        transaction_id: transactionId,
        account_id: input.sourceAccountId,
        amount: -input.amountMinor,
        entry_type: "DEBIT" as const,
      },
      {
        id: randomUUID(),
        transaction_id: transactionId,
        account_id: input.destinationAccountId,
        amount: input.amountMinor,
        entry_type: "CREDIT" as const,
      },
    ];

    const ledgerEntries: TransferLedgerEntry[] = [];

    for (const ledgerEntry of ledgerEntriesToInsert) {
      const insertedLedgerRow = await client.query<TransferLedgerEntry>(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, amount, entry_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, transaction_id, account_id, amount, entry_type, created_at`,
        [
          ledgerEntry.id,
          ledgerEntry.transaction_id,
          ledgerEntry.account_id,
          ledgerEntry.amount,
          ledgerEntry.entry_type,
        ]
      );

      ledgerEntries.push(insertedLedgerRow.rows[0]);
    }

    await client.query(
      `UPDATE transactions
       SET status = 'COMPLETED',
           completed_at = now()
       WHERE id = $1`,
      [transactionId]
    );

    await client.query(
      `UPDATE idempotency_keys
       SET status = 'COMPLETED',
           transaction_id = $1
       WHERE user_id = $2 AND key = $3`,
      [transactionId, input.userId, input.idempotencyKey]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.userId,
        "TRANSFER_CREATED",
        "TRANSACTION",
        transactionId,
        JSON.stringify({
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          amountMinor: input.amountMinor,
          currency: input.currency,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
        }),
      ]
    );

    return {
      replayed: false,
      transaction: transactionResult.rows[0],
      ledgerEntries,
    };
  });
}
