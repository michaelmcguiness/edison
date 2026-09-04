import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function toHttpError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof ZodError) {
    return new HttpError(400, "invalid_request", "The request was not valid.", {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  if (error instanceof SyntaxError) {
    return new HttpError(400, "invalid_json", "The request body was not valid JSON.");
  }

  return new HttpError(500, "internal_error", "Edison could not complete the request.");
}
