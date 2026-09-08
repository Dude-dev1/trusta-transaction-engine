import { z } from "zod";

export const transferBodySchema = z.object({
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must use three uppercase letters."),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type TransferBody = z.infer<typeof transferBodySchema>;
