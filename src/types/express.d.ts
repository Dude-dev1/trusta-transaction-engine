import type { AuthenticatedUser } from "./domain.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

export {};
