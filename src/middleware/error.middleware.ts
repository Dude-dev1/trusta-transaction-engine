import type { NextFunction, Request, Response } from "express";
import { HttpError, ServiceUnavailableError } from "../utils/errors.js";

function serializeError(error: unknown): {
  statusCode: number;
  payload: Record<string, unknown>;
} {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  const pgError = error as { code?: string } | undefined;
  if (
    pgError?.code &&
    ["57P01", "57P02", "57P03", "ECONNREFUSED"].includes(pgError.code)
  ) {
    const unavailable = new ServiceUnavailableError();
    return {
      statusCode: unavailable.statusCode,
      payload: { error: unavailable.code, message: unavailable.message },
    };
  }

  return {
    statusCode: 500,
    payload: {
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  };
}

export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const { statusCode, payload } = serializeError(error);
  res.status(statusCode).json({
    requestId: req.requestId,
    ...payload,
  });
}
