import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { app } from "./app.js";

export function startServer(): void {
  app.listen(env.PORT, () => {
    console.log(`transaction engine listening on port ${env.PORT}`);
  });
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  startServer();
}
