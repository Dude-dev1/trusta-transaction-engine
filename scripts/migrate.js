import "dotenv/config";
import { spawnSync } from "node:child_process";

const migrations = [
  "src/database/migrations/001_init.sql",
  "src/database/migrations/002_ledger_immutable.sql",
  "src/database/migrations/003_double_entry_integrity.sql",
  "src/database/migrations/004_transaction_account_consistency.sql",
  "src/database/migrations/005_audit_logs_immutable.sql",
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

for (const migration of migrations) {
  console.log(`\nRunning ${migration}...`);

  const result = spawnSync(
    "psql",
    [process.env.DATABASE_URL, "-f", migration],
    {
      stdio: "inherit",
      shell: true,
    }
  );

  if (result.status !== 0) {
    console.error(`Migration failed: ${migration}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll migrations completed successfully.");
