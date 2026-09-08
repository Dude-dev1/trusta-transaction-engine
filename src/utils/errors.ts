export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, message, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Authentication required.") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "You are not allowed to perform this operation.") {
    super(403, message, "FORBIDDEN");
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message, "NOT_FOUND");
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, message, "CONFLICT", details);
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(422, message, "UNPROCESSABLE_ENTITY", details);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = "The service is temporarily unavailable.") {
    super(503, message, "SERVICE_UNAVAILABLE");
  }
}
