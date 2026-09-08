import { HttpError, toHttpError } from "./errors";
import { verifyAccessToken, type EdisonClaims } from "../auth/verify-access-token";
import { safeCaughtErrorMetadata } from "../observability/safe-error";
import { withActiveMember } from "../services/members";

type ApiContext = {
  claims: EdisonClaims;
  requestId: string;
};

type ApiHandler = (context: ApiContext) => Promise<Response> | Response;

function allowedOrigins() {
  return new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (!allowedOrigins().has(origin.replace(/\/$/, ""))) {
    throw new HttpError(403, "origin_not_allowed", "This origin is not allowed.");
  }
  return origin;
}

function responseHeaders(requestId: string, origin: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
    Vary: "Origin",
  });

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
}

function withHeaders(response: Response, headers: Headers) {
  const merged = new Headers(response.headers);
  headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

export function sanitizedServerErrorLog(
  requestId: string,
  error: unknown,
  normalized: HttpError,
) {
  const errorCode = /^[a-z0-9_:-]{1,80}$/.test(normalized.code)
    ? normalized.code
    : "internal_error";

  return {
    requestId,
    status: normalized.status,
    errorCode,
    ...safeCaughtErrorMetadata(error),
  };
}

function logServerError(requestId: string, error: unknown, normalized: HttpError) {
  console.error(
    "Edison API request failed",
    sanitizedServerErrorLog(requestId, error, normalized),
  );
}

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

export async function readJsonBody(request: Request, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new HttpError(
        400,
        "invalid_content_length",
        "The request Content-Length was not valid.",
      );
    }
    if (Number(contentLength) > maxBytes) {
      throw new HttpError(
        413,
        "request_too_large",
        "The request body was too large.",
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("") as unknown;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(
          413,
          "request_too_large",
          "The request body was too large.",
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new SyntaxError("The request body was not valid UTF-8 JSON.");
  }

  return JSON.parse(body) as unknown;
}

export async function apiHandler(request: Request, handler: ApiHandler) {
  const requestId = crypto.randomUUID();
  let origin: string | null = null;

  try {
    origin = validateOrigin(request);
    const headers = responseHeaders(requestId, origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const claims = await verifyAccessToken(request.headers.get("authorization"));
    const response = await handler({ claims, requestId });
    return withHeaders(response, headers);
  } catch (error) {
    const normalized = toHttpError(error);
    if (normalized.status >= 500) {
      logServerError(requestId, error, normalized);
    }

    return withHeaders(
      Response.json(
        {
          error: {
            code: normalized.code,
            message: normalized.message,
            requestId,
            ...(normalized.details === undefined
              ? {}
              : { details: normalized.details }),
          },
        },
        { status: normalized.status },
      ),
      responseHeaders(requestId, origin),
    );
  }
}

export async function publicApiHandler(
  request: Request,
  handler: (context: { requestId: string }) => Promise<Response> | Response,
) {
  const requestId = crypto.randomUUID();
  let origin: string | null = null;
  try {
    origin = validateOrigin(request);
    const response = await handler({ requestId });
    return withHeaders(response, responseHeaders(requestId, origin));
  } catch (error) {
    const normalized = toHttpError(error);
    if (normalized.status >= 500) {
      logServerError(requestId, error, normalized);
    }
    return withHeaders(
      Response.json(
        {
          error: {
            code: normalized.code,
            message: normalized.message,
            requestId,
          },
        },
        { status: normalized.status },
      ),
      responseHeaders(requestId, origin),
    );
  }
}

/** Shared articles remain shareable between admitted readers, never anonymous.
 * Health and Auth resources continue using their separate public handlers. */
export async function memberApiHandler(request: Request, handler: ApiHandler) {
  return publicApiHandler(request, async ({ requestId }) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    const claims = await verifyAccessToken(request.headers.get("authorization"), { demand: true });
    // This actor-only handler does not receive the membership transaction. End
    // the gate before a content read needs the same single-connection pool.
    await withActiveMember(claims, async () => undefined);
    return handler({ claims, requestId });
  });
}
