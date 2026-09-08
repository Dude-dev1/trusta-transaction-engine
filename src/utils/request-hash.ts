import { createHash } from "node:crypto";

export interface TransferHashInput {
  userId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number;
  currency: string;
}

export function hashTransferRequest(input: TransferHashInput): string {
  const payload = JSON.stringify({
    type: "transfer",
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    amountMinor: input.amountMinor,
    currency: input.currency,
  });

  return createHash("sha256").update(payload).digest("hex");
}
