import { HttpError, toHttpError } from "./errors";
import { verifyAccessToken, type EdisonClaims } from "../auth/verify-access-token";

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

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
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
      console.error("Edison API request failed", { requestId, error });
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
