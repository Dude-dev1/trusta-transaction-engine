import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
});

export const env = envSchema.parse(process.env);
