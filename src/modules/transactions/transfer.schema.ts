import { z } from "zod";

const amountMinorSchema = z
  .union([
    z.number().int().positive().safe(),
    z.string().regex(/^\d+$/, "amountMinor must contain only digits."),
  ])
  .transform((value, ctx) => {
    try {
      const amount = BigInt(value);

      if (amount <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "amountMinor must be greater than zero.",
        });

        return z.NEVER;
      }

      return amount;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "amountMinor must be a valid integer amount in minor units.",
      });

      return z.NEVER;
    }
  });

export const transferBodySchema = z.object({
  sourceAccountId: z.string().uuid(),

  destinationAccountId: z.string().uuid(),

  amountMinor: amountMinorSchema,

  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must use three uppercase letters."),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export type TransferBody = z.infer<typeof transferBodySchema>;