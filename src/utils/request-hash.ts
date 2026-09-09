import { createHash } from "node:crypto";

export interface TransferHashInput {
  userId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
  currency: string;
}

export function hashTransferRequest(input: TransferHashInput): string {
  const payload = JSON.stringify({
    type: "transfer",
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,

    // BigInt cannot be serialized directly by JSON.stringify.
    // Convert it to its canonical decimal representation.
    amountMinor: input.amountMinor.toString(),

    currency: input.currency,
  });

  return createHash("sha256").update(payload).digest("hex");
}
