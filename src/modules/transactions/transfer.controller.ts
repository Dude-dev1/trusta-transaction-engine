import type { Request, Response } from "express";
import { BadRequestError } from "../../utils/errors.js";
import { idempotencyKeySchema, transferBodySchema } from "./transfer.schema.js";
import { createTransfer } from "./transfer.service.js";

export async function postTransfer(req: Request, res: Response): Promise<void> {
  const bodyResult = transferBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    throw new BadRequestError(
      "Invalid transaction payload.",
      bodyResult.error.flatten()
    );
  }

  const idempotencyKey = idempotencyKeySchema.safeParse(
    req.header("idempotency-key")
  );
  if (!idempotencyKey.success) {
    throw new BadRequestError(
      "Missing or invalid Idempotency-Key header.",
      idempotencyKey.error.flatten()
    );
  }

  if (!req.authenticatedUser) {
    throw new BadRequestError("Authenticated user context is missing.");
  }

  const result = await createTransfer({
    userId: req.authenticatedUser.id,
    requestId: req.requestId,
    idempotencyKey: idempotencyKey.data,
    ...bodyResult.data,
  });

  res.status(result.replayed ? 200 : 201).json({
    requestId: req.requestId,
    replayed: result.replayed,
    transaction: result.transaction,
    ledgerEntries: result.ledgerEntries,
  });
}
