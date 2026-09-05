// src/lib/errors.ts
//
// A small typed error hierarchy so every layer (Server Actions, API routes,
// services) can throw domain-specific errors and callers can either branch
// on `error.code` or just forward `error.status` + `error.message` straight
// to an HTTP response. Keeping these in one place also gives us a single
// spot to review for "does every user-facing rejection have an explicit,
// human-readable message" (a requirement from the brief).

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No authenticated session at all. */
export class UnauthorizedError extends AppError {
  constructor(message = "You must be signed in to perform this action.") {
    super("UNAUTHORIZED", message, 401);
  }
}

/** Authenticated, but the role/assignment doesn't permit this action. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", message, 404);
  }
}

/** Malformed input — bad CSV row, missing field, invalid email format, etc. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
  }
}

/** Session is full: count(Reserved+Confirmed+CheckedIn) >= capacity. */
export class CapacityExceededError extends AppError {
  constructor(message: string) {
    super("CAPACITY_EXCEEDED", message, 409);
  }
}

/** Same email already has an active (non-cancelled/expired) registration for this session. */
export class DuplicateRegistrationError extends AppError {
  constructor(message: string) {
    super("DUPLICATE_REGISTRATION", message, 409);
  }
}

/** Attempted a registration status transition that the state machine forbids. */
export class InvalidTransitionError extends AppError {
  constructor(message: string) {
    super("INVALID_TRANSITION", message, 409);
  }
}
