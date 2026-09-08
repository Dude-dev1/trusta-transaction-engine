import { Pool, type PoolClient, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and configure it."
  );
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

pool.on("error", (err) => {
  // Unexpected errors on idle clients (e.g. connection dropped) should not
  // crash the process silently — surface them.
  console.error("Unexpected error on idle Postgres client", err);
});

/**
 * Runs `fn` inside a single Postgres transaction (BEGIN ... COMMIT / ROLLBACK).
 *
 * This is the mechanism referenced throughout the design docs (section 10,
 * section 37): all financial state changes for one business transaction
 * happen inside one database transaction boundary, on one client, so that
 * either everything commits or nothing does.
 *
 * Callers should acquire row locks (`SELECT ... FOR UPDATE`) *inside* fn
 * using the same `client`, in deterministic order (section 35), before
 * reading balances they intend to mutate.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience one-off query outside any explicit transaction (reads, etc.). */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
