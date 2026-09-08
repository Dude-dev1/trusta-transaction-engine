export type UserStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED";

export type LedgerEntryType = "DEBIT" | "CREDIT";

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: UserStatus;
}
