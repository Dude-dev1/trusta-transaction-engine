import express from "express";
import { authenticateRequest } from "./middleware/auth.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { requestIdMiddleware } from "./middleware/request-id.middleware.js";
import { transferRouter } from "./modules/transactions/transfer.router.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/transactions", authenticateRequest, transferRouter);

  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
