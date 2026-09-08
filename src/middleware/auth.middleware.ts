import type { NextFunction, Request, Response } from "express";
import { query } from "../database/client.js";
import type { AuthenticatedUser } from "../types/domain.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

interface UserRow {
  id: string;
  email: string;
  status: AuthenticatedUser["status"];
}

function parseBearerToken(headerValue: string | undefined): string {
  if (!headerValue) {
    throw new UnauthorizedError("Missing Authorization header.");
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new UnauthorizedError("Use Bearer authentication with a user UUID.");
  }

  return token.trim();
}

export async function authenticateRequest(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = parseBearerToken(req.header("authorization"));
    const rows = await query<UserRow>(
      "SELECT id, email, status FROM users WHERE id = $1",
      [userId]
    );

    const user = rows[0];
    if (!user) {
      throw new UnauthorizedError(
        "The supplied bearer token is not a valid user."
      );
    }

    if (user.status !== "ACTIVE") {
      throw new ForbiddenError("This account is not active.");
    }

    req.authenticatedUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
