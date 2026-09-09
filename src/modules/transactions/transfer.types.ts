import type { LedgerEntryType, TransactionStatus } from "../../types/domain.js";

export interface TransferExecutionInput {
  userId: string;
  requestId: string;
  idempotencyKey: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
  currency: string;
}

export interface TransferLedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  amount: string;
  entry_type: LedgerEntryType;
  created_at: string;
}

export interface TransferTransactionRow {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount: string;
  currency: string;
  status: TransactionStatus;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TransferResult {
  replayed: boolean;
  transaction: TransferTransactionRow;
  ledgerEntries: TransferLedgerEntry[];
}
